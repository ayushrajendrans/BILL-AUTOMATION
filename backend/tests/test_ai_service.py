import base64
import asyncio
import io
import json
import os
import unittest
import zipfile
from unittest.mock import AsyncMock, patch

import httpx
from openpyxl import load_workbook
from PIL import Image

from app.main import app, jobs, make_archive
from app.services.ai_service import AnalysisError, analyze_image_with_gemini


def sample_poster(size=(20, 20)):
    image = io.BytesIO()
    Image.new("RGB", size, "white").save(image, format="PNG")
    return image.getvalue()


class GeminiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "GEMINI_API_KEY": "test-key",
            "GOOGLE_API_KEY": "",
            "OPENAI_API_KEY": "",
            "GEMINI_MODEL": "gemini-3.1-flash-lite",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client_class = httpx.AsyncClient

    def mock_provider(self, handler):
        return patch(
            "app.services.ai_service.httpx.AsyncClient",
            side_effect=lambda **kwargs: self.client_class(
                transport=httpx.MockTransport(handler), **kwargs
            ),
        )

    async def test_png_extraction(self):
        def handler(request):
            self.assertEqual(request.headers["x-goog-api-key"], "test-key")
            self.assertTrue(str(request.url).endswith("gemini-3.1-flash-lite:generateContent"))
            data = json.loads(request.content)
            image = data["contents"][0]["parts"][1]["inlineData"]
            self.assertEqual(image["mimeType"], "image/jpeg")
            with Image.open(io.BytesIO(base64.b64decode(image["data"]))) as decoded:
                self.assertEqual(decoded.format, "JPEG")
                self.assertEqual(decoded.size, (2200, 1100))
            return httpx.Response(200, json={"candidates": [{
                "content": {"parts": [{"text": '{"club_name":"TEST","event_date":"08-Oct"}'}]}
            }]})

        with self.mock_provider(handler):
            result = await analyze_image_with_gemini(sample_poster((3000, 1500)), "image/png")
        self.assertEqual(result, {"club_name": "TEST", "event_date": "08-Oct"})

    async def test_free_quota_error(self):
        with self.mock_provider(lambda request: httpx.Response(429)):
            with self.assertRaises(AnalysisError) as raised:
                await analyze_image_with_gemini(sample_poster())
        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("quota", str(raised.exception))

    async def test_invalid_output(self):
        with self.mock_provider(lambda request: httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": '{"club_name":null}'}]}}]
        })):
            with self.assertRaises(AnalysisError):
                await analyze_image_with_gemini(sample_poster())

    async def test_corrupt_image_is_not_sent_to_provider(self):
        with self.mock_provider(lambda request: self.fail("Invalid image reached provider")):
            with self.assertRaises(AnalysisError) as raised:
                await analyze_image_with_gemini(b"not an image")
        self.assertEqual(raised.exception.status_code, 400)

    async def test_transient_provider_error_retries_once(self):
        responses = iter([httpx.Response(503), httpx.Response(200, json={"candidates": [{
            "content": {"parts": [{"text": '{"club_name":"TEST","event_date":"08-Oct"}'}]}
        }]})])
        with self.mock_provider(lambda request: next(responses)), patch(
            "app.services.ai_service.asyncio.sleep", new_callable=AsyncMock
        ) as delay:
            result = await analyze_image_with_gemini(sample_poster())
        delay.assert_awaited_once()
        self.assertEqual(result["club_name"], "TEST")

    async def test_missing_configuration(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            async with self.client_class(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    "/process-bills", files={"files": ("poster.png", b"poster", "image/png")}
                )
        self.assertEqual(response.status_code, 503)
        self.assertIn("GEMINI_API_KEY", response.json()["detail"])

    async def test_upload_creates_workbook_without_auth(self):
        def handler(request):
            return httpx.Response(200, json={"candidates": [{
                "content": {"parts": [{"text": '{"club_name":"TEST","event_date":"08-Oct"}'}]}
            }]})

        async with self.client_class(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            with self.mock_provider(handler):
                response = await client.post(
                    "/process-bills",
                    files={"files": ("poster.png", sample_poster(), "image/png")},
                )
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(archive.namelist(), ["TEST.xlsx"])
            with zipfile.ZipFile(io.BytesIO(archive.read("TEST.xlsx"))) as workbook:
                self.assertIn("xl/worksheets/sheet1.xml", workbook.namelist())

    async def test_batch_timeout_cancels_analysis(self):
        cancelled = asyncio.Event()
        async def stalled(*args):
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        with patch("app.main.BATCH_TIMEOUT", 0.01), patch(
            "app.main.analyze_image_with_gemini", stalled
        ):
            async with self.client_class(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    "/process-bills", files={"files": ("poster.png", b"poster", "image/png")}
                )
        self.assertEqual(response.status_code, 504)
        self.assertTrue(cancelled.is_set())

    async def test_analysis_concurrency_is_bounded(self):
        active = 0
        peak = 0
        async def analyze(*args):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1
            return {"club_name": "TEST", "event_date": "08-Oct"}

        with patch("app.main.analyze_image_with_gemini", analyze), patch(
            "app.main.create_excel_with_images", return_value=b"workbook"
        ):
            async with self.client_class(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post("/process-bills", files=[
                    ("files", (f"poster-{index}.png", b"poster", "image/png"))
                    for index in range(4)
                ])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(peak, 2)

    async def test_job_progress_and_repeatable_download(self):
        release = asyncio.Event()
        async def analyze(*args):
            await release.wait()
            return {"club_name": "TEST", "event_date": "08-Oct"}
        async with self.client_class(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            with patch("app.main.analyze_image_with_gemini", analyze), patch(
                "app.main.create_excel_with_images", return_value=b"workbook"
            ):
                response = await client.post(
                    "/jobs", files={"files": ("poster.png", b"poster", "image/png")}
                )
                self.assertEqual(response.status_code, 202)
                job_id = response.json()["id"]
                self.addCleanup(lambda: jobs.pop(job_id, None))
                status = (await client.get(f"/jobs/{job_id}")).json()
                self.assertEqual(status["total"], 1)
                self.assertEqual(status["status"], "processing")
                self.assertEqual((await client.get(f"/jobs/{job_id}/download")).status_code, 409)
                release.set()
                await jobs[job_id]["task"]
                status = (await client.get(f"/jobs/{job_id}")).json()
                self.assertEqual(status["completed"], 1)
                self.assertEqual(status["status"], "ready")
                first = await client.get(f"/jobs/{job_id}/download")
                second = await client.get(f"/jobs/{job_id}/download")
                self.assertEqual(first.status_code, 200)
                self.assertEqual(first.content, second.content)
                self.assertIn("attachment", first.headers["content-disposition"])
                with zipfile.ZipFile(io.BytesIO(first.content)) as archive:
                    self.assertEqual(archive.read("TEST.xlsx"), b"workbook")

    async def test_zip_input_is_rejected_instead_of_silently_skipped(self):
        async with self.client_class(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/jobs", files={"files": ("posters.zip", b"archive", "application/zip")}
            )
        self.assertEqual(response.status_code, 400)

    async def test_batch_with_corrupt_poster_still_downloads_valid_workbook(self):
        def handler(request):
            return httpx.Response(200, json={"candidates": [{
                "content": {"parts": [{"text": '{"club_name":"TEST","event_date":"UNKNOWN_DATE"}'}]}
            }]})
        async with self.client_class(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            with self.mock_provider(handler):
                started = await client.post("/jobs", files=[
                    ("files", ("valid.png", sample_poster(), "image/png")),
                    ("files", ("broken.png", b"broken", "image/png")),
                ])
                job_id = started.json()["id"]
                self.addCleanup(lambda: jobs.pop(job_id, None))
                await jobs[job_id]["task"]
            status = (await client.get(f"/jobs/{job_id}")).json()
            self.assertEqual((status["status"], status["completed"], status["failed"], status["review"]),
                             ("ready", 2, 1, 1))
            downloaded = await client.get(f"/jobs/{job_id}/download")
        with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
            report = archive.read("processing-report.txt").decode()
            self.assertIn("Skipped broken.png", report)
            self.assertIn("Review valid.png", report)
            self.assertIn("TEST.xlsx", archive.namelist())

    async def test_cancelling_a_batch_cancels_inflight_analysis(self):
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def stalled(*args):
            started.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        async with self.client_class(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client, asyncio.timeout(5):
            with patch("app.main.analyze_image_with_gemini", stalled):
                response = await client.post("/jobs", files={"files": ("poster.png", sample_poster(), "image/png")})
                job_id = response.json()["id"]
                self.addCleanup(lambda: jobs.pop(job_id, None))
                await started.wait()
                self.assertEqual((await client.delete(f"/jobs/{job_id}")).status_code, 204)
                self.assertTrue(cancelled.is_set())
            self.assertEqual((await client.get(f"/jobs/{job_id}")).json()["status"], "cancelled")

    def test_safe_workbook_names_and_literal_cells(self):
        rows = [
            {"club_name": club, "date": "=1+1"}
            for club in ("A/B", "AB", "=1+1")
        ]
        with zipfile.ZipFile(io.BytesIO(make_archive(rows, []))) as archive:
            self.assertEqual(archive.namelist(), ["AB.xlsx", "AB (2).xlsx", "11.xlsx"])
            for name in archive.namelist():
                workbook = load_workbook(io.BytesIO(archive.read(name)))
                self.assertEqual(workbook.active["A2"].value, "=1+1")
                self.assertEqual(workbook.active["A2"].data_type, "s")


if __name__ == "__main__":
    unittest.main()
