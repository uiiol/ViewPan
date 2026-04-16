from fastapi import APIRouter, Depends, Query, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, and_, text
from typing import Optional
from datetime import date
import os
import httpx
import pandas as pd
from pydantic import BaseModel
from dotenv import load_dotenv
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from app.routers.auth import get_current_user
from app.database import get_db
from app.models import CallRecord

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"))

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class AiAnalysisRequest(BaseModel):
    company_name: str
    channel_name: str
    overview: dict
    monthly_data: list
    user_analysis: str = ""
    ranking_metric: str = "call_minutes"


def _build_base_filter(year: int, month: Optional[int], company_id: Optional[str],
                       channel_name: Optional[str], start_date: Optional[str], end_date: Optional[str]):
    cond = []
    if year:
        cond.append(extract("year", CallRecord.call_date) == year)
    if month:
        cond.append(extract("month", CallRecord.call_date) == month)
    if company_id:
        cond.append(CallRecord.company_id == company_id)
    if channel_name:
        cond.append(CallRecord.channel_name == channel_name)
    if start_date:
        cond.append(CallRecord.call_date >= start_date)
    if end_date:
        cond.append(CallRecord.call_date <= end_date)
    return cond


@router.get("/overview")
def get_overview(
    year: int = Query(2025),
    company_id: Optional[str] = Query(None),
    channel_name: Optional[str] = Query(None),
    quarter: Optional[str] = Query(None),
    month: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    quarter_map = {"Q1": (1, 3), "Q2": (4, 6), "Q3": (7, 9), "Q4": (10, 12), "H1": (1, 6), "H2": (7, 12)}
    cond = [extract("year", CallRecord.call_date) == year]
    if quarter and quarter in quarter_map:
        m_start, m_end = quarter_map[quarter]
        cond.append(extract("month", CallRecord.call_date) >= m_start)
        cond.append(extract("month", CallRecord.call_date) <= m_end)
    elif month:
        cond.append(extract("month", CallRecord.call_date) == month)
    if company_id:
        cond.append(CallRecord.company_id == company_id)
    if channel_name:
        cond.append(CallRecord.channel_name == channel_name)
    q = db.query(
        func.sum(CallRecord.total_calls).label("total_calls"),
        func.sum(CallRecord.connected_calls).label("connected_calls"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
        func.sum(CallRecord.intent_a + CallRecord.intent_b).label("ab_intent"),
        func.avg(CallRecord.connect_rate).label("avg_connect_rate"),
    ).filter(and_(*cond))
    return q.first()._asdict()


@router.get("/trend/monthly")
def get_monthly_trend(
    year: int = Query(2025),
    company_id: Optional[str] = Query(None),
    channel_name: Optional[str] = Query(None),
    quarter: Optional[str] = Query(None, description="季度: Q1/Q2/Q3/Q4"),
    month: Optional[int] = Query(None, description="指定月份 1-12"),
    compare_year: Optional[int] = Query(None, description="同比年份，如传入则返回当年与该年同月的同比数据"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    quarter_map = {"Q1": (1, 3), "Q2": (4, 6), "Q3": (7, 9), "Q4": (10, 12), "H1": (1, 6), "H2": (7, 12)}
    cond = [extract("year", CallRecord.call_date) == year]
    if quarter and quarter in quarter_map:
        m_start, m_end = quarter_map[quarter]
        cond.append(extract("month", CallRecord.call_date) >= m_start)
        cond.append(extract("month", CallRecord.call_date) <= m_end)
    elif month:
        cond.append(extract("month", CallRecord.call_date) == month)
    if company_id:
        cond.append(CallRecord.company_id == company_id)
    if channel_name:
        cond.append(CallRecord.channel_name == channel_name)
    q = db.query(
        extract("month", CallRecord.call_date).label("month"),
        func.sum(CallRecord.total_calls).label("total_calls"),
        func.sum(CallRecord.connected_calls).label("connected_calls"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
        func.avg(CallRecord.connect_rate).label("avg_connect_rate"),
        (func.sum(CallRecord.intent_a + CallRecord.intent_b) * 1.0 / func.nullif(func.sum(CallRecord.connected_calls), 0)).label("intent_rate"),
    ).filter(and_(*cond)).group_by("month").order_by("month")
    rows = [row._asdict() for row in q.all()]

    # 同比数据
    if compare_year:
        prev_cond = [extract("year", CallRecord.call_date) == compare_year]
        if quarter and quarter in quarter_map:
            prev_cond.append(extract("month", CallRecord.call_date) >= m_start)
            prev_cond.append(extract("month", CallRecord.call_date) <= m_end)
        elif month:
            prev_cond.append(extract("month", CallRecord.call_date) == month)
        if company_id:
            prev_cond.append(CallRecord.company_id == company_id)
        if channel_name:
            prev_cond.append(CallRecord.channel_name == channel_name)
        prev_q = db.query(
            extract("month", CallRecord.call_date).label("month"),
            func.sum(CallRecord.total_calls).label("total_calls"),
            func.sum(CallRecord.connected_calls).label("connected_calls"),
            func.sum(CallRecord.call_minutes).label("call_minutes"),
            func.avg(CallRecord.connect_rate).label("avg_connect_rate"),
            (func.sum(CallRecord.intent_a + CallRecord.intent_b) * 1.0 / func.nullif(func.sum(CallRecord.connected_calls), 0)).label("intent_rate"),
        ).filter(and_(*prev_cond)).group_by("month").order_by("month")
        prev_map = {int(row.month): row._asdict() for row in prev_q.all()}
        for row in rows:
            m = int(row["month"])
            if m in prev_map:
                row["prev_total_calls"] = prev_map[m]["total_calls"]
                row["prev_call_minutes"] = prev_map[m]["call_minutes"]
                row["prev_avg_connect_rate"] = prev_map[m]["avg_connect_rate"]
                row["prev_intent_rate"] = prev_map[m]["intent_rate"]

    return rows


@router.get("/trend/daily")
def get_daily_trend(
    year: int = Query(2025),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    company_id: Optional[str] = Query(None),
    channel_name: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cond = []
    if start_date:
        cond.append(CallRecord.call_date >= start_date)
    if end_date:
        cond.append(CallRecord.call_date <= end_date)
    if not start_date and not end_date:
        cond.append(extract("year", CallRecord.call_date) == year)
    if company_id:
        cond.append(CallRecord.company_id == company_id)
    if channel_name:
        cond.append(CallRecord.channel_name == channel_name)
    q = db.query(
        CallRecord.call_date,
        func.sum(CallRecord.total_calls).label("total_calls"),
        func.sum(CallRecord.connected_calls).label("connected_calls"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
        func.avg(CallRecord.connect_rate).label("avg_connect_rate"),
        (func.sum(CallRecord.intent_a + CallRecord.intent_b) * 1.0 / func.nullif(func.sum(CallRecord.connected_calls), 0)).label("intent_rate"),
    ).filter(and_(*cond)).group_by(CallRecord.call_date).order_by(CallRecord.call_date)
    return [{
        "date": str(row.call_date),
        "total_calls": row.total_calls,
        "connected_calls": row.connected_calls,
        "call_minutes": row.call_minutes,
        "avg_connect_rate": row.avg_connect_rate,
        "intent_rate": row.intent_rate,
    } for row in q.all()]


@router.get("/companies")
def get_companies(
    channel_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(CallRecord.company_id, CallRecord.company_name)
    if channel_name:
        q = q.filter(CallRecord.channel_name == channel_name)
    rows = q.distinct().order_by(CallRecord.company_name).all()
    return [{"id": r.company_id, "name": r.company_name} for r in rows]


@router.get("/channels")
def get_channels(db: Session = Depends(get_db)):
    rows = db.query(CallRecord.channel_name).distinct().order_by(CallRecord.channel_name).all()
    return [{"name": r.channel_name} for r in rows if r.channel_name]


@router.get("/companies/ranking")
def get_company_ranking(
    year: int = Query(2025),
    channel_name: Optional[str] = Query(None),
    quarter: Optional[str] = Query(None),
    month: Optional[int] = Query(None),
    metric: str = Query("call_minutes"),
    limit: int = Query(20),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    compare_year: Optional[int] = Query(None),
    sort_by_growth: Optional[str] = Query(None, description="growth_desc|shrink_desc 按增长率排序"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    sort_by_growth:
      - 'growth_desc' = 增长最快（增长率正序排，高的在前）
      - 'shrink_desc' = 萎缩最大（增长率负序排，降幅大的在前）
      - None = 按 metric 原始值排序
    """
    quarter_map = {"Q1": (1, 3), "Q2": (4, 6), "Q3": (7, 9), "Q4": (10, 12), "H1": (1, 6), "H2": (7, 12)}
    metric_col = {
        "call_minutes": func.sum(CallRecord.call_minutes),
        "total_calls": func.sum(CallRecord.total_calls),
        "connected_calls": func.sum(CallRecord.connected_calls),
    }.get(metric, func.sum(CallRecord.call_minutes))

    def _build_cond(yr, ch_name=None, q=None, m=None, sd=None, ed=None):
        c = [extract("year", CallRecord.call_date) == yr]
        if q and q in quarter_map:
            ms, me = quarter_map[q]
            c.append(extract("month", CallRecord.call_date) >= ms)
            c.append(extract("month", CallRecord.call_date) <= me)
        elif m:
            c.append(extract("month", CallRecord.call_date) == m)
        elif sd:
            c.append(CallRecord.call_date >= sd)
            if ed:
                c.append(CallRecord.call_date <= ed)
        if ch_name:
            c.append(CallRecord.channel_name == ch_name)
        return c

    cond = _build_cond(year, channel_name, quarter, month, start_date, end_date)

    q = db.query(
        CallRecord.company_id, CallRecord.company_name,
        func.sum(CallRecord.total_calls).label("total_calls"),
        func.sum(CallRecord.connected_calls).label("connected_calls"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
        func.avg(CallRecord.connect_rate).label("avg_connect_rate"),
        func.sum(CallRecord.intent_a + CallRecord.intent_b).label("ab_intent"),
        func.max(CallRecord.channel_name).label("channel_name"),
    ).filter(and_(*cond)).group_by(CallRecord.company_id, CallRecord.company_name)

    if sort_by_growth:
        q = q.order_by(metric_col.desc())
    else:
        q = q.order_by(metric_col.desc())
    rows = q.all() if limit == 0 else q.limit(limit).all()

    # 如果需要增长率排序，查去年同期数据
    prev_metric_key = f"prev_{metric}"
    use_growth = sort_by_growth in ("growth_desc", "shrink_desc")
    # custom date range 时也用去年同周期做对比
    prev_year_for_compare = compare_year if compare_year else (year - 1 if not (quarter or month) else None)

    # 预查去年同期（仅当使用增长率排序时）
    prev_data_map = {}
    if use_growth and prev_year_for_compare:
        prev_cond = _build_cond(prev_year_for_compare, channel_name, quarter, month, start_date, end_date)
        prev_q = db.query(
            CallRecord.company_id,
            func.sum(CallRecord.total_calls).label("total_calls"),
            func.sum(CallRecord.connected_calls).label("connected_calls"),
            func.sum(CallRecord.call_minutes).label("call_minutes"),
        ).filter(and_(*prev_cond)).group_by(CallRecord.company_id)
        for row in prev_q.all():
            prev_data_map[row.company_id] = row._asdict()

    result = []
    for row in rows:
        d = row._asdict()
        if d["connected_calls"] and d["connected_calls"] > 0:
            d["intent_rate"] = round(d["ab_intent"] / d["connected_calls"], 6)
        else:
            d["intent_rate"] = None

        # 去年同期数据
        prev = prev_data_map.get(row.company_id, {})
        d[prev_metric_key] = prev.get(metric) if prev else None

        # 增长率
        curr_val = d.get(metric)
        prev_val = d[prev_metric_key]
        if curr_val and prev_val and prev_val != 0:
            d["growth_rate"] = (curr_val - prev_val) / prev_val
        elif curr_val and not prev_val:
            d["growth_rate"] = None  # 新客户无同期数据
        else:
            d["growth_rate"] = None

        result.append(d)

    # 增长率排序
    if sort_by_growth == "growth_desc":
        result.sort(key=lambda x: (x["growth_rate"] is not None, x["growth_rate"] or 0), reverse=True)
    elif sort_by_growth == "shrink_desc":
        result.sort(key=lambda x: (x["growth_rate"] is not None, x["growth_rate"] or 0))

    return result if limit == 0 else result[:limit]


@router.get("/channels/overview")
def get_channel_overview(
    year: int = Query(2025),
    quarter: Optional[str] = Query(None),
    month: Optional[int] = Query(None),
    channel_name: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    quarter_map = {"Q1": (1, 3), "Q2": (4, 6), "Q3": (7, 9), "Q4": (10, 12), "H1": (1, 6), "H2": (7, 12)}
    cond = [extract("year", CallRecord.call_date) == year]
    if quarter and quarter in quarter_map:
        m_start, m_end = quarter_map[quarter]
        cond.append(extract("month", CallRecord.call_date) >= m_start)
        cond.append(extract("month", CallRecord.call_date) <= m_end)
    elif month:
        cond.append(extract("month", CallRecord.call_date) == month)
    if channel_name:
        cond.append(CallRecord.channel_name == channel_name)
    q = db.query(
        func.sum(CallRecord.total_calls).label("total_calls"),
        func.sum(CallRecord.connected_calls).label("connected_calls"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
        func.sum(CallRecord.intent_a + CallRecord.intent_b).label("ab_intent"),
        func.avg(CallRecord.connect_rate).label("avg_connect_rate"),
    ).filter(and_(*cond))
    return q.first()._asdict()


@router.get("/channels/ranking")
def get_channel_ranking(
    year: int = Query(2025),
    quarter: Optional[str] = Query(None),
    month: Optional[int] = Query(None),
    metric: str = Query("call_minutes"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    quarter_map = {"Q1": (1, 3), "Q2": (4, 6), "Q3": (7, 9), "Q4": (10, 12), "H1": (1, 6), "H2": (7, 12)}
    metric_col = {
        "call_minutes": func.sum(CallRecord.call_minutes),
        "total_calls": func.sum(CallRecord.total_calls),
        "connected_calls": func.sum(CallRecord.connected_calls),
    }.get(metric, func.sum(CallRecord.call_minutes))
    cond = [extract("year", CallRecord.call_date) == year]
    if quarter and quarter in quarter_map:
        m_start, m_end = quarter_map[quarter]
        cond.append(extract("month", CallRecord.call_date) >= m_start)
        cond.append(extract("month", CallRecord.call_date) <= m_end)
    elif month:
        cond.append(extract("month", CallRecord.call_date) == month)
    elif start_date:
        cond.append(CallRecord.call_date >= start_date)
        if end_date:
            cond.append(CallRecord.call_date <= end_date)
    q = db.query(
        CallRecord.channel_name,
        func.sum(CallRecord.total_calls).label("total_calls"),
        func.sum(CallRecord.connected_calls).label("connected_calls"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
        func.avg(CallRecord.connect_rate).label("avg_connect_rate"),
        func.sum(CallRecord.intent_a + CallRecord.intent_b).label("ab_intent"),
    ).filter(and_(*cond)).group_by(CallRecord.channel_name)
    q = q.order_by(metric_col.desc())
    rows = q.all()
    result = []
    for row in rows:
        d = row._asdict()
        if d["connected_calls"] and d["connected_calls"] > 0:
            d["intent_rate"] = round(d["ab_intent"] / d["connected_calls"], 6)
        else:
            d["intent_rate"] = None
        result.append(d)
    return result


@router.get("/dashboard/summary")
def get_dashboard_summary(
    year: int = Query(2026),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """数据大盘汇总：目标完成进度、新老客户、渠道分布"""
    # 今年各月分钟数（先查出来决定哪些月份算YTD）
    monthly_q = db.query(
        extract("month", CallRecord.call_date).label("month"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
    ).filter(extract("year", CallRecord.call_date) == year) \
     .group_by("month").order_by("month")
    monthly_data = [row._asdict() for row in monthly_q.all()]

    # 去年全年累计
    last_q = db.query(
        func.sum(CallRecord.call_minutes).label("call_minutes"),
    ).filter(extract("year", CallRecord.call_date) == year - 1)
    last_year_total = float(last_q.first().call_minutes or 0)

    target = round(last_year_total * 1.2, 2)

    # 去年各月分钟数
    prev_monthly_q = db.query(
        extract("month", CallRecord.call_date).label("month"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
    ).filter(extract("year", CallRecord.call_date) == year - 1) \
     .group_by("month").order_by("month")
    prev_monthly_data = {int(row.month): float(row.call_minutes or 0) for row in prev_monthly_q.all()}

    # 计算去年YTD节奏（去年到今年同月累计）
    curr_months = set(int(m["month"]) for m in monthly_data)
    last_ytd_pace = sum(prev_monthly_data.get(m, 0) for m in curr_months)

    # 今年累计分钟数
    ytd_call_minutes = float(sum(m["call_minutes"] for m in monthly_data))

    # 去年各客户的同期分钟数（去年同月）
    prev_company_monthly_q = db.query(
        CallRecord.company_id,
        CallRecord.company_name,
        extract("month", CallRecord.call_date).label("month"),
        func.sum(CallRecord.call_minutes).label("call_minutes"),
    ).filter(
        extract("year", CallRecord.call_date) == year - 1,
        extract("month", CallRecord.call_date).in_(curr_months)
    ).group_by(CallRecord.company_id, CallRecord.company_name, "month")
    prev_company_ytd = {}
    for row in prev_company_monthly_q.all():
        key = row.company_id
        if key not in prev_company_ytd:
            prev_company_ytd[key] = { "company_name": row.company_name, "call_minutes": 0 }
        prev_company_ytd[key]["call_minutes"] += float(row.call_minutes or 0)

    # 去年各客户的全年分钟数（用于新客户判断）
    prev_company_full_q = db.query(
        CallRecord.company_id,
        func.sum(CallRecord.call_minutes).label("call_minutes"),
    ).filter(extract("year", CallRecord.call_date) == year - 1) \
     .group_by(CallRecord.company_id)
    prev_company_full_map = {row.company_id: float(row.call_minutes or 0) for row in prev_company_full_q.all()}
    prev_company_ids = set(prev_company_full_map.keys())

    # 今年各客户的同期分钟数
    curr_company_monthly_q = db.query(
        CallRecord.company_id,
        CallRecord.company_name,
        func.sum(CallRecord.call_minutes).label("call_minutes"),
    ).filter(
        extract("year", CallRecord.call_date) == year,
        extract("month", CallRecord.call_date).in_(curr_months)
    ).group_by(CallRecord.company_id, CallRecord.company_name)
    curr_company_ytd_map = {
        row.company_id: { "company_name": row.company_name, "call_minutes": float(row.call_minutes or 0) }
        for row in curr_company_monthly_q.all()
    }
    curr_company_ids = set(curr_company_ytd_map.keys())

    # Top10 客户（按今年同期分钟数）
    top_customers = sorted(
        list(curr_company_ytd_map.values()),
        key=lambda x: x["call_minutes"], reverse=True
    )[:10]

    # 新客户（今年同期有，去年全年无）和老客户
    new_customers = []
    returning_customers = []
    new_cust_minutes = 0
    return_minutes = 0
    scatter_data = []
    for cid, cinfo in curr_company_ytd_map.items():
        mins = cinfo["call_minutes"]
        prev_mins = prev_company_ytd.get(cid, {}).get("call_minutes", 0)
        scatter_data.append({
            "company_name": cinfo["company_name"],
            "company_id": cid,
            "prev_ytd_minutes": prev_mins,
            "curr_ytd_minutes": mins,
        })
        if cid not in prev_company_ids:
            new_customers.append({ "company_name": cinfo["company_name"], "call_minutes": mins })
            new_cust_minutes += mins
        else:
            returning_customers.append({ "company_name": cinfo["company_name"], "call_minutes": mins })
            return_minutes += mins

    # 流失客户：去年有外呼但今年截至目前无外呼
    churn_customers = []
    churn_cust_minutes = 0.0
    lost_company_ids = prev_company_ids - curr_company_ids
    for cid in lost_company_ids:
        mins = prev_company_full_map.get(cid, 0)
        churn_customers.append({ "company_name": cid, "call_minutes": mins })
        churn_cust_minutes += mins

    # 渠道分布（今年同期）
    channel_q = db.query(
        CallRecord.channel_name,
        func.sum(CallRecord.call_minutes).label("call_minutes"),
    ).filter(
        extract("year", CallRecord.call_date) == year,
        extract("month", CallRecord.call_date).in_(curr_months)
    ).group_by(CallRecord.channel_name).order_by(func.sum(CallRecord.call_minutes).desc())
    channel_breakdown = [
        { "channel_name": r.channel_name, "call_minutes": float(r.call_minutes or 0) }
        for r in channel_q.all() if r.channel_name
    ]

    return {
        "year": year,
        "ytd_call_minutes": round(ytd_call_minutes, 2),
        "last_year_total": round(last_year_total, 2),
        "last_ytd_pace": round(last_ytd_pace, 2),
        "target": target,
        "monthly_data": [
            {**m, "call_minutes": round(float(m["call_minutes"]), 2),
             "prev_call_minutes": round(prev_monthly_data.get(int(m["month"]), 0), 2)}
            for m in monthly_data
        ],
        "top_customers": top_customers,
        "new_customers": new_customers,
        "returning_customers": returning_customers,
        "churn_customers": churn_customers,
        "new_cust_minutes": round(new_cust_minutes, 2),
        "return_minutes": round(return_minutes, 2),
        "churn_cust_minutes": round(churn_cust_minutes, 2),
        "channel_breakdown": channel_breakdown,
        "scatter_data": scatter_data,
    }


@router.get("/years")
def get_available_years(db: Session = Depends(get_db)):
    rows = db.query(extract("year", CallRecord.call_date).label("year")).distinct().order_by("year").all()
    return [int(r.year) for r in rows]


@router.get("/months")
def get_available_months(
    year: int = Query(...),
    db: Session = Depends(get_db),
):
    """获取某年份有数据的月份"""
    rows = db.query(
        extract("month", CallRecord.call_date).label("month")
    ).filter(
        extract("year", CallRecord.call_date) == year
    ).distinct().order_by("month").all()
    return [int(r.month) for r in rows]


@router.post("/ai-analysis")
def ai_analysis(
    body: AiAnalysisRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    api_key = os.getenv("MINIMAX_API_KEY")
    group_id = os.getenv("MINIMAX_GROUP_ID")
    model = os.getenv("MINIMAX_MODEL", "MiniMax-M2.5")

    if not api_key or api_key == "your_api_key_here":
        raise HTTPException(status_code=500, detail="MiniMax API Key 未配置，请联系管理员在 backend/.env 中配置")

    company_name = body.company_name
    channel_name = body.channel_name
    overview = body.overview
    monthly_data = body.monthly_data
    user_analysis = body.user_analysis
    ranking_metric = body.ranking_metric

    metric_name = {"call_minutes": "通话分钟数", "total_calls": "外呼量", "connected_calls": "接通量"}.get(ranking_metric, "通话分钟数")
    selected_year = overview.get("year", 2025)
    months_str = "\n".join([
        f"{int(row['month'])}月: {metric_name}={int(row.get(ranking_metric) or 0):,}，接通率={float(row.get('avg_connect_rate') or 0):.2%}，意向率={float(row.get('intent_rate') or 0):.2%}"
        for row in monthly_data
    ])

    prompt = f"""你是外呼数据分析师，请分析以下客户的数据表现：

客户名称：{company_name}
渠道商：{channel_name}
{selected_year}年总体数据：
- 总外呼量：{int(overview.get('total_calls') or 0):,}
- 总接通量：{int(overview.get('connected_calls') or 0):,}
- 总通话分钟数：{int(overview.get('call_minutes') or 0):,}
- 平均接通率：{float(overview.get('avg_connect_rate') or 0):.2%}
- AB意向率：{float(overview.get('intent_rate') or 0):.2%}

过去12个月趋势（{metric_name}维度）：
{months_str}

用户分析备注：
{user_analysis if user_analysis else "（无）"}

请从以下几个维度进行分析：
1. 整体表现评价
2. 趋势特征（增长/下降月份及幅度）
3. 潜在问题识别
4. 优化建议

请用简洁专业的语言输出分析报告。"""

    url = "https://api.minimax.chat/v1/text/chatcompletion_v2"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "group_id": group_id,
    }

    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            result = resp.json()
            return {"success": True, "analysis": result["choices"][0]["message"]["content"]}
    except httpx.HTTPStatusError as e:
        err_body = e.response.text
        if "overloaded_error" in err_body or "负载较高" in err_body:
            raise HTTPException(status_code=503, detail="服务负载较高，请稍后重试")
        raise HTTPException(status_code=e.response.status_code, detail=f"MiniMax API 错误: {err_body[:200]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {str(e)}")
