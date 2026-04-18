import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Row, Col, Card, Table, Segmented, Badge, Select, Button, Collapse } from "antd";
import { PhoneOutlined, CheckCircleOutlined, ClockCircleOutlined, RiseOutlined } from "@ant-design/icons";
import { Statistic } from "antd";
import FilterBar from "../components/FilterBar";
import TimeGranularityPicker from "../components/TimeGranularityPicker";
import TrendChart from "../components/TrendChart";
import EChart from "../components/EChart";
import * as api from "../api";
import dayjs from "dayjs";

function numFmt(n) {
  if (n == null || n === "-") return "-";
  if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(2) + "万";
  return Number(n).toLocaleString();
}

function pctFmt(n) {
  if (n == null) return "-";
  return (parseFloat(n) * 100).toFixed(2) + "%";
}

function deltaFmt(current, prev) {
  if (current == null || prev == null || prev === 0) return null;
  const delta = ((current - prev) / prev) * 100;
  const sign = delta >= 0 ? "+" : "";
  return { text: `${sign}${delta.toFixed(1)}%`, absDelta: current - prev, type: delta >= 0 ? "up" : "down" };
}

function pctChg(curr, prev) {
  if (curr == null || prev == null || prev === 0) return "-";
  const chg = ((curr - prev) / prev) * 100;
  return `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`;
}

function statsFromArr(arr, key) {
  const vals = arr.map(r => r[key]).filter(v => v != null && !isNaN(v)).sort((a, b) => a - b);
  if (!vals.length) return { median: null, q1: null, q3: null, avg: null };
  const n = vals.length;
  const sum = vals.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const median = n % 2 === 1 ? vals[Math.floor(n / 2)] : (vals[n / 2 - 1] + vals[n / 2]) / 2;
  const q1Idx = Math.floor(n * 0.25);
  const q3Idx = Math.floor(n * 0.75);
  return { median, q1: vals[q1Idx], q3: vals[q3Idx], avg };
}

