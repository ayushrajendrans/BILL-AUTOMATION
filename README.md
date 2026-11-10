# ClubBill AI

Automated nightclub billing extraction tool.

## Project Structure

- `frontend/`: Next.js application (billing dashboard).
- `backend/`: FastAPI application (AI Processing & Excel Generation).

## Setup Instructions

### 1. Backend Setup
Use Python 3.12 or later.
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Configuration**:
Create `.env` in `backend/` with:
```env
GEMINI_API_KEY=<your Google AI Studio key>
GEMINI_MODEL=gemini-3.1-flash-lite
```

**Run Server**:
```bash
uvicorn app.main:app --reload
```

Create your key at https://aistudio.google.com/apikey. Gemini 3.1 Flash-Lite
supports poster images and has a rate-limited free tier. Keep your project
on the free tier to avoid paid usage. See https://ai.google.dev/gemini-api/docs/pricing.
The free tier may use submitted content to improve Google's products.
Restart the backend after changing its environment file.

GitHub Models has been retired. Replace legacy `OPENAI_API_KEY` configuration
with a Gemini key in `GEMINI_API_KEY`.

Select your JPG, PNG, or WEBP posters together. Large selections are split into
uploads automatically. The app combines results from all parts into one ZIP,
with a workbook for each club. Each workbook lists the date, club, month, and
poster. Large images are compressed in the browser before upload. If the
server loses an active part, the app retries it once while the page is open.
Keep the page open during processing; refreshing clears the selection and the
download button. It does not delete files you have already downloaded.

If some posters fail, successful ones still appear in the ZIP.
`processing-report.txt` lists skipped posters and any details to review.
The app keeps completed parts in the current page while processing. If a later
part hits a temporary service error or Gemini quota, it keeps completed
results and leaves only the unchecked posters queued. Temporary Gemini outages
and short rate-limit waits can retry automatically. If processing pauses, resume
when Gemini is available or export the posters already processed. ZIP input is
not supported.

The backend spaces Gemini requests at least 5.25 seconds apart, including
retries, to stay below the project's 15 requests-per-minute limit. Large runs
take longer, and the project's daily quota still applies.

### 2. Frontend Setup
```bash
cd frontend
npm ci
```

**Configuration**:
No frontend configuration is needed locally. Requests to `/api` are forwarded
to the backend at `http://127.0.0.1:8000`. Authentication is not required.

For a backend running elsewhere, create `.env.local` in `frontend/` with:
```env
API_URL=https://your-backend.example.com
```

**Run Client**:
```bash
npm run dev
```

## Deployment

1. On [Render](https://dashboard.render.com), deploy the repo as a Blueprint using
   the root `render.yaml`. Set `GEMINI_API_KEY` as a backend secret when prompted.
   For an existing web service, use `backend` as its root directory and match the
   Blueprint's build and start commands.
2. On [Vercel](https://vercel.com), deploy from `main` with `frontend` as the root
   directory. Set the production `API_URL` to the Render web service URL and
   redeploy. The older `NEXT_PUBLIC_API_URL` setting is also accepted.
3. Check the frontend's `/api` path for a healthy backend response, then test
   processing and downloading a sample batch.

Use a single backend instance for batch status and downloads. This app has no
sign-in; keep it on a trusted network.
