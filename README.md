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
uploads automatically, and each completed part has a ZIP download. An image
larger than one upload is resized in the browser. If the server loses an active
part while the selected files are still open, the browser retries that part once.
Refreshing restores the active part and checks completed download links in that
tab; any files not yet sent need to be selected again.

If some posters fail, successful ones still appear in the ZIP.
`processing-report.txt` lists skipped posters and any details to review.
The backend retains the latest 20 batches for up to one hour. The browser also
keeps copies of completed ZIPs for up to 24 hours when local storage is available,
so a backend restart does not remove those downloads. Missing links are removed
on refresh. ZIP input is not supported.

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
