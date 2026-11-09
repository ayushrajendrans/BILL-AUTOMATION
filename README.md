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

Existing GitHub Models setups can still use `OPENAI_API_KEY`. When
`GEMINI_API_KEY` is set, Gemini is used instead.

Select up to 50 JPG, PNG, or WEBP posters (95 MB total). Uploads create a
background batch with progress and cancellation. Refreshing restores the last
batch in that browser tab. When processing finishes, click Download Excel ZIP.

If some posters fail, successful ones still appear in the ZIP.
`processing-report.txt` lists skipped posters and any details to review.
The latest 20 batches are retained for up to one hour while the backend is
running. Restarting the backend clears the batches. ZIP input is not supported.

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
