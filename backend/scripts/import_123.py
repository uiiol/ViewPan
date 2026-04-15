"""
123.xlsx 数据导入脚本（去重逻辑：company_id + call_date 相同则覆盖）
用法: python3.11 import_123.py
"""
import sys
import pandas as pd
from pathlib import Path
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.models import Base, CallRecord

DATABASE_URL = "postgresql://aobuy@localhost/viewpan"
engine = create_engine(DATABASE_URL)


COLUMNS = [
    "call_date", "company_name", "company_id", "brand_name", "channel_name",
    "total_calls", "connected_calls", "connect_rate", "total_duration",
    "call_minutes", "avg_duration", "intent_a", "intent_b", "intent_c",
    "intent_d", "intent_e", "intent_f", "ab_intent_rate", "rejected",
    "unreachable", "caller_unavailable", "empty_number", "shutdown", "busy",
    "suspended", "missed", "call_loss", "blacklist", "intercepted",
    "over_limit", "blind_zone", "ai_hangup", "user_hangup", "transferred",
]

XLSX_COL_MAP = {
    "外呼日期(day)": "call_date", "公司名称": "company_name", "公司id": "company_id",
    "品牌名称": "brand_name", "渠道商名称": "channel_name", "外呼量": "total_calls",
    "接通量": "connected_calls", "接通率": "connect_rate", "通话总时长": "total_duration",
    "通话分钟数": "call_minutes", "平均通话时长": "avg_duration",
    "A意向等级数": "intent_a", "B意向等级数": "intent_b",
    "AB意向率": "ab_intent_rate", "拒接数": "rejected", "无法接通数": "unreachable",
    "主叫号码不可用数": "caller_unavailable", "空号数": "empty_number",
    "关机数": "shutdown", "占线数": "busy", "停机数": "suspended",
    "未接数": "missed", "呼损数": "call_loss", "黑名单数": "blacklist",
    "天盾拦截数": "intercepted", "呼叫次数超过限制数": "over_limit",
    "线路盲区数": "blind_zone", "AI挂机数": "ai_hangup",
    "客户挂机数": "user_hangup", "转人工数": "transferred",
    "C意向等级数": "intent_c", "D意向等级数": "intent_d",
    "E意向等级数": "intent_e", "F意向等级数": "intent_f",
}


def read_xlsx(filepath):
    df = pd.read_excel(filepath)
    df = df.rename(columns=XLSX_COL_MAP)
    valid = [c for c in df.columns if c in COLUMNS]
    df = df[valid].copy()
    df["call_date"] = pd.to_datetime(df["call_date"].astype(str).str.strip(), format="%Y%m%d", errors="coerce")
    df = df.dropna(subset=["call_date", "company_id"])
    for col in ("company_name", "company_id", "brand_name", "channel_name"):
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().replace("", None)
    int_cols = [c for c in df.columns if c not in ("call_date", "company_name", "company_id", "brand_name", "channel_name")]
    df[int_cols] = df[int_cols].fillna(0)
    df = df.drop_duplicates(subset=["company_id", "call_date"], keep="last")
    return df


def upsert_batch(df_batch, conn):
    # 构建 upsert SQL: INSERT ... ON CONFLICT DO UPDATE
    cols = list(df_batch.columns)
    placeholders = ", ".join([f":{c}" for c in cols])
    cols_sql = ", ".join(cols)
    update_parts = ", ".join([f'"{c}"=EXCLUDED."{c}"' for c in cols if c not in ("company_id", "call_date")])
    sql = text(f"""
        INSERT INTO call_records ({cols_sql})
        VALUES ({placeholders})
        ON CONFLICT (company_id, call_date) DO UPDATE SET {update_parts}
    """)
    conn.execute(sql, df_batch.to_dict(orient="records"))


def import_file(filepath):
    print(f"读取: {filepath}")
    df = read_xlsx(filepath)
    print(f"  去重后 {len(df)} 行")

    with engine.begin() as conn:
        batch_size = 5000
        total = 0
        for start in range(0, len(df), batch_size):
            batch = df.iloc[start:start + batch_size]
            upsert_batch(batch, conn)
            total += len(batch)
            print(f"  已写入 {total}/{len(df)} 行")

    return len(df)


def main():
    filepath = "/Users/aobuy/Documents/LLM/ViewPan/原数据/123.xlsx"
    total = import_file(filepath)
    print(f"\n完成，共处理 {total} 行数据")


if __name__ == "__main__":
    main()
