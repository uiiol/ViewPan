from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
import os
import hashlib
import jwt
import datetime
from dotenv import load_dotenv
from pydantic import BaseModel
from ..database import get_db, engine
from ..models import User, Base

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"))

router = APIRouter(prefix="/api/auth", tags=["auth"])

SECRET_KEY = os.getenv("JWT_SECRET", "viewpan-secret-key-change-in-production")
ALGORITHM = "HS256"
EXPIRE_DAYS = 7


def hash_password(pwd: str) -> str:
    return hashlib.sha256(pwd.encode()).hexdigest()


def verify_password(pwd: str, hashed: str) -> bool:
    return hashlib.sha256(pwd.encode()).hexdigest() == hashed


def create_token(username: str, role: str) -> str:
    payload = {
        "sub": username,
        "role": role,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=EXPIRE_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(authorization: str = Header(...), db: Session = Depends(get_db)) -> dict:
    try:
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="无效的 Authorization 格式")
        token = authorization[7:]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        role = payload.get("role")
        if not username:
            raise HTTPException(status_code=401, detail="无效的 Token")
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=401, detail="用户不存在")
        return {"username": username, "role": role}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="无效的 Token")


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_token(user.username, user.role)
    return {
        "token": token,
        "username": user.username,
        "role": user.role,
    }


@router.post("/register")
def register(body: RegisterRequest, _: dict = Depends(require_admin), db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == body.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    return {"username": user.username, "role": user.role}


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    return current_user


@router.get("/users")
def list_users(_: dict = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [
        {"id": u.id, "username": u.username, "role": u.role, "created_at": str(u.created_at)}
        for u in users
    ]


@router.delete("/users/{user_id")
def delete_user(user_id: int, _: dict = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.delete(user)
    db.commit()
    return {"message": "删除成功"}


@router.post("/init-admin")
def init_admin(db: Session = Depends(get_db)):
    """初始化超级管理员（首次部署时调用）"""
    existing = db.query(User).filter(User.role == "admin").first()
    if existing:
        return {"message": "管理员已存在", "username": existing.username}
    admin = User(username="admin", password_hash=hash_password("admin123"), role="admin")
    db.add(admin)
    db.commit()
    return {"message": "管理员创建成功", "username": "admin", "password": "admin123"}
