
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import io
import zipfile
from typing import List
from app.services.ai_service import analyze_image_with_gemini
from app.services.excel_service import create_excel_with_images
# from app.services.auth_service import verify_token # Uncomment when frontend sends token

app = FastAPI(title="ClubBill AI Backend")

# Configure CORS
origins = ["*"] # Allow all for dev, restrict in prod

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/process-bills")
async def process_bills(files: List[UploadFile] = File(...)):
    """
    Accepts multiple image files.
    Extracts data, groups by club, generates Excel files, and zips them.
    """
    
    processed_data = [] # List of {club_name, date, image_bytes}

    # 1. Process each file
    for file in files:
        if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
            continue # Skip non-images for now
        
        content = await file.read()
        
        # Call AI Service
        extraction_result = await analyze_image_with_gemini(content)
        
        if extraction_result:
            club_name = extraction_result.get("club_name", "UNKNOWN_CLUB").upper().strip()
            event_date = extraction_result.get("event_date", "UNKNOWN_DATE")
            
            processed_data.append({
                "club_name": club_name,
                "date": event_date,
                "image_bytes": content
            })
    
    if not processed_data:
        raise HTTPException(status_code=400, detail="No valid data extracted from uploaded files.")

    # 2. Group by Club Name
    clubs_data = {}
    for item in processed_data:
        club = item['club_name']
        if club not in clubs_data:
            clubs_data[club] = []
        clubs_data[club].append(item)

    # 3. Generate Excel files in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for club, items in clubs_data.items():
            excel_bytes = create_excel_with_images(items)
            # Create a safe filename
            safe_club_name = "".join([c for c in club if c.isalnum() or c in (' ', '-', '_')]).strip()
            zip_file.writestr(f"{safe_club_name}.xlsx", excel_bytes)

    zip_buffer.seek(0)

    # 4. Return Zip File
    timestamp = __import__("datetime").datetime.now().strftime("%Y%m%d%H%M%S")
    headers = {
        'Content-Disposition': f'attachment; filename="billing_files_{timestamp}.zip"'
    }
    
    return StreamingResponse(zip_buffer, media_type="application/zip", headers=headers)

@app.get("/")
def read_root():
    return {"message": "ClubBill AI API is running."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
