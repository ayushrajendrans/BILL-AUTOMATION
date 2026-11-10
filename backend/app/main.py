import asyncio
import base64
import binascii
import io
import logging
import os
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image
from pydantic import BaseModel, Field, ValidationError

from app.services.ai_service import AnalysisError, analyze_image, has_ai_configuration
from app.services.excel_service import (
    THUMBNAIL_SIZE,
    create_excel_with_images,
    make_thumbnail,
    month_from_date,
    normalize_club,
    normalize_month,
)

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="ClubBill AI Backend")
logger = logging.getLogger("uvicorn.error")
BATCH_TIMEOUT = 240
MAX_BATCH_BYTES = 95 * 1024 * 1024
MAX_POSTERS = 50
MAX_EXPORT_BYTES = 64 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
jobs = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


@dataclass
class Poster:
    filename: str
    mime_type: str
    content: bytes


@dataclass
class BatchResult:
    rows: list[dict]
    notes: list[str]
    failed: int
    review: int
    retry_indices: list[int]
    retry_message: str | None
    retry_after: int | None


class ExportRow(BaseModel):
    club_name: str = Field(min_length=1, max_length=300)
    date: str = Field(max_length=100)
    month: str = Field(default="", max_length=20)
    thumbnail: str = Field(default="", max_length=131072)


class BillingExport(BaseModel):
    rows: list[ExportRow] = Field(min_length=1)
    notes: list[str] = Field(default_factory=list)


def require_provider():
    if not has_ai_configuration():
        raise HTTPException(503, "Poster analysis is not configured. Set GEMINI_API_KEY or configure Cloudflare Workers AI.")


async def read_posters(files):
    if not 1 <= len(files) <= MAX_POSTERS:
        raise HTTPException(400, f"Select between 1 and {MAX_POSTERS} posters.")
    posters = []
    remaining = MAX_BATCH_BYTES
    for file in files:
        if file.content_type not in IMAGE_TYPES:
            raise HTTPException(400, "Select JPG, PNG or WEBP posters. ZIP input is not supported.")
        content = await file.read(remaining + 1)
        remaining -= len(content)
        if remaining < 0:
            raise HTTPException(413, "Keep each batch under 95 MB.")
        posters.append(Poster(file.filename or "Unnamed poster", file.content_type, content))
    return posters


def remove_expired_jobs():
    cutoff = time.monotonic() - 3600
    for job_id, job in list(jobs.items()):
        if job.get("finished_at", float("inf")) < cutoff:
            del jobs[job_id]


def get_job(job_id):
    remove_expired_jobs()
    if job_id not in jobs:
        raise HTTPException(404, "This batch expired or the server restarted. Upload it again.")
    return jobs[job_id]


@app.post("/jobs", status_code=202)
async def start_job(files: list[UploadFile] = File(...), extract_only: bool = Form(False)):
    require_provider()
    posters = await read_posters(files)
    remove_expired_jobs()
    if sum(job["status"] == "processing" for job in jobs.values()) >= 2:
        raise HTTPException(429, "Two batches are already processing. Wait for one to finish.")
    if len(jobs) >= 20:
        oldest = min(
            (key for key, job in jobs.items() if job["status"] != "processing"),
            key=lambda key: jobs[key]["finished_at"],
        )
        del jobs[oldest]

    job_id = uuid.uuid4().hex
    job = {"status": "processing", "completed": 0, "total": len(posters),
           "stage": "Analyzing posters", "failed": 0, "review": 0}
    jobs[job_id] = job

    async def run():
        def progress(stage, completed):
            job.update(stage=stage, completed=completed)

        try:
            result = await build_bills(posters, progress, thumbnail_only=extract_only)
            if extract_only:
                job["results"] = {
                    "rows": [
                        {
                            "club_name": row["club_name"],
                            "date": row["date"],
                            "month": row["month"],
                            "thumbnail": base64.b64encode(row["thumbnail"]).decode("ascii"),
                        }
                        for row in result.rows
                    ],
                    "notes": result.notes,
                    "retry_indices": result.retry_indices,
                    "retry_message": result.retry_message,
                    "retry_after": result.retry_after,
                }
            else:
                job["archive"] = await asyncio.to_thread(make_archive, result.rows, result.notes)
            job.update(status="ready", stage="Ready", completed=len(posters),
                       failed=result.failed, review=result.review)
        except HTTPException as error:
            job.update(status="error", message=str(error.detail))
        except asyncio.CancelledError:
            job.update(status="cancelled", message="Batch cancelled.")
            raise
        except Exception:
            logger.exception("Billing job failed")
            job.update(status="error", message="Could not generate the workbook. Please try again.")
        finally:
            job["finished_at"] = time.monotonic()

    job["task"] = asyncio.create_task(run())
    return {"id": job_id, "status": "processing"}


