"""
数据导入脚本
用法:
  python3.11 import_data.py /path/to/file.xlsx
  python3.11 import_data.py /path/to/folder/  # 批量导入目录下所有 xlsx
"""
import sys
import os
import pandas as pd
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.models import Base, CallRecord

DATABASE_URL = "postgresql://aobuy@localhost/viewpan"
engine = create_engine(DATABASE_URL)
Base.metadata.create_all(bind=engine)
Session = sessionmaker(bind=engine)

COLUMN_MAP = {
    "外呼日期(day)": "call_date",
    "公司名称": "company_name",
    "公司id": "company_id",
    "品牌名称": "brand_name",
    "渠道商名称": "channel_name",
    "外呼量": "total_calls",
    "接通量": "connected_calls",
    "接通率": "connect_rate",
    "通话总时长": "total_duration",
    "通话分钟数": "call_minutes",
    "平均通话时长": "avg_duration",
    "A意向等级数": "intent_a",
    "B意向等级数": "intent_b",
    "AB意向率": "ab_intent_rate",
    "拒接数": "rejected",
    "无法接通数": "unreachable",
    "主叫号码不可用数": "caller_unavailable",
    "空号数": "empty_number",
    "关机数": "shutdown",
    "占线数": "busy",
    "停机数": "suspended",
    "未接数": "missed",
    "呼损数": "call_loss",
    "黑名单数": "blacklist",
    "天盾拦截数": "intercepted",
    "呼叫次数超过限制数": "over_limit",
    "线路盲区数": "blind_zone",
    "AI挂机数": "ai_hangup",
    "客户挂机数": "user_hangup",
    "转人工数": "transferred",
    "C意向等级数": "intent_c",
    "D意向等级数": "intent_d",
    "E意向等级数": "intent_e",
    "F意向等级数": "intent_f",
}


def import_file(filepath: str) -> int:
    print(f"导入: {filepath}")
    df = pd.read_excel(filepath)
    df = df.rename(columns=COLUMN_MAP)

    # 只保留有映射的列
    valid_cols = [c for c in df.columns if c in COLUMN_MAP.values()]
    df = df[valid_cols].copy()

    # 日期转换
    df["call_date"] = pd.to_datetime(df["call_date"].astype(str), format="%Y%m%d", errors="coerce")
    df = df.dropna(subset=["call_date"])

    # 数值列：先转数值，失败则填 0（处理 "-" 等文本）
    int_cols = [c for c in df.columns if c not in ("call_date", "company_name", "company_id", "brand_name", "channel_name")]
    for c in int_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

    session = Session()
    records = [CallRecord(**row) for row in df.to_dict(orient="records")]
    session.bulk_save_objects(records)
    session.commit()
    session.close()
    print(f"  已导入 {len(records)} 行")
    return len(records)


def main():
    if len(sys.argv) < 2:
        print("用法: python3.11 import_data.py <文件.xlsx 或 目录>")
        sys.exit(1)

    target = sys.argv[1]
    total = 0

    if os.path.isdir(target):
        files = list(Path(target).glob("*.xlsx"))
        print(f"找到 {len(files)} 个文件")
        for f in files:
            total += import_file(str(f))
    else:
        total += import_file(target)

    print(f"\n完成，共导入 {total} 行数据")


if __name__ == "__main__":
    main()
