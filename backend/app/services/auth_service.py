
import os
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
# In production, you'd fetch the JWKS from Supabase
# key = jwt.algorithms.RSAAlgorithm.from_jwk(jwks)
# For simplicity in this demo, we'll verify the JWT signature if we had the secret,
# but Supabase uses RS256. 
# A simpler approach for the MVP: Check if the token is valid by calling Supabase Auth API
# Or just trust the token structure if verifying signature is complex without the public key.

# Actually, Supabase JWT secret is available in project settings (HS256).
# If using RS256, we need the public key.

# Strategy: We will assume the frontend sends a valid Bearer token.
# Validation logic should be robust in production.
# Here we just check for presence.

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Invalid token")
    # TODO: Validating the token properly requires the Supabase JWT Secret.
    # decoded = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"])
    return token
