import asyncio
import io
import logging
import os
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.services.ai_service import AnalysisError, analyze_image_with_gemini, has_ai_configuration
from app.services.excel_service import create_excel_with_images

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="ClubBill AI Backend")
logger = logging.getLogger("uvicorn.error")
BATCH_TIMEOUT = 240
MAX_BATCH_BYTES = 95 * 1024 * 1024
MAX_POSTERS = 50
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
    archive: bytes
    failed: int
    review: int


def require_provider():
    if not has_ai_configuration():
        raise HTTPException(503, "Poster analysis is not configured. Set GEMINI_API_KEY on the server.")


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
async def start_job(files: list[UploadFile] = File(...)):
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
            result = await build_bills(posters, progress)
            job.update(status="ready", stage="Ready to download", completed=len(posters),
                       archive=result.archive, failed=result.failed, review=result.review)
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
    return zip_response(job["archive"], f"billing_{job_id[:8]}.zip")


@app.post("/process-bills")
async def process_bills(files: list[UploadFile] = File(...)):
    require_provider()
    result = await build_bills(await read_posters(files))
    return zip_response(result.archive, "billing_files.zip")


def make_archive(rows, notes):
    clubs = {}
    for row in rows:
        clubs.setdefault(row["club_name"], []).append(row)

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


async def build_bills(posters, progress=None):
    semaphore = asyncio.Semaphore(2)
    completed = 0
    provider_failure = None

    async def process_poster(poster):
        nonlocal completed, provider_failure
        async with semaphore:
            try:
                if provider_failure is not None:
                    return provider_failure
                result = await analyze_image_with_gemini(poster.content, poster.mime_type)
                if not result:
                    raise AnalysisError("No poster details could be extracted.", 422)
                return {
                    "club_name": result["club_name"].upper().strip(),
                    "date": result["event_date"].strip(),
                    "image_bytes": poster.content,
                }
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

    rows, notes, errors = [], [], []
    review = 0
    for poster, result in zip(posters, results):
        if isinstance(result, AnalysisError):
            errors.append(result)
            notes.append(f"Skipped {poster.filename}: {result}")
            continue
        if result["club_name"] == "UNKNOWN_CLUB" or result["date"].upper() == "UNKNOWN_DATE":
            review += 1
            notes.append(f"Review {poster.filename}: club or date could not be read.")
        rows.append(result)

    if not rows:
        first = errors[0]
        raise HTTPException(first.status_code, f"No posters processed. {first}")
    if progress:
        progress("Generating Excel files", len(posters))
    archive = await asyncio.to_thread(make_archive, rows, notes)
    return BatchResult(archive=archive, failed=len(errors), review=review)


@app.get("/")
def read_root():
    return {"message": "ClubBill AI API is running."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
