from sqlalchemy import Column, BigInteger, Integer, String, Date, Numeric, DateTime
from sqlalchemy.sql import func
from .database import Base


class CallRecord(Base):
    __tablename__ = "call_records"

    id = Column(BigInteger, primary_key=True, index=True)
    call_date = Column(Date, nullable=False, index=True)
    company_name = Column(String(100), index=True)
    company_id = Column(String(20), index=True)
    brand_name = Column(String(200))
    channel_name = Column(String(200))
    # 核心指标
    total_calls = Column(Integer)
    connected_calls = Column(Integer)
    connect_rate = Column(Numeric(8, 4))
    total_duration = Column(Integer)       # 通话总时长(秒)
    call_minutes = Column(Integer)         # 通话分钟数
    avg_duration = Column(Numeric(10, 4))  # 平均通话时长
    # 意向等级
    intent_a = Column(Integer)
    intent_b = Column(Integer)
    intent_c = Column(Integer)
    intent_d = Column(Integer)
    intent_e = Column(Integer)
    intent_f = Column(Integer)
    ab_intent_rate = Column(Numeric(8, 4))
    # 失败原因
    rejected = Column(Integer)
    unreachable = Column(Integer)
    caller_unavailable = Column(Integer)
    empty_number = Column(Integer)
    shutdown = Column(Integer)
    busy = Column(Integer)
    suspended = Column(Integer)
    missed = Column(Integer)
    call_loss = Column(Integer)
    blacklist = Column(Integer)
    intercepted = Column(Integer)
    over_limit = Column(Integer)
    blind_zone = Column(Integer)
    # 结果
    ai_hangup = Column(Integer)
    user_hangup = Column(Integer)
    transferred = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="user")   # admin / user
    created_at = Column(DateTime, server_default=func.now())
