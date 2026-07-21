"""Outbound SMTP mail. Single entry point: send_email(). Raises on failure -
callers decide whether that should surface to the user or just be logged."""
import smtplib
from email.message import EmailMessage

from app.models import EmailSettings, EmailEncryption


class MailerNotConfigured(Exception):
    pass


def send_email(to: str, subject: str, body: str) -> None:
    settings = EmailSettings.get_or_create()
    if not settings.enabled or not settings.smtp_host or not settings.from_address:
        raise MailerNotConfigured("Email sending is not configured.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{settings.from_name} <{settings.from_address}>" if settings.from_name else settings.from_address
    msg["To"] = to
    msg.set_content(body)

    port = settings.smtp_port or (465 if settings.encryption == EmailEncryption.SSL else 587)

    if settings.encryption == EmailEncryption.SSL:
        smtp_cls = smtplib.SMTP_SSL
    else:
        smtp_cls = smtplib.SMTP

    with smtp_cls(settings.smtp_host, port, timeout=10) as smtp:
        if settings.encryption == EmailEncryption.STARTTLS:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)
