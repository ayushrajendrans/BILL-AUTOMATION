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
    smtp_port = int(os.getenv("SMTP_PORT", "465")) # SSL port
    import socket # Ensure socket is imported

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

        print(f"Resolving {smtp_server} (IPv4)...")
        # Force IPv4 resolution
        addr_info = socket.getaddrinfo(smtp_server, smtp_port, family=socket.AF_INET, proto=socket.IPPROTO_TCP)
        smtp_ip = addr_info[0][4][0]
        print(f"Resolved to {smtp_ip}. Connecting to Port {smtp_port} (SSL)...")

        # Connect using SMTP_SSL for Port 465
        server = smtplib.SMTP_SSL(smtp_ip, smtp_port, timeout=15)
        
        print("Connected. Logging in...")
        server.login(sender_email, sender_password)
        
        print("Sending mail...")
        server.sendmail(sender_email, receiver_email, msg_container.as_string())
        server.quit()
        
        print(f"Login notification sent for {user_email}")
        return True, "Email sent successfully"

    except Exception as e:
        error_msg = f"Failed to send email: {str(e)}"
        print(error_msg) # Print to stdout to ensure visibility in Render logs
        logger.error(error_msg)
        return False, error_msg
