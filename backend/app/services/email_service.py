import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def send_login_notification(user_name: str, user_email: str):
    """
    Sends an email notification when a user logs in.
    """
    sender_email = os.getenv("SENDER_EMAIL")
    sender_password = os.getenv("SENDER_PASSWORD")
    receiver_email = os.getenv("RECEIVER_EMAIL")
    smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))

    if not sender_email or not sender_password or not receiver_email:
        logger.warning("Email credentials not set. Skipping notification.")
        return False

    try:
        # Create message
        msg = MIMEMultipart()
        msg["From"] = sender_email
        msg["To"] = receiver_email
        msg["Subject"] = f"New Login Alert: {user_name}"

        body = f"""
        A new user has logged into ClubBill AI.

        Name: {user_name}
        Email: {user_email}
        
        Time: {os.popen('date').read().strip()}
        """
        msg.attach(MIMEText(body, "plain"))

        # Connect to server
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()  # Secure the connection
        server.login(sender_email, sender_password)
        
        # Send email
        server.sendmail(sender_email, receiver_email, msg.as_string())
        server.quit()
        
        logger.info(f"Login notification sent for {user_email}")
        return True

    except Exception as e:
        logger.error(f"Failed to send email notification: {e}")
        return False
