"""
Create the initial superadmin account.
Run once after first migration:
  python seed.py
"""

from dotenv import load_dotenv
load_dotenv()

from app import create_app
from app.extensions import db
from app.models import User, UserRole

app = create_app()

with app.app_context():
    existing = User.query.filter_by(role=UserRole.SUPERADMIN).first()
    if existing:
        print(f"Superadmin already exists: {existing.email}")
    else:
        email = input("Superadmin email: ").strip()
        password = input("Superadmin password: ").strip()
        if len(password) < 8:
            print("Password must be at least 8 characters.")
            exit(1)
        user = User(email=email, role=UserRole.SUPERADMIN)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        print(f"Superadmin created: {email}")
