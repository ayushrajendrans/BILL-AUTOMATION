# ClubBill AI

Automated nightclub billing extraction tool.

## Project Structure

- `frontend/`: Next.js 14 application (SaaS Dashboard).
- `backend/`: FastAPI application (AI Processing & Excel Generation).

## Setup Instructions

### 1. Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Configuration**:
Create `.env` in `backend/` with:
```env
OPENAI_API_KEY=sk-...
SUPABASE_URL=...
SUPABASE_KEY=...
```

**Run Server**:
```bash
uvicorn app.main:app --reload
```

### 2. Frontend Setup
```bash
cd frontend
npm install
```

**Configuration**:
Create `.env.local` in `frontend/` with:
```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Run Client**:
```bash
npm run dev
```

## Deployment

- **Frontend**: Deploy to [Vercel](https://vercel.com).
- **Backend**: Deploy to [Render](https://render.com) or [Railway](https://railway.app).