export default function ChannelPage(props) {
  const [years, setYears] = useState([]);
  const [channels, setChannels] = useState([]);

  const [selectedChannel, setSelectedChannel] = useState(null);
  const [availableMonths, setAvailableMonths] = useState([]);

  const [rankingMetric, setRankingMetric] = useState("call_minutes");
  const [rankingGrowthSortYoY, setRankingGrowthSortYoY] = useState(null); // "growth_desc" | "shrink_desc" | null
  const [rankingGrowthSortQoQ, setRankingGrowthSortQoQ] = useState(null); // "growth_desc" | "shrink_desc" | null
  const [selectedChannelInTable, setSelectedChannelInTable] = useState(null);

  const [channelOverview, setChannelOverview] = useState(null);
  const [channelTrend, setChannelTrend] = useState([]);
  const [channelRanking, setChannelRanking] = useState([]);
  const [loading, setLoading] = useState(true);
  const [topCustomers, setTopCustomers] = useState([]);
  const [channelCompanies, setChannelCompanies] = useState([]); // 当前选中渠道的全部客户
  const [concentration, setConcentration] = useState(null);
  const [monthlyConc, setMonthlyConc] = useState([]); // 每月详细数据（折叠展开用）
  const [compMode, setCompMode] = useState("qoq"); // "qoq" 环比 | "yoy" 同比

  const navigate = useNavigate();

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem("channelpage_visible_cols")); } catch { return null; }
  });

  // TimeGranularityPicker 状态
  const [timeRange, setTimeRange] = useState(null);

  /**
   * 将 TimeRange 转换为 API 参数
   * 应用"昨天原则"：当前月/周/日时，endDate clip 到昨天
   */
  function buildParamsFromTimeRange(tr) {
    if (!tr) return { year: 2026, quarter: null, month: null, start_date: undefined, end_date: undefined, customStart: null, customEnd: null };
    const { granularity, startDate, endDate, startKey, endKey } = tr;
    const today = dayjs();
    const yesterday = today.subtract(1, "day");

    // clip endDate to yesterday if period includes today
    const isCurrentPeriod = endDate.isSame(today, "day") || endDate.isAfter(today, "day");
    const effEnd = isCurrentPeriod ? yesterday : endDate;

    // year always from startKey (first 4 chars or parsed)
    let year = parseInt(startKey.substring(0, 4));
    let quarter = null, month = null;
    let start_date = startDate.format("YYYY-MM-DD");
    let end_date = effEnd.format("YYYY-MM-DD");
    let customStart = null, customEnd = null;

    if (granularity === "year") {
      // full year: use natural dates (past year → Dec 31; current year → yesterday)
      year = parseInt(startKey);
      start_date = `${year}-01-01`;
      end_date = year === today.year() ? yesterday.format("YYYY-MM-DD") : `${year}-12-31`;
      return { year, quarter: null, month: null, start_date, end_date };
    }
    if (granularity === "half") {
      const y = parseInt(startKey.split("-")[0]);
      const h = startKey.includes("-H1") ? 1 : 2;
      quarter = h === 1 ? "H1" : "H2";
      return { year: y, quarter, month: null, start_date, end_date };
    }
    if (granularity === "quarter") {
      // Single quarter OR range (Q3-Q4): always use start_date/end_date for completeness
      return { year, quarter: null, month: null, start_date, end_date };
    }
    if (granularity === "month") {
      // Month range (跨年跨月): use start_date/end_date
      if (startKey !== endKey) {
        return { year, quarter: null, month: null, start_date, end_date };
      }
      // Single natural month: use start_date/end_date (backend will use month param)
      const y = parseInt(startKey.split("-")[0]);
      const m = parseInt(startKey.split("-")[1]);
      return { year: y, quarter: null, month: m, start_date, end_date };
    }
    if (granularity === "week" || granularity === "day") {
      // Arbitrary date range → pass explicit dates
      return { year, quarter: null, month: null, start_date, end_date };
    }
    return { year, quarter: null, month: null, start_date, end_date };
  }

  // 从 timeRange 派生 year/period（供 FilterBar 和其他老逻辑用）
  const derived = useMemo(() => buildParamsFromTimeRange(timeRange), [timeRange]);
  const selectedYear = derived.year;
  const selectedPeriod = timeRange?.granularity === "month"
    ? `month-${derived.month}`
    : timeRange?.granularity === "quarter" ? derived.quarter
    : timeRange?.granularity === "half" ? (derived.quarter === "H1" ? "first-half" : "second-half")
    : "full-year";

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getYears(), api.getChannels()]).then(([y, ch]) => {
      if (cancelled) return;
      const latest = y.length ? y[y.length - 1] : 2026;
      setYears(y);
      setChannels(ch);
      api.getMonths(latest).then(m => { if (!cancelled) setAvailableMonths(m); });
      // Initialize TimeGranularityPicker with current year/month
      if (!cancelled) {
        const now = dayjs();
        const y = now.year();
        const m = now.month() + 1;
        setTimeRange({
          granularity: "month",
          startKey: `${y}-${String(m).padStart(2, "0")}`,
          endKey: `${y}-${String(m).padStart(2, "0")}`,
          label: `${y}年${m}月`,
          startDate: dayjs(`${y}-${String(m).padStart(2, "0")}-01`),
          endDate: now.subtract(1, "day"), // yesterday principle
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

  // 渠道商排行榜数据
  useEffect(() => {
    if (!timeRange) return;
    const abortCtrl = new AbortController();
    setLoading(true);

    const { year, quarter, month, start_date, end_date } = derived;

    const rankingParams = {
      year, quarter, month, metric: rankingMetric, limit: 0,
      start_date, end_date,
      sort_by_growth: rankingGrowthSortYoY,
      sort_by_growth_qoq: rankingGrowthSortQoQ,
    };
    const concParams = { year, quarter, month, metric: rankingMetric, start_date, end_date };

    api.getChannelRanking(rankingParams).then(ranking => {
      if (abortCtrl.signal.aborted) return;
      setChannelRanking(Array.isArray(ranking) ? ranking : []);
    }).catch(() => {});

    api.getChannelConcentration(concParams).then(conc => {
      if (abortCtrl.signal.aborted) return;
      setConcentration(conc);
      setLoading(false);
    }).catch(() => { if (!abortCtrl.signal.aborted) setLoading(false); });

    return () => abortCtrl.abort();
  }, [derived, rankingMetric, rankingGrowthSortYoY, rankingGrowthSortQoQ]);

  // 每月详细数据（折叠展开用）
  useEffect(() => {
    if (!timeRange) return;
    const { year, start_date, end_date } = derived;
    const today = dayjs();
    const yesterday = today.subtract(1, "day");

    // 计算要获取的月份列表（基于日期范围）
    let monthsToFetch = [];

    if (start_date && end_date) {
      // 日期范围：解析起始和结束日期，计算范围内的每个月
      let cur = dayjs(start_date).startOf('month');
      const end = dayjs(end_date).startOf('month');
      while (cur.isBefore(end) || cur.isSame(end, 'month')) {
        monthsToFetch.push({ year: cur.year(), month: cur.month() + 1 });
        cur = cur.add(1, 'month');
      }
    } else {
      // 非日期范围：使用year逻辑
      const currentMonth = yesterday.month() + 1;
      const isCurrentYear = year === today.year();
      const months = isCurrentYear
        ? Array.from({ length: currentMonth }, (_, i) => i + 1)
        : Array.from({ length: 12 }, (_, i) => i + 1);
      monthsToFetch = months.map(m => ({ year, month: m }));
    }

    Promise.all([
      ...monthsToFetch.map(({ year: y, month: m }) =>
        api.getChannelConcentration({ year: y, month: m, metric: rankingMetric })
      ),
      ...monthsToFetch.map(({ year: y, month: m }) =>
        api.getChannelConcentration({ year: y - 1, month: m, metric: rankingMetric })
      ),
    ]).then(results => {
      const curr = results.slice(0, monthsToFetch.length);
      const prev = results.slice(monthsToFetch.length);
      setMonthlyConc(curr.map((r, i) => ({
        year: monthsToFetch[i].year,
        month: monthsToFetch[i].month,
        ...r,
        prevData: prev[i] || null,
      })));
    }).catch(() => setMonthlyConc([]));
  }, [derived, rankingMetric]);

  // 选中渠道商后，获取详情数据
  useEffect(() => {
    const ch = selectedChannel || selectedChannelInTable;
    if (!ch || !timeRange) {
      setChannelOverview(null);
      setChannelTrend([]);
      return;
    }

    const { year, quarter, month, start_date, end_date } = derived;
    const isDailyMode = timeRange?.granularity === "day" ||
      timeRange?.granularity === "week" ||
      (timeRange?.granularity === "month" && timeRange?.startKey === timeRange?.endKey);

    const params = { year, channel_name: ch };
    if (start_date && end_date) {
      params.start_date = start_date;
      params.end_date = end_date;
    } else if (quarter) {
      params.quarter = quarter;
    } else if (month) {
      params.month = month;
    }

    const trendParams = { year, channel_name: ch };
    const isWeekMode = timeRange?.granularity === "week";
    if (start_date && end_date) {
      trendParams.start_date = start_date;
      trendParams.end_date = end_date;
      trendParams.compare_year = year - 1;
      if (isWeekMode) {
        trendParams.granularity = "week";
      }
    } else if (isDailyMode && month) {
      const monthStart = dayjs(`${year}-${String(month).padStart(2, "0")}-01`);
      trendParams.start_date = monthStart.format("YYYY-MM-DD");
      trendParams.end_date = dayjs().subtract(1, "day").format("YYYY-MM-DD");
      trendParams.compare_year = year - 1;
    } else if (quarter) {
      trendParams.quarter = quarter;
    } else {
      trendParams.compare_year = year - 1;
    }

    Promise.all([
      api.getChannelOverview(params),
      isWeekMode
        ? api.getMonthlyTrend({ ...trendParams, granularity: "week" })
        : isDailyMode ? api.getDailyTrend(trendParams) : api.getMonthlyTrend(trendParams),
    ]).then(([ov, trend]) => {
      setChannelOverview(ov);
      setChannelTrend(Array.isArray(trend) ? trend : []);
    });
  }, [derived, selectedChannel, selectedChannelInTable, timeRange]);

  // 获取渠道商Top3客户
  useEffect(() => {
    const ch = selectedChannel || selectedChannelInTable;
    if (!ch || !timeRange) {
      setTopCustomers([]);
      return;
    }
    const { year, quarter, month, start_date, end_date } = derived;
    Promise.all([
      api.getCompanyRanking({ year, quarter, month, start_date, end_date, channel_name: ch, metric: rankingMetric, limit: 3 }),
      api.getCompanies({ channel_name: ch }),
    ]).then(([r, comp]) => {
      setTopCustomers(Array.isArray(r) ? r : []);
      setChannelCompanies(Array.isArray(comp) ? comp : []);
    });
  }, [derived, selectedChannel, selectedChannelInTable]);

  // 筛渠道商时同步排行榜选中态
  useEffect(() => {
    if (selectedChannel !== null) {
      setSelectedChannelInTable(selectedChannel);
    }
  }, [selectedChannel]);

  const avgConnectRate = channelOverview?.avg_connect_rate ? pctFmt(channelOverview.avg_connect_rate) : "-";
  const intentRate = channelOverview?.ab_intent && channelOverview?.connected_calls
    ? pctFmt(channelOverview.ab_intent / channelOverview.connected_calls)
    : "-";

  const trendWithDelta = useMemo(() => {
    const isWeekMode = timeRange?.granularity === "week";
    const endDayOfWeek = timeRange?.endDate?.day() || 0;
    const lastWeekDays = endDayOfWeek === 0 ? 7 : endDayOfWeek; // 周日到周六为1-6，周日为7（完整周）
    const isPartialLastWeek = isWeekMode && lastWeekDays < 7;

    return channelTrend.map((row, i) => {
      const prev = i > 0 ? channelTrend[i - 1] : null;

      // 周粒度环比：如果最后一周是部分周（未到周日），则按天数比例调整上周数据进行对比
      let prevCalls = prev?.total_calls;
      let prevMinutes = prev?.call_minutes;
      const isLastRow = i === channelTrend.length - 1;
      if (isPartialLastWeek && isLastRow && i > 0 && prev) {
        const ratio = lastWeekDays / 7;
        prevCalls = Math.round(prev.total_calls * ratio);
        prevMinutes = Math.round(prev.call_minutes * ratio);
      }

      const qoq = {
        calls_delta: deltaFmt(row.total_calls, prevCalls),
        minutes_delta: deltaFmt(row.call_minutes, prevMinutes),
        connect_rate_delta: deltaFmt(row.avg_connect_rate, prev?.avg_connect_rate),
        intent_rate_delta: deltaFmt(row.intent_rate, prev?.intent_rate),
      };
      const yoy = {
        calls_yoy: deltaFmt(row.total_calls, row.prev_total_calls),
        minutes_yoy: deltaFmt(row.call_minutes, row.prev_call_minutes),
        connect_rate_yoy: deltaFmt(row.avg_connect_rate, row.prev_avg_connect_rate),
        intent_rate_yoy: deltaFmt(row.intent_rate, row.prev_intent_rate),
      };
      return { ...row, ...qoq, ...yoy };
    });
  }, [channelTrend, timeRange]);

  const isDaily = useMemo(() => channelTrend.length > 0 && channelTrend[0] && ("date" in channelTrend[0]), [channelTrend]);
  const chartTitle = timeRange?.granularity === "week"
    ? "周趋势（外呼量 / 通话分钟数 / 接通率 / 意向率）"
    : isDaily ? "日趋势（外呼量 / 通话分钟数 / 接通率 / 意向率）"
    : "月度趋势（外呼量 / 通话分钟数 / 接通率 / 意向率）";

  const deltaTag = (delta) => {
    if (!delta) return <span style={{ color: "#aaa" }}>-</span>;
    return (
      <span
        style={{ color: delta.type === "up" ? "#52c41a" : "#ff4d4f", fontSize: 12, cursor: "default" }}
        title={delta.absDelta != null ? (delta.absDelta < 0 ? `减少：${numFmt(Math.abs(delta.absDelta))}` : `增加：+${numFmt(delta.absDelta)}`) : undefined}
      >
        {delta.text}
      </span>
    );
  };

  const rankingStats = useMemo(() => statsFromArr(channelRanking, rankingMetric), [channelRanking, rankingMetric]);
  const isYoYSort = rankingGrowthSortYoY != null;
  const isQoQSort = rankingGrowthSortQoQ != null;
  const showGrowthCol = isYoYSort || isQoQSort;
  const totalMetric = useMemo(() => channelRanking.reduce((s, r) => s + (r[rankingMetric] || 0), 0), [channelRanking, rankingMetric]);
  const top20Contribution = useMemo(() => {
    if (!channelRanking.length || !totalMetric) return 0;
    const top20 = channelRanking.slice(0, 20);
    const top20Sum = top20.reduce((s, r) => s + (r[rankingMetric] || 0), 0);
    return top20Sum / totalMetric;
  }, [channelRanking, totalMetric, rankingMetric]);

  const growthFmt = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  const ALL_COLUMNS = [
    { key: "total_calls", label: "外呼量" },
    { key: "connected_calls", label: "接通量" },
    { key: "avg_connect_rate", label: "平均接通率" },
    { key: "intent_rate", label: "AB意向率" },
    ...(showGrowthCol ? [{ key: "growth_rate", label: isQoQSort ? "环比增长率" : "同比增长率" }] : []),
  ];
  const defaultVisible = ALL_COLUMNS.map(c => c.key);
  const currentVisible = visibleColumns || defaultVisible;

  const metricLabel = { call_minutes: "通话分钟数", total_calls: "外呼量", connected_calls: "接通量" };

  const finalRankingColumns = [
    { title: "排名", key: "rank", width: 50, render: (_, __, i) => i + 1 },
    {
      title: "渠道商",
      dataIndex: "channel_name",
      key: "channel_name",
      ellipsis: true,
      render: (v) => (
        <span
          style={{ color: selectedChannelInTable === v ? "#1677ff" : undefined, cursor: "pointer", fontWeight: selectedChannelInTable === v ? 600 : 400 }}
          onClick={() => setSelectedChannelInTable(selectedChannelInTable === v ? null : v)}
        >
          {selectedChannelInTable === v ? <Badge color="blue" text={v} /> : v}
        </span>
      ),
    },
    {
      title: metricLabel[rankingMetric],
      dataIndex: rankingMetric,
      key: rankingMetric,
      render: (v, row) => {
        const rate = isQoQSort ? row.qoq_growth_rate : row.growth_rate;
        const color = showGrowthCol
          ? (rate == null ? "#5470c6" : rate >= 0 ? "#52c41a" : "#ff4d4f")
          : (rankingStats.q3 && row[rankingMetric] >= rankingStats.q3 ? "#52c41a" : rankingStats.q1 && row[rankingMetric] <= rankingStats.q1 ? "#ff4d4f" : "#5470c6");
        return <span style={{ color, fontWeight: color !== "#5470c6" ? 600 : 400 }}>{numFmt(v)}</span>;
      },
      align: "right",
    },
    ...(currentVisible.includes("total_calls") && rankingMetric !== "total_calls" ? [{ title: "外呼量", dataIndex: "total_calls", key: "total_calls", render: v => numFmt(v), align: "right" }] : []),
    ...(currentVisible.includes("connected_calls") && rankingMetric !== "connected_calls" ? [{ title: "接通量", dataIndex: "connected_calls", key: "connected_calls", render: v => numFmt(v), align: "right" }] : []),
    ...(currentVisible.includes("avg_connect_rate") ? [{ title: "平均接通率", dataIndex: "avg_connect_rate", key: "avg_connect_rate", render: v => pctFmt(v), align: "right" }] : []),
    ...(currentVisible.includes("intent_rate") ? [{ title: "AB意向率", dataIndex: "intent_rate", key: "intent_rate", render: v => pctFmt(v), align: "right" }] : []),
    {
      title: "占比",
      key: "metric_share",
      render: (_, row) => {
        if (!totalMetric || !row[rankingMetric]) return "-";
        return pctFmt(row[rankingMetric] / totalMetric);
      },
      align: "right",
    },
    ...(showGrowthCol ? [{
      title: isQoQSort ? "环比增长率" : "同比增长率",
      key: "growth_rate",
      render: (_, row) => {
        const isQoQ = isQoQSort;
        const rate = isQoQ ? row.qoq_growth_rate : row.growth_rate;
        const prevVal = isQoQ ? row.qoq_prev_value : row[`prev_${rankingMetric}`];
        if (rate == null) return <span style={{ color: "#aaa" }}>无{isQoQ ? "上个周期" : "同期"}</span>;
        const sign = rate >= 0 ? "+" : "";
        const color = rate >= 0 ? "#52c41a" : "#ff4d4f";
        const curr = row[rankingMetric] || 0;
        const absDelta = curr - (prevVal || 0);
        const absSign = absDelta >= 0 ? "+" : "";
        const tooltip = `${isQoQ ? "环比" : "同比"}绝对值：${absSign}${numFmt(absDelta)}\n当期：${numFmt(curr)}\n${isQoQ ? "上个周期" : "同期"}：${numFmt(prevVal || 0)}`;
        return (
          <span style={{ color, fontWeight: 600, cursor: "default" }} title={tooltip}>
            {sign}{(rate * 100).toFixed(1)}%
          </span>
        );
      },
      align: "right",
    }] : []),
  ];

  const monthlyColumns = [
    { title: "月份", dataIndex: "period_key", key: "month", render: m => `${((Math.round(Number(m)) - 1) % 12) + 1}月`, width: 60 },
    { title: "外呼量", dataIndex: "total_calls", key: "total_calls", render: v => numFmt(v), align: "right" },
    { title: "环比", dataIndex: "calls_delta", key: "calls_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "calls_yoy", key: "calls_yoy", render: deltaTag, align: "right" },
    { title: "通话分钟数", dataIndex: "call_minutes", key: "call_minutes", render: v => numFmt(v), align: "right" },
    { title: "环比", dataIndex: "minutes_delta", key: "minutes_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "minutes_yoy", key: "minutes_yoy", render: deltaTag, align: "right" },
    { title: "接通率", dataIndex: "avg_connect_rate", key: "avg_connect_rate", render: v => pctFmt(v), align: "right" },
    { title: "环比", dataIndex: "connect_rate_delta", key: "connect_rate_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "connect_rate_yoy", key: "connect_rate_yoy", render: deltaTag, align: "right" },
    { title: "意向率", dataIndex: "intent_rate", key: "intent_rate", render: v => pctFmt(v), align: "right" },
    { title: "环比", dataIndex: "intent_rate_delta", key: "intent_rate_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "intent_rate_yoy", key: "intent_rate_yoy", render: deltaTag, align: "right" },
  ];

  const weeklyColumns = [
    { title: "周", dataIndex: "period_key", key: "period_key", render: w => `第${Math.round(Number(w)) % 52 || 52}周`, width: 60 },
    { title: "外呼量", dataIndex: "total_calls", key: "total_calls", render: v => numFmt(v), align: "right" },
    { title: "环比", dataIndex: "calls_delta", key: "calls_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "calls_yoy", key: "calls_yoy", render: deltaTag, align: "right" },
    { title: "通话分钟数", dataIndex: "call_minutes", key: "call_minutes", render: v => numFmt(v), align: "right" },
    { title: "环比", dataIndex: "minutes_delta", key: "minutes_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "minutes_yoy", key: "minutes_yoy", render: deltaTag, align: "right" },
    { title: "接通率", dataIndex: "avg_connect_rate", key: "avg_connect_rate", render: v => pctFmt(v), align: "right" },
    { title: "环比", dataIndex: "connect_rate_delta", key: "connect_rate_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "connect_rate_yoy", key: "connect_rate_yoy", render: deltaTag, align: "right" },
    { title: "意向率", dataIndex: "intent_rate", key: "intent_rate", render: v => pctFmt(v), align: "right" },
    { title: "环比", dataIndex: "intent_rate_delta", key: "intent_rate_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "intent_rate_yoy", key: "intent_rate_yoy", render: deltaTag, align: "right" },
  ];

  const dailyColumns = [
    { title: "日期", dataIndex: "date", key: "date", width: 90 },
    { title: "外呼量", dataIndex: "total_calls", key: "total_calls", render: v => numFmt(v), align: "right" },
    { title: "环比", dataIndex: "calls_delta", key: "calls_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "calls_yoy", key: "calls_yoy", render: deltaTag, align: "right" },
    { title: "通话分钟数", dataIndex: "call_minutes", key: "call_minutes", render: v => numFmt(v), align: "right" },
    { title: "环比", dataIndex: "minutes_delta", key: "minutes_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "minutes_yoy", key: "minutes_yoy", render: deltaTag, align: "right" },
    { title: "接通率", dataIndex: "avg_connect_rate", key: "avg_connect_rate", render: v => pctFmt(v), align: "right" },
    { title: "环比", dataIndex: "connect_rate_delta", key: "connect_rate_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "connect_rate_yoy", key: "connect_rate_yoy", render: deltaTag, align: "right" },
    { title: "意向率", dataIndex: "intent_rate", key: "intent_rate", render: v => pctFmt(v), align: "right" },
    { title: "环比", dataIndex: "intent_rate_delta", key: "intent_rate_delta", render: deltaTag, align: "right" },
    { title: "同比", dataIndex: "intent_rate_yoy", key: "intent_rate_yoy", render: deltaTag, align: "right" },
  ];

  // 周粒度时用周数据
  const isWeekMode = timeRange?.granularity === "week";
  const trendColumns = useMemo(() => {
    if (isWeekMode) return weeklyColumns;
    if (isDaily) return dailyColumns;
    return monthlyColumns;
  }, [isDaily, isWeekMode]);

  const selectedChannelName = selectedChannelInTable || selectedChannel;

  return (
    <div style={{ padding: "20px 24px" }}>
      <Card bordered={false} style={{ marginBottom: 16, position: "sticky", top: 64, zIndex: 100 }}>
        <FilterBar
          years={years} selectedYear={selectedYear}
          channels={channels} selectedChannel={selectedChannel} onChannelChange={v => { setSelectedChannel(v); setRankingGrowthSortYoY(null); setRankingGrowthSortQoQ(null); }}
          availableMonths={availableMonths}
          timeRange={timeRange}
          onTimeRangeChange={tr => {
            setTimeRange(tr);
            setRankingGrowthSortYoY(null);
            setRankingGrowthSortQoQ(null);
          }}
        />
      </Card>

      <Row gutter={[16, 16]} align="stretch">
        {/* 左侧：渠道商排行榜 */}
        <Col span={selectedChannelName ? 10 : 24} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 渠道商分布 — 始终显示在排行榜上方 */}
          {concentration && (
            <Card title={`渠道商分布`} bordered={false} size="small">
              <Row gutter={[12, 8]}>
                <Col span={4}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>外呼渠道数</div>
                  <div
                    style={{ fontSize: 22, fontWeight: 700, color: "#5470c6", cursor: "default" }}
                    title={`当期：${concentration.total_channels} 渠道\n环比：${concentration.qoq_channels_count ?? "-"}${concentration.qoq_channels_count != null ? ` (${pctChg(concentration.total_channels, concentration.qoq_channels_count)})` : ""}\n同比：${concentration.prev_channels_count ?? "-"}${concentration.prev_channels_count != null ? ` (${pctChg(concentration.total_channels, concentration.prev_channels_count)})` : ""}`}
                  >
                    {concentration.total_channels}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>渠道总数</div>
                </Col>
                <Col span={4}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>二八法则</div>
                  <div
                    style={{ fontSize: 22, fontWeight: 700, color: top20Contribution >= 0.8 ? "#ff4d4f" : top20Contribution >= 0.5 ? "#fa8c16" : "#52c41a", cursor: "default" }}
                    title={`当期：${(top20Contribution * 100).toFixed(1)}%\n环比：${((concentration.qoq_top20_contribution || 0) * 100).toFixed(1)}%${concentration.qoq_top20_contribution != null ? ` (${pctChg(top20Contribution, concentration.qoq_top20_contribution)})` : ""}\n同比：${((concentration.prev_top20_contribution || 0) * 100).toFixed(1)}%${concentration.prev_top20_contribution != null ? ` (${pctChg(top20Contribution, concentration.prev_top20_contribution)})` : ""}`}
                  >
                    {(top20Contribution * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>前20名渠道占分钟数</div>
                </Col>
                <Col span={4}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>单客户撑起</div>
                  <div
                    style={{ fontSize: 22, fontWeight: 700, color: concentration.single_cust_channel_count > 0 ? "#ff4d4f" : "#52c41a", cursor: "default" }}
                    title={`当期：${concentration.single_cust_channel_count} 渠道\n环比：${concentration.qoq_single_cust_count ?? "-"}${concentration.qoq_single_cust_count != null ? ` (${pctChg(concentration.single_cust_channel_count, concentration.qoq_single_cust_count)})` : ""}\n同比：${concentration.prev_single_cust_count ?? "-"}${concentration.prev_single_cust_count != null ? ` (${pctChg(concentration.single_cust_channel_count, concentration.prev_single_cust_count)})` : ""}`}
                  >
                    {concentration.single_cust_channel_count}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>单客占比&gt;50%渠道数</div>
                </Col>
                <Col span={4}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>头部渠道</div>
                  <div
                    style={{ fontSize: 22, fontWeight: 700, color: concentration.head_channel_count > 0 ? "#ff4d4f" : "#52c41a", cursor: "default" }}
                    title={`当期：${concentration.head_channel_count} 渠道\n环比：${concentration.qoq_head_count ?? "-"}${concentration.qoq_head_count != null ? ` (${pctChg(concentration.head_channel_count, concentration.qoq_head_count)})` : ""}\n同比：${concentration.prev_head_count ?? "-"}${concentration.prev_head_count != null ? ` (${pctChg(concentration.head_channel_count, concentration.prev_head_count)})` : ""}`}
                  >
                    {concentration.head_channel_count}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>月均 &gt; 20万分钟</div>
                </Col>
                <Col span={4}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>尾部渠道</div>
                  <div
                    style={{ fontSize: 22, fontWeight: 700, color: concentration.tail_channel_count > 0 ? "#fa8c16" : "#52c41a", cursor: "default" }}
                    title={`当期：${concentration.tail_channel_count} 渠道\n环比：${concentration.qoq_tail_count ?? "-"}${concentration.qoq_tail_count != null ? ` (${pctChg(concentration.tail_channel_count, concentration.qoq_tail_count)})` : ""}\n同比：${concentration.prev_tail_count ?? "-"}${concentration.prev_tail_count != null ? ` (${pctChg(concentration.tail_channel_count, concentration.prev_tail_count)})` : ""}`}
                  >
                    {concentration.tail_channel_count}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>月均 &lt; 1万分钟</div>
                </Col>
                <Col span={4}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>流失渠道</div>
                  <div
                    style={{ fontSize: 22, fontWeight: 700, color: concentration.churn_channel_count > 0 ? "#ff4d4f" : "#52c41a" }}
                  >
                    {concentration.churn_channel_count}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>去年有今无</div>
                </Col>
              </Row>
              <Row gutter={[12, 8]} style={{ marginTop: 8 }}>
                <Col span={4}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>新增渠道</div>
                  <div
                    style={{ fontSize: 22, fontWeight: 700, color: concentration.new_channel_count > 0 ? "#52c41a" : "#5470c6" }}
                  >
                    {concentration.new_channel_count}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>去年无今有</div>
                </Col>
              </Row>
            </Card>
          )}

          {monthlyConc.length > 0 && (
            <Card bordered={false} size="small">
              <Collapse
                ghost
                items={[{
                  key: "monthly",
                  label: (
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, color: "#888" }}>📊 每月详细数据</span>
                      <Segmented
                        size="small"
                        value={compMode}
                        onChange={v => setCompMode(v)}
                        options={[
                          { label: "环比", value: "qoq" },
                          { label: "同比", value: "yoy" },
                        ]}
                      />
                    </span>
                  ),
                  children: (
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={monthlyConc.map((r, idx) => {
                        const isYoY = compMode === "yoy";
                        const prevItem = idx > 0 ? monthlyConc[idx - 1] : null;
                        const comp = isYoY ? r.prevData : prevItem;
                        return {
                          key: `${r.year}-${r.month}`,
                          year: r.year,
                          month: `${r.year}年${r.month}月`,
                          channels: r.total_channels,
                          channelsComp: comp?.total_channels,
                          // 二八法则: 前top20渠道的分钟数占该月总分钟数的百分比
                          top20: `${(r.top20_pct * 100).toFixed(1)}%`,
                          top20Comp: comp ? `${(comp.top20_pct * 100).toFixed(1)}%` : "-",
                          singleCust: r.single_cust_channel_count,
                          singleCustComp: comp?.single_cust_channel_count,
                          head: r.head_channel_count,
                          headComp: comp?.head_channel_count,
                          tail: r.tail_channel_count,
                          tailComp: comp?.tail_channel_count,
                          churn: r.churn_channel_count,
                          newCh: r.new_channel_count,
                        };
                      })}
                      columns={[
                        { title: "月份", dataIndex: "month", key: "month", width: 80 },
                        { title: "外呼渠道数", dataIndex: "channels", key: "channels", align: "right", width: 80 },
                        { title: compMode === "yoy" ? "同比" : "环比", key: "channelsComp", align: "right", width: 80,
                          render: (_, r) => {
                            if (!r.channelsComp) return <span style={{ color: "#aaa" }}>-</span>;
                            const chg = ((r.channels - r.channelsComp) / r.channelsComp * 100);
                            return <span style={{ color: chg >= 0 ? "#52c41a" : "#ff4d4f", cursor: "default" }} title={`当期:${r.channels} ${compMode==="yoy"?"同比":"环比"}:${r.channelsComp}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>;
                          }
                        },
                        { title: "二八法则", dataIndex: "top20", key: "top20", align: "right", width: 80 },
                        { title: compMode === "yoy" ? "同比" : "环比", key: "top20Comp", align: "right", width: 80,
                          render: (_, r) => {
                            if (!r.top20Comp) return <span style={{ color: "#aaa" }}>-</span>;
                            const chg = (parseFloat(r.top20) - parseFloat(r.top20Comp));
                            return <span style={{ color: chg >= 0 ? "#52c41a" : "#ff4d4f", cursor: "default" }} title={`当期:${r.top20} ${compMode==="yoy"?"同比":"环比"}:${r.top20Comp}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>;
                          }
                        },
                        { title: "单客户撑起", dataIndex: "singleCust", key: "singleCust", align: "right", width: 80 },
                        { title: compMode === "yoy" ? "同比" : "环比", key: "singleCustComp", align: "right", width: 80,
                          render: (_, r) => {
                            if (!r.singleCustComp) return <span style={{ color: "#aaa" }}>-</span>;
                            const chg = ((r.singleCust - r.singleCustComp) / r.singleCustComp * 100);
                            return <span style={{ color: chg >= 0 ? "#52c41a" : "#ff4d4f", cursor: "default" }} title={`当期:${r.singleCust} ${compMode==="yoy"?"同比":"环比"}:${r.singleCustComp}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>;
                          }
                        },
                        { title: "头部渠道", dataIndex: "head", key: "head", align: "right", width: 80 },
                        { title: compMode === "yoy" ? "同比" : "环比", key: "headComp", align: "right", width: 80,
                          render: (_, r) => {
                            if (!r.headComp) return <span style={{ color: "#aaa" }}>-</span>;
                            const chg = ((r.head - r.headComp) / r.headComp * 100);
                            return <span style={{ color: chg >= 0 ? "#52c41a" : "#ff4d4f", cursor: "default" }} title={`当期:${r.head} ${compMode==="yoy"?"同比":"环比"}:${r.headComp}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>;
                          }
                        },
                        { title: "尾部渠道", dataIndex: "tail", key: "tail", align: "right", width: 80 },
                        { title: compMode === "yoy" ? "同比" : "环比", key: "tailComp", align: "right", width: 80,
                          render: (_, r) => {
                            if (!r.tailComp) return <span style={{ color: "#aaa" }}>-</span>;
                            const chg = ((r.tail - r.tailComp) / r.tailComp * 100);
                            return <span style={{ color: chg >= 0 ? "#52c41a" : "#ff4d4f", cursor: "default" }} title={`当期:${r.tail} ${compMode==="yoy"?"同比":"环比"}:${r.tailComp}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>;
                          }
                        },
                        { title: "流失渠道", dataIndex: "churn", key: "churn", align: "right", width: 80 },
                        { title: "新增渠道", dataIndex: "newCh", key: "newCh", align: "right", width: 80 },
                      ]}
                    />
                  )
                }]}
              />
            </Card>
          )}

          <Card
            title={
              <span>
                渠道商排行榜
                <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>
                  <Segmented
                    size="small"
                    value={rankingMetric}
                    onChange={v => { setRankingMetric(v); setSelectedChannelInTable(null); setRankingGrowthSortYoY(null); setRankingGrowthSortQoQ(null); }}
                    options={[
                      { label: "通话分钟数", value: "call_minutes" },
                      { label: "外呼量", value: "total_calls" },
                      { label: "接通量", value: "connected_calls" },
                    ]}
                  />
                  <span style={{ marginLeft: 8 }}>|</span>
                  <Segmented
                    size="small"
                    value={rankingGrowthSortYoY}
                    onChange={v => { setRankingGrowthSortYoY(v); setRankingGrowthSortQoQ(null); setSelectedChannelInTable(null); }}
                    options={[
                      { label: "按数值", value: null },
                      { label: "同比增长", value: "growth_desc" },
                      { label: "同比萎缩", value: "shrink_desc" },
                    ]}
                    style={{ marginLeft: 8 }}
                  />
                  <Segmented
                    size="small"
                    value={rankingGrowthSortQoQ}
                    onChange={v => { setRankingGrowthSortQoQ(v); setRankingGrowthSortYoY(null); setSelectedChannelInTable(null); }}
                    options={[
                      { label: "环比增长", value: "growth_desc" },
                      { label: "环比萎缩", value: "shrink_desc" },
                    ]}
                    style={{ marginLeft: 4 }}
                  />
                  <span style={{ marginLeft: 8 }}>
                    {rankingGrowthSortYoY || rankingGrowthSortQoQ ? null : (
                      <>
                        <span style={{ color: "#52c41a" }}>●</span> 优秀&nbsp;
                        <span style={{ color: "#5470c6" }}>●</span> 正常&nbsp;
                        <span style={{ color: "#ff4d4f" }}>●</span> 需关注&nbsp;
                        [中位数 {numFmt(rankingStats.median)} / 平均 {numFmt(rankingStats.avg)}]
                      </>
                    )}
                  </span>
                </span>
              </span>
            }
            bordered={false}
            extra={
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#888" }}>显示列：</span>
                <Select
                  mode="multiple"
                  size="small"
                  value={currentVisible}
                  onChange={v => { setVisibleColumns(v); try { localStorage.setItem("channelpage_visible_cols", JSON.stringify(v)); } catch {} }}
                  style={{ minWidth: 160 }}
                  options={ALL_COLUMNS.map(c => ({ label: c.label, value: c.key }))}
                  maxTagCount={2}
                />
                {selectedChannelName && (
                  <span style={{ fontSize: 12, color: "#1677ff", cursor: "pointer" }} onClick={() => { setSelectedChannelInTable(null); setSelectedChannel(null); }}>
                    清除选择
                  </span>
                )}
              </span>
            }
          >
            <Table
              columns={finalRankingColumns}
              dataSource={channelRanking}
              rowKey="channel_name"
              pagination={false}
              size="small"
              rowClassName={row => selectedChannelInTable === row.channel_name ? "ant-table-row-selected" : ""}
              onRow={row => ({
                onClick: () => {
                  const next = selectedChannelInTable === row.channel_name ? null : row.channel_name;
                  setSelectedChannelInTable(next);
                  setSelectedChannel(next);
                },
                style: { cursor: "pointer" },
              })}
              loading={loading}
            />
          </Card>
        </Col>

        {/* 右侧：渠道商详情（选中后出现） */}
        {selectedChannelName && (
          <Col span={14}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Top3 客户 */}
              <Card
                title={`${selectedChannelName} — Top3 客户`}
                bordered={false}
                size="small"
                extra={
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      sessionStorage.setItem("init_channel", selectedChannelName || "");
                      sessionStorage.setItem("init_companies", JSON.stringify(channelCompanies));
                      props.onNavigateToCustomer && props.onNavigateToCustomer(selectedChannelName);
                    }}
                  >
                    去查看 →
                  </Button>
                }
              >
                {topCustomers.length === 0 ? (
                  <div style={{ color: "#aaa", textAlign: "center", padding: 12 }}>暂无数据</div>
                ) : (
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 12, padding: "8px 0" }}>
                    {/* 亚军(2) */}
                    {topCustomers[1] && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 100 }}>
                        <div style={{ fontSize: 22, marginBottom: 4 }}>🥈</div>
                        <div style={{ fontSize: 12, color: "#8c8c8c", fontWeight: 600, marginBottom: 2 }}>{topCustomers[1].company_name}</div>
                        <div style={{ fontSize: 11, color: "#aaa" }}>{numFmt(topCustomers[1][rankingMetric])}</div>
                        <div style={{
                          width: "100%", height: 56, background: "linear-gradient(135deg, #c0c0c0, #e8e8e8)",
                          borderRadius: "4px 4px 0 0", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 20, fontWeight: 700, color: "#666"
                        }}>2</div>
                      </div>
                    )}
                    {/* 冠军(1) */}
                    {topCustomers[0] && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 120 }}>
                        <div style={{ fontSize: 28, marginBottom: 4 }}>🥇</div>
                        <div style={{ fontSize: 13, color: "#fa8c16", fontWeight: 700, marginBottom: 2 }}>{topCustomers[0].company_name}</div>
                        <div style={{ fontSize: 12, color: "#aaa" }}>{numFmt(topCustomers[0][rankingMetric])}</div>
                        <div style={{
                          width: "100%", height: 80, background: "linear-gradient(135deg, #FFD700, #FFA500)",
                          borderRadius: "6px 6px 0 0", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 24, fontWeight: 800, color: "#fff"
                        }}>1</div>
                      </div>
                    )}
                    {/* 季军(3) */}
                    {topCustomers[2] && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 100 }}>
                        <div style={{ fontSize: 20, marginBottom: 4 }}>🥉</div>
                        <div style={{ fontSize: 12, color: "#ce9b5b", fontWeight: 600, marginBottom: 2 }}>{topCustomers[2].company_name}</div>
                        <div style={{ fontSize: 11, color: "#aaa" }}>{numFmt(topCustomers[2][rankingMetric])}</div>
                        <div style={{
                          width: "100%", height: 40, background: "linear-gradient(135deg, #b87333, #d4a76a)",
                          borderRadius: "4px 4px 0 0", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 20, fontWeight: 700, color: "#fff"
                        }}>3</div>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {/* 统计卡片 */}
              <Row gutter={[12, 12]}>
                {[
                  { title: "总外呼量", value: numFmt(channelOverview?.total_calls), icon: <PhoneOutlined />, color: "#5470c6" },
                  { title: "总通话分钟数", value: numFmt(channelOverview?.call_minutes), icon: <ClockCircleOutlined />, color: "#fac858" },
                  { title: "平均接通率", value: avgConnectRate, icon: <CheckCircleOutlined />, color: "#91cc75" },
                  { title: "AB意向率", value: intentRate, icon: <RiseOutlined />, color: "#ee6666" },
                ].map(item => (
                  <Col xs={12} sm={6} key={item.title}>
                    <Card bordered={false} size="small" style={{ borderTop: `3px solid ${item.color}` }}>
                      <Statistic
                        title={<span style={{ fontSize: 12 }}>{item.title}</span>}
                        value={item.value}
                        prefix={<span style={{ color: item.color }}>{item.icon}</span>}
                      />
                    </Card>
                  </Col>
                ))}
              </Row>

              {/* 趋势图 */}
              <Card title={chartTitle} bordered={false} size="small">
                <TrendChart title={chartTitle} data={channelTrend} isDaily={isDaily} granularity={timeRange?.granularity} />
              </Card>

              {/* 月度环比表 */}
              <Card
                title={isDaily ? "日环比" : "月度环比（环比：与上月比；同比：与去年同月比）"}
                bordered={false}
                size="small"
              >
                <Table
                  columns={trendColumns}
                  dataSource={trendWithDelta}
                  rowKey={isWeekMode ? "period_key" : isDaily ? "date" : "period_key"}
                  pagination={false}
                  size="small"
                  scroll={{ x: isWeekMode ? 1100 : isDaily ? 800 : 1100 }}
                />
              </Card>
            </div>
          </Col>
        )}
      </Row>
    </div>
  );
}
