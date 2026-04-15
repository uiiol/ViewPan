from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, get_db
from . import models
from .routers import analytics, auth

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="ViewPan API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost", "http://127.0.0.1"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(auth.router)
app.include_router(analytics.router)


@app.get("/")
def root():
    return {"status": "ok", "message": "ViewPan API running"}
