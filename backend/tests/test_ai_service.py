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

from app.main import Poster, app, build_bills, jobs, make_archive
from app.services.ai_service import AnalysisError, RequestPacer, analyze_image, analyze_image_with_gemini


def sample_poster(size=(20, 20)):
    image = io.BytesIO()
    Image.new("RGB", size, "white").save(image, format="PNG")
    return image.getvalue()


class GeminiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "GEMINI_API_KEY": "test-key",
            "GOOGLE_API_KEY": "",
            "GEMINI_MODEL": "gemini-3.1-flash-lite",
            "CLOUDFLARE_ACCOUNT_ID": "",
            "CLOUDFLARE_API_TOKEN": "",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        pacer = patch("app.services.ai_service.request_pacer")
        self.request_pacer = pacer.start()
        self.request_pacer.wait = AsyncMock()
        self.addCleanup(pacer.stop)
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

    async def test_gemini_quota_routes_pending_posters_to_cloudflare_until_cooldown(self):
        hosts = []
        now = 1000
        expected = {"club_name": "TEST", "event_date": "08-Oct", "event_month": "October"}

        def handler(request):
            hosts.append(request.url.host)
            if request.url.host == "generativelanguage.googleapis.com":
                if now == 1000:
                    return httpx.Response(429)
                return httpx.Response(200, json={"candidates": [{
                    "content": {"parts": [{"text": json.dumps(expected)}]}
                }]})
            self.assertTrue(request.url.path.endswith("/account-id/ai/run/@cf/google/gemma-4-26b-a4b-it"))
            self.assertEqual(request.headers["Authorization"], "Bearer test-token")
            self.assertNotIn("x-goog-api-key", request.headers)
            payload = json.loads(request.content)
            uri = payload["messages"][0]["content"][1]["image_url"]["url"]
            self.assertTrue(uri.startswith("data:image/jpeg;base64,"))
            with Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1]))) as image:
                self.assertEqual(image.format, "JPEG")
            return httpx.Response(200, json={"success": True, "result": {"response": json.dumps(expected)}})

        with self.mock_provider(handler), patch.dict(os.environ, {
            "CLOUDFLARE_ACCOUNT_ID": "account-id",
            "CLOUDFLARE_API_TOKEN": "test-token",
        }), patch("app.services.ai_service.monotonic", lambda: now), patch(
            "app.services.ai_service.gemini_unavailable_until", 0.0
        ):
            self.assertEqual(await analyze_image(sample_poster()), expected)
            self.assertEqual(await analyze_image(sample_poster()), expected)
            now = 1301
            self.assertEqual(await analyze_image(sample_poster()), expected)
        self.assertEqual(hosts, [
            "generativelanguage.googleapis.com", "api.cloudflare.com", "api.cloudflare.com",
            "generativelanguage.googleapis.com",
        ])

    async def test_cloudflare_only_distinguishes_daily_limit_from_capacity(self):
        def handler(request):
            self.assertEqual(request.url.host, "api.cloudflare.com")
            return httpx.Response(429, json={"success": False, "errors": [{"code": code}]})

        with self.mock_provider(handler), patch.dict(os.environ, {
            "GEMINI_API_KEY": "",
            "CLOUDFLARE_ACCOUNT_ID": "account-id",
            "CLOUDFLARE_API_TOKEN": "test-token",
        }):
            for code, retry_after in ((3036, None), (3040, 25)):
                with self.subTest(code=code), self.assertRaises(AnalysisError) as raised:
                    await analyze_image(sample_poster())
                self.assertEqual(raised.exception.status_code, 429)
                self.assertEqual(raised.exception.retry_after, retry_after)

    async def test_only_short_rate_limits_offer_automatic_retry(self):
        info = {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "2.4s"}
        daily = {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [
            {"quotaId": "GenerateRequestsPerDayPerProject"}
        ]}
        for details, expected in (([info], 3), ([info, daily], None)):
            with self.mock_provider(lambda request: httpx.Response(429, json={
                "error": {"details": details}
            })):
                with self.assertRaises(AnalysisError) as raised:
                    await analyze_image_with_gemini(sample_poster())
            self.assertEqual(raised.exception.retry_after, expected)

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

    async def test_transient_provider_errors_recover_with_backoff(self):
        responses = iter([httpx.Response(503), httpx.Response(504), httpx.Response(200, json={"candidates": [{
            "content": {"parts": [{"text": '{"club_name":"TEST","event_date":"08-Oct"}'}]}
        }]})])
        with self.mock_provider(lambda request: next(responses)), patch(
            "app.services.ai_service.asyncio.sleep", new_callable=AsyncMock
        ) as delay:
            result = await analyze_image_with_gemini(sample_poster())
        self.assertEqual([call.args for call in delay.await_args_list], [(6,), (16,)])
        self.assertEqual(self.request_pacer.wait.await_count, 3)
        self.assertEqual(result["club_name"], "TEST")

    async def test_persistent_outage_gives_the_batch_a_bounded_cooldown(self):
        with self.mock_provider(lambda request: httpx.Response(503)), patch(
            "app.services.ai_service.asyncio.sleep", new_callable=AsyncMock
        ), self.assertLogs("uvicorn.error", level="WARNING"):
            with self.assertRaises(AnalysisError) as raised:
                await analyze_image_with_gemini(sample_poster())
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.retry_after, 25)
        self.assertIn("HTTP 503", str(raised.exception))
        self.assertEqual(self.request_pacer.wait.await_count, 3)

    async def test_outage_retries_only_pending_posters_unless_daily_quota_blocks(self):
        image = sample_poster()
        posters = [Poster(f"poster-{i}.png", "image/png", image) for i in range(3)]
        for second_error, expected_wait, expected_message in (
            (AnalysisError("Short rate limit", 429, retry_after=5), 25, "Gemini unavailable"),
            (AnalysisError("Daily quota exhausted", 429), None, "Daily quota exhausted"),
        ):
            with self.subTest(expected_wait=expected_wait), patch(
                "app.main.analyze_image", side_effect=[
                    {"club_name": "TEST", "event_date": "08-Oct"},
                    AnalysisError("Gemini unavailable", 503, retry_after=25),
                    second_error,
                ],
            ):
                result = await build_bills(posters, thumbnail_only=True)
                self.assertEqual(len(result.rows), 1)
                self.assertEqual(result.retry_indices, [1, 2])
                self.assertEqual(result.retry_after, expected_wait)
                self.assertEqual(result.retry_message, expected_message)

    async def test_missing_configuration(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "OPENAI_API_KEY": "retired-provider-key"}):
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
            "app.main.analyze_image", stalled
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

        with patch("app.main.analyze_image", analyze), patch(
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
            with patch("app.main.analyze_image", analyze), patch(
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
            with patch("app.main.analyze_image", stalled):
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

    async def test_combined_export_groups_clubs_across_parts_and_server_restart(self):
        analyze = AsyncMock(side_effect=[
            {"club_name": " North  Club ", "event_date": "08-Oct", "event_month": "September"},
            {"club_name": "South Club", "event_date": "UNKNOWN_DATE", "event_month": "November"},
            {"club_name": "north club", "event_date": "12-Nov", "event_month": "November"},
        ])
        async with self.client_class(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client, asyncio.timeout(5):
            parts = []
            with patch("app.main.analyze_image", analyze):
                for count in (2, 1):
                    response = await client.post("/jobs", data={"extract_only": "true"}, files=[
                        ("files", (f"poster-{index}.png", sample_poster(), "image/png"))
                        for index in range(count)
                    ])
                    self.assertEqual(response.status_code, 202)
                    job_id = response.json()["id"]
                    self.addCleanup(lambda job_id=job_id: jobs.pop(job_id, None))
                    await jobs[job_id]["task"]
                    result = await client.get(f"/jobs/{job_id}/results")
                    self.assertEqual(result.status_code, 200)
                    parts.append(result.json())
                    # Simulate losing all server-side state for this completed part.
                    jobs.pop(job_id)
            response = await client.post("/exports", json={
                "rows": [row for part in parts for row in part["rows"]],
                "notes": [note for part in parts for note in part["notes"]],
            })
        self.assertEqual(response.status_code, 200, response.text if not response.is_success else "")
        self.assertEqual(analyze.await_count, 3)
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(set(archive.namelist()), {"NORTH CLUB.xlsx", "SOUTH CLUB.xlsx", "processing-report.txt"})
            north = load_workbook(io.BytesIO(archive.read("NORTH CLUB.xlsx"))).active
            south = load_workbook(io.BytesIO(archive.read("SOUTH CLUB.xlsx"))).active
            self.assertEqual(list(north.values), [
                ("Date", "Club Name", "Month", "Poster Image"),
                ("08-Oct", "NORTH CLUB", "October", None),
                ("12-Nov", "NORTH CLUB", "November", None),
            ])
            self.assertEqual(list(south.values)[1], ("UNKNOWN_DATE", "SOUTH CLUB", "November", None))
            self.assertEqual(len(north._images), 2)
            self.assertEqual(len(south._images), 1)

    async def test_export_rejects_invalid_thumbnail(self):
        async with self.client_class(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/exports", json={
                "rows": [{"club_name": "TEST", "date": "08-Oct", "thumbnail": "not base64"}]
            })
        self.assertEqual(response.status_code, 422)

    async def test_partial_quota_failure_keeps_successful_rows_and_returns_pending_indices(self):
        analyze = AsyncMock(side_effect=[
            {"club_name": "North Club", "event_date": "08-Oct"},
            AnalysisError("Temporary quota limit", 429, retry_after=5),
        ])
        async with self.client_class(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client, asyncio.timeout(5):
            with patch("app.main.analyze_image", analyze):
                response = await client.post("/jobs", data={"extract_only": "true"}, files=[
                    ("files", (f"poster-{index}.png", sample_poster(), "image/png"))
                    for index in range(3)
                ])
                self.assertEqual(response.status_code, 202)
                job_id = response.json()["id"]
                self.addCleanup(lambda: jobs.pop(job_id, None))
                await jobs[job_id]["task"]
            data = (await client.get(f"/jobs/{job_id}/results")).json()
            status = (await client.get(f"/jobs/{job_id}")).json()
        self.assertEqual(len(data["rows"]), 1)
        self.assertEqual(data["retry_indices"], [1, 2])
        self.assertEqual(data["retry_after"], 5)
        self.assertEqual(status["failed"], 0)
        self.assertEqual(analyze.await_count, 2)


class RequestPacerTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_requests_share_the_same_rate_budget(self):
        pacer = RequestPacer(5.25)
        now = 0.0
        dispatched = []
        yield_control = asyncio.sleep

        async def advance(seconds):
            nonlocal now
            await yield_control(0)
            now += seconds

        async def request():
            await pacer.wait()
            dispatched.append(now)

        with patch("app.services.ai_service.monotonic", lambda: now), patch(
            "app.services.ai_service.asyncio.sleep", advance
        ):
            await asyncio.gather(*(request() for _ in range(30)))
        self.assertEqual(len(dispatched), 30)
        self.assertTrue(all(b - a >= 5.25 for a, b in zip(dispatched, dispatched[1:])))
        self.assertTrue(all(
            sum(start <= stamp < start + 60 for stamp in dispatched) <= 12 for start in dispatched
        ))


if __name__ == "__main__":
    unittest.main()
