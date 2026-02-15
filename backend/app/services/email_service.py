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
    smtp_port = int(os.getenv("SMTP_PORT", "465"))

    if not sender_email or not sender_password or not receiver_email:
        msg = "Email credentials not set (SENDER_EMAIL, SENDER_PASSWORD, or RECEIVER_EMAIL missing)."
        logger.warning(msg)
        return False, msg

    try:
        # Create message
        msg_container = MIMEMultipart()
        msg_container["From"] = sender_email
        msg_container["To"] = receiver_email
        msg_container["Subject"] = f"New Login Alert: {user_name}"

        body = f"""
        A new user has logged into ClubBill AI.

        Name: {user_name}
        Email: {user_email}
        
        Time: {os.popen('date').read().strip()}
        """
        msg_container.attach(MIMEText(body, "plain"))

        # Use SMTP_SSL for port 465 (more reliable on Render/Cloud)
        server = smtplib.SMTP_SSL(smtp_server, smtp_port)
        # server.starttls() # Not needed for SMTP_SSL
        server.login(sender_email, sender_password)
        
        # Send email
        server.sendmail(sender_email, receiver_email, msg_container.as_string())
        server.quit()
        
        logger.info(f"Login notification sent for {user_email}")
        return True, "Email sent successfully"

    except Exception as e:
        error_msg = f"Failed to send email: {str(e)}"
        logger.error(error_msg)
        return False, error_msg