@app.get("/jobs/{job_id}")
async def job_status(job_id: str):
    job = get_job(job_id)
    return {key: job[key] for key in ("status", "completed", "total", "stage", "failed", "review", "message") if key in job}


@app.delete("/jobs/{job_id}", status_code=204)
async def cancel_job(job_id: str):
    job = get_job(job_id)
    if job["status"] == "processing":
        job.update(status="cancelled", message="Batch cancelled.", finished_at=time.monotonic())
        job["task"].cancel()
        await asyncio.gather(job["task"], return_exceptions=True)
    return Response(status_code=204)


def zip_response(archive, filename):
    return Response(
        archive, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@app.get("/jobs/{job_id}/download")
async def download_job(job_id: str):
    job = get_job(job_id)
    if job["status"] != "ready":
        raise HTTPException(409, "This batch is not ready to download.")
    if "archive" not in job:
        raise HTTPException(409, "This part is awaiting the combined export.")
    return zip_response(job["archive"], f"billing_{job_id[:8]}.zip")


@app.get("/jobs/{job_id}/results")
async def job_results(job_id: str):
    job = get_job(job_id)
    if job["status"] != "ready" or "results" not in job:
        raise HTTPException(409, "This part does not have extraction results yet.")
    return JSONResponse(job["results"], headers={"Cache-Control": "no-store"})


def export_rows(body):
    try:
        payload = BillingExport.model_validate_json(body)
    except ValidationError as error:
        raise HTTPException(422, "The export data is invalid or contains no posters.") from error
    rows = []
    for row in payload.rows:
        try:
            thumbnail = base64.b64decode(row.thumbnail, validate=True)
            if thumbnail:
                with Image.open(io.BytesIO(thumbnail)) as image:
                    if (image.format != "JPEG" or image.width > THUMBNAIL_SIZE[0]
                            or image.height > THUMBNAIL_SIZE[1]):
                        raise ValueError("Unexpected thumbnail")
                    image.load()
        except (binascii.Error, ValueError, OSError, Image.DecompressionBombError) as error:
            raise HTTPException(422, "A poster thumbnail is invalid.") from error
        rows.append({"club_name": row.club_name, "date": row.date, "month": row.month,
                     "thumbnail": thumbnail})
    return make_archive(rows, payload.notes)


@app.post("/exports")
async def create_export(request: Request):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_EXPORT_BYTES:
            raise HTTPException(413, "The combined export is too large for the server.")
        body.extend(chunk)
    archive = await asyncio.to_thread(export_rows, body)
    return zip_response(archive, "billing_files.zip")


@app.post("/process-bills")
async def process_bills(files: list[UploadFile] = File(...)):
    require_provider()
    result = await build_bills(await read_posters(files))
    archive = await asyncio.to_thread(make_archive, result.rows, result.notes)
    return zip_response(archive, "billing_files.zip")


def make_archive(rows, notes):
    clubs = {}
    for row in rows:
        club = normalize_club(row["club_name"]) or "UNKNOWN_CLUB"
        clubs.setdefault(club, []).append({**row, "club_name": club})

    output = io.BytesIO()
    used_names = set()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for club, items in clubs.items():
            stem = "".join(c for c in club if c.isalnum() or c in " -_").strip()[:80] or "Club"
            name = f"{stem}.xlsx"
            suffix = 2
            while name.casefold() in used_names:
                name = f"{stem} ({suffix}).xlsx"
                suffix += 1
            used_names.add(name.casefold())
            archive.writestr(name, create_excel_with_images(items))
        if notes:
            archive.writestr("processing-report.txt", "\n".join(notes) + "\n")
    return output.getvalue()


async def build_bills(posters, progress=None, thumbnail_only=False):
    semaphore = asyncio.Semaphore(2)
    completed = 0
    provider_failure = None

    async def process_poster(poster):
        nonlocal completed, provider_failure
        async with semaphore:
            try:
                if provider_failure is not None:
                    return provider_failure
                result = await analyze_image(poster.content, poster.mime_type)
                if not result:
                    raise AnalysisError("No poster details could be extracted.", 422)
                row = {
                    "club_name": (normalize_club(result["club_name"]) or "UNKNOWN_CLUB")[:300],
                    "date": result["event_date"].strip()[:100],
                    "month": normalize_month(result.get("event_month", "")),
                }
                if thumbnail_only:
                    try:
                        row["thumbnail"] = await asyncio.to_thread(make_thumbnail, poster.content)
                    except (OSError, ValueError, Image.DecompressionBombError):
                        row["thumbnail"] = b""
                else:
                    row["image_bytes"] = poster.content
                return row
            except AnalysisError as error:
                if error.status_code in (401, 403, 429):
                    provider_failure = error
                return error
            finally:
                completed += 1
                if progress:
                    progress("Analyzing posters", completed)

    tasks = [asyncio.create_task(process_poster(poster)) for poster in posters]
    try:
        done, _ = await asyncio.wait(tasks, timeout=BATCH_TIMEOUT)
        timeout = AnalysisError("Poster analysis timed out. Retry this poster.", 504)
        results = [task.result() if task in done else timeout for task in tasks]
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    rows, notes, errors, retry_indices, retry_errors = [], [], [], [], []
    review = 0
    for index, (poster, result) in enumerate(zip(posters, results)):
        if isinstance(result, AnalysisError):
            if thumbnail_only and result.status_code in (401, 403, 429, 500, 502, 503, 504):
                retry_indices.append(index)
                retry_errors.append(result)
                continue
            errors.append(result)
            notes.append(f"Skipped {poster.filename}: {result}")
            continue
        unreadable = result["club_name"] == "UNKNOWN_CLUB" or not month_from_date(result["date"])
        missing_thumbnail = thumbnail_only and not result["thumbnail"]
        if unreadable or missing_thumbnail:
            review += 1
        if unreadable:
            notes.append(f"Review {poster.filename}: club or date could not be read.")
        if missing_thumbnail:
            notes.append(f"Review {poster.filename}: the poster image could not be embedded.")
        rows.append(result)

    if not rows and not thumbnail_only:
        first = errors[0]
        raise HTTPException(first.status_code, f"No posters processed. {first}")
    if progress:
        progress("Preparing results", len(posters))
    blocking_error = next((error for error in retry_errors if error.retry_after is None), None)
    retry_after = None if blocking_error else max((error.retry_after for error in retry_errors), default=None)
    retry_message = str(blocking_error or retry_errors[0]) if retry_errors else None
    return BatchResult(rows=rows, notes=notes, failed=len(errors), review=review,
                       retry_indices=retry_indices, retry_message=retry_message,
                       retry_after=retry_after)


@app.get("/")
def read_root(response: Response):
    if revision := os.getenv("RENDER_GIT_COMMIT"):
        response.headers["X-ClubBill-Revision"] = revision
    return {"message": "ClubBill AI API is running."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
