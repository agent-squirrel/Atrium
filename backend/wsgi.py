from dotenv import load_dotenv
load_dotenv()

from app import create_app  # noqa: E402

_BANNER = """
\033[38;5;25m  ◆  \033[1;37mAtrium\033[0m
\033[38;5;60m     Multi-tenant captive portal\033[0m
"""

print(_BANNER)

app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
