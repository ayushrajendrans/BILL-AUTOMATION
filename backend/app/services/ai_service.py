import os
import json
import base64
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

import httpx

# (Remove OpenAI client initialization)
# OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# client = OpenAI(...) 

async def analyze_image_with_gemini(image_bytes):
    """
    Sends image to OpenAI GPT-4o on GitHub Models via direct HTTP request.
    """
    try:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print("Error: No API Key found")
            return None

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

        url = "https://models.inference.ai.azure.com/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
            # "api-key": api_key # Some Azure endpoints use this, but GitHub Models uses Bearer
        }

        payload = {
            "model": "gpt-4o",
            "messages": [
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
            "max_tokens": 300,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            
            if response.status_code != 200:
                print(f"Error calling OpenAI (HTTP {response.status_code}): {response.text}")
                return None
            
            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()
            
            # Clean response
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
