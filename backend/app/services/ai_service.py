import os
import json
import base64
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# Configure OpenAI (using GitHub Models endpoint)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(
    api_key=OPENAI_API_KEY,
    base_url="https://models.inference.ai.azure.com"
)

def analyze_image_with_gemini(image_bytes):
    """
    Sends image to OpenAI GPT-4o to extract Club Name and Date.
    (Function name kept for compatibility, but uses OpenAI now).
    """
    try:
        # Convert bytes to base64
        base64_image = base64.b64encode(image_bytes).decode('utf-8')

        prompt = """
        You are an expert data extraction AI. 
        Extract 'club_name' and 'event_date' from the nightclub poster. 
        
        Rules:
        1. Extract the CORE 'club_name' only. 
           - Remove generic suffixes like 'Club', 'Lounge', 'Bar', 'Disco', 'Nightclub' unless they are integral to the core brand.
           - Example: 'The Tunnel Lounge Club' -> 'THE TUNNEL'.
           - Example: 'Club X' -> 'CLUB X'.
           - Output must be uppercase.
        2. Extract the date and normalize it to 'DD-MMM' format (e.g., 15-Jan). 
           If year is missing, assume current year or next occurrence.
        3. Return valid JSON only. Do not include markdown formatting like ```json.
        
        Output format:
        {
          "club_name": "THE TUNNEL",
          "event_date": "15-Jan"
        }
        """

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            },
                        },
                    ],
                }
            ],
            max_tokens=300,
        )
        
        # Clean response
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:-3].strip()
        elif content.startswith("```"):
            content = content[3:-3].strip()
            
        return json.loads(content)

    except Exception as e:
        import traceback
        print(f"Error calling OpenAI: {e}")
        traceback.print_exc()
        return None
