import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Docker 环境下使用 IS_DOCKER=1 切换连接地址
if os.getenv("IS_DOCKER") == "1":
    DATABASE_URL = "postgresql+psycopg2://aobuy@host.docker.internal:5432/viewpan"
else:
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://aobuy@localhost/viewpan")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
