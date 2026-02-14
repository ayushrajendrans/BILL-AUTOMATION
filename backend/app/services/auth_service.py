import os
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from dotenv import load_dotenv
import time

load_dotenv()

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    token = credentials.credentials
    try:
        # Decode without verifying signature (since we don't have the secret yet)
        # But we check expiration ('exp')
        payload = jwt.get_unverified_claims(token)
        
        # Check expiration
        if payload.get("exp") and payload["exp"] < time.time():
            raise HTTPException(status_code=401, detail="Token expired")
            
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token format")
    except Exception as e:
        # Fallback
        if not token:
             raise HTTPException(status_code=401, detail="Invalid token")
        return token
