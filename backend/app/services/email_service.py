import os
import json
import logging
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"

def send_login_notification(user_name: str, user_email: str):
    """
    Sends an email notification when a user logs in, using Resend HTTP API.
    """
    api_key = os.getenv("RESEND_API_KEY")
    receiver_email = os.getenv("RECEIVER_EMAIL")

    if not api_key or not receiver_email:
        msg = "Email config missing (RESEND_API_KEY or RECEIVER_EMAIL not set)."
        logger.warning(msg)
        return False, msg

    try:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")

        payload = json.dumps({
            "from": "ClubBill AI <onboarding@resend.dev>",
            "to": [receiver_email],
            "subject": f"New Login Alert: {user_name}",
            "html": f"""
                <h2>🔔 New Login Alert</h2>
                <p>A user has logged into <b>ClubBill AI</b>.</p>
                <table style="border-collapse:collapse;">
                    <tr><td style="padding:4px 12px;"><b>Name</b></td><td>{user_name}</td></tr>
                    <tr><td style="padding:4px 12px;"><b>Email</b></td><td>{user_email}</td></tr>
                    <tr><td style="padding:4px 12px;"><b>Time</b></td><td>{now}</td></tr>
                </table>
            """
        }).encode("utf-8")

        req = Request(RESEND_API_URL, data=payload, method="POST")
        req.add_header("Authorization", f"Bearer {api_key}")
        req.add_header("Content-Type", "application/json")

        print(f"Sending login notification via Resend for {user_email}...")

        with urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode())
            print(f"Email sent successfully. Resend ID: {result.get('id')}")
            return True, "Email sent successfully"

    except HTTPError as e:
        body = e.read().decode()
        error_msg = f"Resend API error ({e.code}): {body}"
        print(error_msg)
        logger.error(error_msg)
        return False, error_msg
    except URLError as e:
        error_msg = f"Network error sending email: {str(e)}"
        print(error_msg)
        logger.error(error_msg)
        return False, error_msg
    except Exception as e:
        error_msg = f"Failed to send email: {str(e)}"
        print(error_msg)
        logger.error(error_msg)
        return False, error_msg
