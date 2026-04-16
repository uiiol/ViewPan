import { useEffect, useState, useMemo, useRef } from "react";
import { Row, Col, Card, Table, Segmented, Badge, Select, Button, Input, Collapse } from "antd";
import { PhoneOutlined, CheckCircleOutlined, ClockCircleOutlined, RiseOutlined } from "@ant-design/icons";
import { Statistic } from "antd";
import FilterBar from "../components/FilterBar";
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


export default function CustomerPage() {
  const [years, setYears] = useState([]);
  const [channels, setChannels] = useState([]);
  const [companies, setCompanies] = useState([]);

  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState("full-year");
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [availableMonths, setAvailableMonths] = useState([]);
  const [customStart, setCustomStart] = useState(null);
  const [customEnd, setCustomEnd] = useState(null);

  const [overview, setOverview] = useState(null);
  const [trendData, setTrendData] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [rankingMetric, setRankingMetric] = useState("call_minutes");
  const [rankingLimit, setRankingLimit] = useState(20);
  const [rankingGrowthSort, setRankingGrowthSort] = useState(null); // null | "growth_desc" | "shrink_desc"
  const [selectedCustomerInTable, setSelectedCustomerInTable] = useState(null);
  const [customerTrend, setCustomerTrend] = useState([]);
  const [customerAnalysis, setCustomerAnalysis] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiRetryCount, setAiRetryCount] = useState(0);
  const [aiResultCollapsed, setAiResultCollapsed] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState(null); // null = all visible

  const [loading, setLoading] = useState(true);

  // AI 分析缓存（localStorage）
  const getAiCacheKey = (companyId, year) => `ai_analysis_${companyId}_${year}`;
  const loadAiCache = (companyId, year) => {
    try {
      const raw = localStorage.getItem(getAiCacheKey(companyId, year));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };
  const saveAiCache = (companyId, year, result) => {
    try {
      localStorage.setItem(getAiCacheKey(companyId, year), JSON.stringify(result));
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getYears(), api.getChannels()]).then(([y, ch]) => {
      if (cancelled) return;
      const latest = y.length ? y[y.length - 1] : 2026;
      setYears(y);
      setChannels(ch);
      setSelectedYear(latest);
      api.getMonths(latest).then(m => { if (!cancelled) setAvailableMonths(m); });
    });
    return () => { cancelled = true; };
  }, []);

  // 年份变化时重新获取可用月份
  useEffect(() => {
    if (!selectedYear) return;
    api.getMonths(selectedYear).then(setAvailableMonths);
  }, [selectedYear]);

  // 选中客户时，获取其12个月趋势 + 加载缓存的AI结果
  useEffect(() => {
    const custId = selectedCompany || selectedCustomerInTable;
    if (!custId || !selectedYear) {
      setCustomerTrend([]);
      setCustomerAnalysis("");
      setAiResult("");
      setAiError(null);
      setAiRetryCount(0);
      return;
    }
    // 加载缓存的AI分析结果，有内容则展开
    const cached = loadAiCache(custId, selectedYear);
    if (cached) {
      setAiResult(cached.analysis || "");
      setCustomerAnalysis(cached.user_analysis || "");
      if (cached.analysis) setAiResultCollapsed(false);
    } else {
      setAiResult("");
      setCustomerAnalysis("");
    }
    api.getMonthlyTrend({
      year: selectedYear,
      company_id: custId,
    }).then(data => {
      const sorted = Array.isArray(data) ? [...data].sort((a, b) => a.month - b.month) : [];
      setCustomerTrend(sorted.slice(-12));
    });
  }, [selectedCustomerInTable, selectedYear, selectedCompany]);

  // 渠道变化时联动客户列表
  useEffect(() => {
    api.getCompanies(selectedChannel ? { channel_name: selectedChannel } : {}).then(c => {
      setCompanies(c);
      if (selectedCompany) {
        const valid = c.some(co => co.id === selectedCompany);
        if (!valid) setSelectedCompany(null);
      }
    });
  }, [selectedChannel]);

  useEffect(() => {
    if (!selectedYear) return;
    const abortCtrl = new AbortController();

    setLoading(true);
    // 筛客户优先，其次点击客户
    const activeCustomerId = selectedCompany || selectedCustomerInTable;
    let quarter = null, month = null, monthStart = null, monthEnd = null;

    if (selectedPeriod === "full-year") {}
    else if (["Q1", "Q2", "Q3", "Q4"].includes(selectedPeriod)) quarter = selectedPeriod;
    else if (selectedPeriod === "first-half") { quarter = "H1"; }
    else if (selectedPeriod === "second-half") { quarter = "H2"; }
    else if (selectedPeriod.startsWith("month-")) {
      month = parseInt(selectedPeriod.replace("month-", ""));
      monthStart = dayjs(`${selectedYear}-${String(month).padStart(2, "0")}-01`);
      monthEnd = monthStart.endOf("month");
    }

    const params = { year: selectedYear };
    if (quarter) params.quarter = quarter;
    if (month) params.month = month;
    if (selectedPeriod === "custom" && customStart && customEnd) {
      params.start_date = `${selectedYear}-${String(customStart).padStart(2, "0")}-01`;
      params.end_date = `${selectedYear}-${String(customEnd).padStart(2, "0")}-01`;
    }
    if (selectedChannel) params.channel_name = selectedChannel;
    if (activeCustomerId) params.company_id = activeCustomerId;

    const isDailyMode = month !== null;
    const trendParams = { year: selectedYear };
    if (selectedChannel) trendParams.channel_name = selectedChannel;
    if (activeCustomerId) trendParams.company_id = activeCustomerId;
    if (isDailyMode) {
      trendParams.start_date = monthStart.format("YYYY-MM-DD");
      trendParams.end_date = monthEnd.format("YYYY-MM-DD");
    } else if (selectedPeriod === "custom" && customStart && customEnd) {
      trendParams.start_date = `${selectedYear}-${String(customStart).padStart(2, "0")}-01`;
      trendParams.end_date = `${selectedYear}-${String(customEnd).padStart(2, "0")}-01`;
      trendParams.compare_year = selectedYear - 1;
    } else if (quarter) {
      trendParams.quarter = quarter;
    } else {
      // 非日模式：月度/全年趋势带上同比
      trendParams.compare_year = selectedYear - 1;
    }

    const rankingParams = {
      year: selectedYear, channel_name: selectedChannel, company_id: activeCustomerId, quarter, month,
      metric: rankingMetric, limit: rankingLimit,
      start_date: params.start_date, end_date: params.end_date,
    };
    if (rankingGrowthSort) {
      rankingParams.sort_by_growth = rankingGrowthSort;
      rankingParams.compare_year = selectedYear - 1;
    }

    Promise.all([
      api.getOverview(params),
      isDailyMode ? api.getDailyTrend(trendParams) : api.getMonthlyTrend(trendParams),
      api.getCompanyRanking(rankingParams),
    ]).then(([ov, trend, rk]) => {
      if (abortCtrl.signal.aborted) return;
      setOverview(ov);
      setTrendData(Array.isArray(trend) ? trend : []);
      setRanking(Array.isArray(rk) ? rk : []);
      setLoading(false);
    }).catch(err => {
      if (err.name === "CanceledError") return;
      console.error(err);
      setLoading(false);
    });

    return () => abortCtrl.abort();
  }, [selectedYear, selectedPeriod, selectedChannel, selectedCompany, selectedCustomerInTable, rankingMetric, rankingLimit, rankingGrowthSort, customStart, customEnd]);

  const avgConnectRate = overview?.avg_connect_rate ? pctFmt(overview.avg_connect_rate) : "-";
  const intentRate = overview?.ab_intent && overview?.connected_calls
    ? pctFmt(overview.ab_intent / overview.connected_calls)
    : "-";

  const trendWithDelta = useMemo(() => trendData.map((row, i) => {
    const prev = i > 0 ? trendData[i - 1] : null;
    const qoq = {
      calls_delta: deltaFmt(row.total_calls, prev?.total_calls),
      minutes_delta: deltaFmt(row.call_minutes, prev?.call_minutes),
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
  }), [trendData]);

  const isDaily = useMemo(() => trendData.length > 0 && !("month" in trendData[0]), [trendData]);
  const chartTitle = isDaily ? "日趋势（外呼量 / 通话分钟数 / 接通率 / 意向率）" : "月度趋势（外呼量 / 通话分钟数 / 接通率 / 意向率）";

  const deltaTag = (delta) => {
    if (!delta) return <span style={{ color: "#aaa" }}>-</span>;
    return (
      <span
        style={{ color: delta.type === "up" ? "#52c41a" : "#ff4d4f", fontSize: 12, cursor: "default" }}
        title={delta.absDelta != null ? `绝对值：${delta.absDelta >= 0 ? "+" : ""}${numFmt(Math.abs(delta.absDelta))}` : undefined}
      >
        {delta.text}
      </span>
    );
  };

  const deltaColumns = isDaily
    ? [
        { title: "日期", dataIndex: "date", key: "date", render: d => (d || "").slice(5), width: 80 },
        { title: "外呼量", dataIndex: "total_calls", key: "total_calls", render: v => numFmt(v), align: "right" },
        { title: "环比", dataIndex: "calls_delta", key: "calls_delta", render: deltaTag, align: "right" },
        { title: "通话分钟数", dataIndex: "call_minutes", key: "call_minutes", render: v => numFmt(v), align: "right" },
        { title: "环比", dataIndex: "minutes_delta", key: "minutes_delta", render: deltaTag, align: "right" },
        { title: "接通率", dataIndex: "avg_connect_rate", key: "avg_connect_rate", render: v => pctFmt(v), align: "right" },
        { title: "环比", dataIndex: "connect_rate_delta", key: "connect_rate_delta", render: deltaTag, align: "right" },
        { title: "意向率", dataIndex: "intent_rate", key: "intent_rate", render: v => pctFmt(v), align: "right" },
        { title: "环比", dataIndex: "intent_rate_delta", key: "intent_rate_delta", render: deltaTag, align: "right" },
      ]
    : [
        { title: "月份", dataIndex: "month", key: "month", render: m => `${Math.round(m)}月`, width: 60 },
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

  const custRankingStats = useMemo(() => {
    return statsFromArr(ranking, rankingMetric);
  }, [ranking, rankingMetric]);
  const getCustRankColor = (val) => {
    if (showGrowthCol) {
      if (val == null) return "#5470c6";
      return val >= 0 ? "#52c41a" : "#ff4d4f";
    }
    if (val == null || !custRankingStats.q3) return "#5470c6";
    if (val >= custRankingStats.q3) return "#52c41a";
    if (val <= custRankingStats.q1) return "#ff4d4f";
    return "#5470c6";
  };

  // 分钟数占比（当前指标=通话分钟数时，显示各客户占总通话分钟数的比例）
  const totalCallMinutes = useMemo(() => ranking.reduce((s, r) => s + (r.call_minutes || 0), 0), [ranking]);

  const metricLabel = { call_minutes: "通话分钟数", total_calls: "外呼量", connected_calls: "接通量" };
  const showGrowthCol = rankingGrowthSort != null;
  const growthFmt = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const rankingOption = {
    animation: true,
    animationDuration: 600,
    animationEasing: "cubicOut",
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" },
      formatter: params => {
        const d = params[0];
        const item = ranking.find(r => r.company_name === d.name);
        const channel = item?.channel_name || "-";
        if (showGrowthCol && item) {
          const curr = item[rankingMetric] || 0;
          const prev = item[`prev_${rankingMetric}`] || 0;
          const absDelta = curr - prev;
          const absSign = absDelta >= 0 ? "+" : "";
          return `${d.name}<br/>渠道商: ${channel}<br/>` +
            `同比增长率: ${growthFmt(d.value)}<br/>` +
            `同比绝对值: ${absSign}${numFmt(absDelta)}<br/>` +
            `当期: ${numFmt(curr)} / 同期: ${numFmt(prev)}`;
        }
        return `${d.name}<br/>渠道商: ${channel}<br/>${metricLabel[rankingMetric]}: ${numFmt(d.value)}`;
      },
    },
    grid: { left: 150, right: 80, bottom: 20, top: 20 },
    xAxis: {
      type: "value",
      axisLabel: {
        formatter: showGrowthCol ? v => growthFmt(v) : v => numFmt(v),
      },
      show: true,
    },
    yAxis: {
      type: "category",
      data: [...ranking].reverse().map(d => d.company_name),
      axisLabel: { width: 140, overflow: "truncate" },
    },
    series: [{
      type: "bar",
      data: [...ranking].reverse().map(d => ({
        value: showGrowthCol ? d.growth_rate : d[rankingMetric],
        itemStyle: { color: getCustRankColor(showGrowthCol ? d.growth_rate : d[rankingMetric]) },
      })),
      label: {
        show: true, position: "right",
        formatter: p => showGrowthCol ? growthFmt(p.value) : numFmt(p.value),
      },
    }],
  };

  const handleChartClick = (params) => {
    const clickedName = params.name;
    const clickedRow = ranking.find(r => r.company_name === clickedName);
    if (clickedRow) {
      setSelectedCustomerInTable(selectedCustomerInTable === clickedRow.company_id ? null : clickedRow.company_id);
    }
  };

  const customerTrendOption = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 60, right: 20, bottom: 30, top: 30 },
    xAxis: { type: "category", data: customerTrend.map(d => `${Math.round(d.month)}月`) },
    yAxis: { type: "value", axisLabel: { formatter: v => numFmt(v) } },
    series: [{
      type: "bar",
      data: customerTrend.map(d => d[rankingMetric]),
      itemStyle: { color: "#5470c6" },
      label: { show: true, position: "top", formatter: p => numFmt(p.value), fontSize: 9 },
    }],
  };

  const rankingColumns = [
    { title: "排名", key: "rank", width: 50, render: (_, __, i) => i + 1, sorter: false },
    {
      title: "客户名称",
      dataIndex: "company_name",
      key: "company_name",
      ellipsis: true,
      sorter: { compare: (a, b) => a.company_name.localeCompare(b.company_name) },
      render: (v, row) => {
        const color = getCustRankColor(row[rankingMetric]);
        const tag = color && color !== "#5470c6" ? <span style={{ color, fontWeight: 600 }}>●</span> : null;
        return (
          <span
            style={{ color: selectedCustomerInTable === row.company_id ? "#1677ff" : undefined, cursor: "pointer", fontWeight: selectedCustomerInTable === row.company_id ? 600 : 400 }}
            onClick={() => setSelectedCustomerInTable(selectedCustomerInTable === row.company_id ? null : row.company_id)}
          >
            {selectedCustomerInTable === row.company_id ? <Badge color="blue" text={v} /> : tag}{" "}{v}
          </span>
        );
      },
    },
    { title: "渠道商", dataIndex: "channel_name", key: "channel_name", ellipsis: true, width: 180,
      sorter: { compare: (a, b) => (a.channel_name || "").localeCompare(b.channel_name || "") },
    },
    {
      title: metricLabel[rankingMetric],
      dataIndex: rankingMetric,
      key: rankingMetric,
      render: (v, row) => {
        const color = getCustRankColor(v);
        return <span style={{ color: color || undefined, fontWeight: color && color !== "#5470c6" ? 600 : 400 }}>{numFmt(v)}</span>;
      },
      align: "right",
      sorter: { compare: (a, b) => (a[rankingMetric] || 0) - (b[rankingMetric] || 0) },
    },
    { title: "外呼量", dataIndex: "total_calls", key: "total_calls", render: v => numFmt(v), align: "right",
      sorter: { compare: (a, b) => (a.total_calls || 0) - (b.total_calls || 0) },
    },
    { title: "接通量", dataIndex: "connected_calls", key: "connected_calls", render: v => numFmt(v), align: "right",
      sorter: { compare: (a, b) => (a.connected_calls || 0) - (b.connected_calls || 0) },
    },
    { title: "平均接通率", dataIndex: "avg_connect_rate", key: "avg_connect_rate", render: v => pctFmt(v), align: "right",
      sorter: { compare: (a, b) => (a.avg_connect_rate || 0) - (b.avg_connect_rate || 0) },
    },
    { title: "AB意向率", dataIndex: "intent_rate", key: "intent_rate", render: v => pctFmt(v), align: "right",
      sorter: { compare: (a, b) => (a.intent_rate || 0) - (b.intent_rate || 0) },
    },
    {
      title: "分钟数占比",
      key: "minutes_share",
      render: (_, row) => {
        if (!totalCallMinutes || !row.call_minutes) return "-";
        return pctFmt(row.call_minutes / totalCallMinutes);
      },
      align: "right",
      sorter: { compare: (a, b) => (a.call_minutes || 0) - (b.call_minutes || 0) },
    },
    ...(showGrowthCol ? [{
      title: "同比增长率",
      key: "growth_rate",
      render: (_, row) => {
        if (row.growth_rate == null) return <span style={{ color: "#aaa" }}>无同期</span>;
        const sign = row.growth_rate >= 0 ? "+" : "";
        const color = row.growth_rate >= 0 ? "#52c41a" : "#ff4d4f";
        return <span style={{ color, fontWeight: 600 }}>{sign}{(row.growth_rate * 100).toFixed(1)}%</span>;
      },
      align: "right",
      sorter: { compare: (a, b) => (a.growth_rate ?? -Infinity) - (b.growth_rate ?? -Infinity) },
    }] : []),
  ];

  // 可选列定义（key → label）
  const ALL_COLUMNS = [
    { key: "channel_name", label: "渠道商" },
    { key: "call_minutes", label: "通话分钟数" },
    { key: "total_calls", label: "外呼量" },
    { key: "connected_calls", label: "接通量" },
    { key: "avg_connect_rate", label: "平均接通率" },
    { key: "intent_rate", label: "AB意向率" },
    { key: "minutes_share", label: "分钟数占比" },
    ...(showGrowthCol ? [{ key: "growth_rate", label: "同比增长率" }] : []),
  ];
  // 默认全部选中
  const defaultVisible = ALL_COLUMNS.map(c => c.key);
  const currentVisible = visibleColumns || defaultVisible;
  const filteredColumns = rankingColumns.filter(col => {
    // 排名和客户名称始终显示
    if (col.key === "rank" || col.key === "company_name") return true;
    return currentVisible.includes(col.key);
  });

  // 筛选项选客户时，同步更新排行榜选中态
  useEffect(() => {
    if (selectedCompany !== null) {
      setSelectedCustomerInTable(selectedCompany);
    }
  }, [selectedCompany]);

  // 选中的客户对象（筛客户优先，其次点击客户）
  const selectedCustomer = selectedCompany
    ? ranking.find(r => r.company_id === selectedCompany)
    : (selectedCustomerInTable ? ranking.find(r => r.company_id === selectedCustomerInTable) : null);

  return (
    <div style={{ padding: "20px 24px" }}>
      {/* ① 筛选栏（始终固定顶部） */}
      <Card bordered={false} style={{ marginBottom: 16, position: "sticky", top: 64, zIndex: 100 }}>
        <FilterBar
          years={years} selectedYear={selectedYear} onYearChange={y => { setSelectedYear(y); setSelectedPeriod("full-year"); }}
          selectedPeriod={selectedPeriod} onPeriodChange={p => { setSelectedPeriod(p); }}
          channels={channels} selectedChannel={selectedChannel} onChannelChange={v => { setSelectedChannel(v); if (!v) setSelectedCompany(null); }}
          companies={companies} selectedCompany={selectedCompany} onCompanyChange={setSelectedCompany}
          showCompany={true}
          availableMonths={availableMonths}
          customStart={customStart} customEnd={customEnd}
          onCustomRangeChange={(s, e) => { setCustomStart(s); setCustomEnd(e); }}
        />
      </Card>

      {/* ② 客户排行榜 + 客户详情（左右布局） */}
      <Row gutter={[16, 16]} align="stretch">
        {/* 左侧：排行榜（图表 + 表格） */}
        <Col span={selectedCustomer ? 10 : 24} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 排行榜图表 */}
          <Card
            title={
              <span>
                客户排行榜 TOP
                <Select
                  size="small"
                  value={rankingLimit}
                  onChange={v => { setRankingLimit(v); setSelectedCustomerInTable(null); }}
                  style={{ width: 80, marginLeft: 6, marginRight: 12 }}
                  options={[
                    { label: "TOP20", value: 20 },
                    { label: "TOP50", value: 50 },
                    { label: "TOP100", value: 100 },
                    { label: "全部", value: 0 },
                  ]}
                />
                <span style={{ fontSize: 12, color: "#888" }}>
                  <Segmented
                    size="small"
                    value={rankingMetric}
                    onChange={v => { setRankingMetric(v); setSelectedCustomerInTable(null); setRankingGrowthSort(null); }}
                    options={[
                      { label: "通话分钟数", value: "call_minutes" },
                      { label: "外呼量", value: "total_calls" },
                      { label: "接通量", value: "connected_calls" },
                    ]}
                  />
                  <span style={{ marginLeft: 8 }}>|</span>
                  <Segmented
                    size="small"
                    value={rankingGrowthSort}
                    onChange={v => { setRankingGrowthSort(v); setSelectedCustomerInTable(null); }}
                    options={[
                      { label: "按数值", value: null },
                      { label: "📈 增长最快", value: "growth_desc" },
                      { label: "📉 萎缩最大", value: "shrink_desc" },
                    ]}
                    style={{ marginLeft: 8 }}
                  />
                  <span style={{ marginLeft: 8 }}>
                    {rankingGrowthSort ? null : (
                      <>
                        <span style={{ color: "#52c41a" }}>●</span> 优秀&nbsp;
                        <span style={{ color: "#5470c6" }}>●</span> 正常&nbsp;
                        <span style={{ color: "#ff4d4f" }}>●</span> 需关注&nbsp;
                        [中位数 {numFmt(custRankingStats.median)} / 平均 {numFmt(custRankingStats.avg)}]
                      </>
                    )}
                  </span>
                </span>
              </span>
            }
            bordered={false}
          >
            <EChart option={rankingOption} style={{ height: Math.max(300, ranking.length * 28) }} onChartClick={handleChartClick} />
          </Card>

          {/* 客户明细表格 */}
          <Card
            title="客户明细"
            bordered={false}
            extra={
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#888" }}>显示列：</span>
                <Select
                  mode="multiple"
                  size="small"
                  value={currentVisible}
                  onChange={v => setVisibleColumns(v)}
                  style={{ minWidth: 160 }}
                  options={ALL_COLUMNS.map(c => ({ label: c.label, value: c.key }))}
                  maxTagCount={2}
                  placeholder="选择列"
                />
                {selectedCustomer && (
                  <span style={{ fontSize: 12, color: "#1677ff", cursor: "pointer" }} onClick={() => setSelectedCustomerInTable(null)}>
                    清除选择
                  </span>
                )}
              </span>
            }
            bodyStyle={{ padding: selectedCustomer ? undefined : 0 }}
          >
            <Table
              columns={filteredColumns}
              dataSource={ranking}
              rowKey="company_id"
              pagination={selectedCompany ? false : { pageSize: rankingLimit }}
              size="small"
              rowClassName={row => selectedCustomerInTable === row.company_id ? "ant-table-row-selected" : ""}
              onRow={row => ({
                onClick: () => setSelectedCustomerInTable(selectedCustomerInTable === row.company_id ? null : row.company_id),
                style: { cursor: "pointer" },
              })}
            />
          </Card>
        </Col>

        {/* 右侧：客户详情（选中后出现，始终固定在画面中） */}
        {selectedCustomer && (
          <Col span={14}>
            {/* 随页面自然滚动，移除了 sticky */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* AI分析（置顶） */}
              <Card
                title={
                  <span>
                    {selectedCustomer.company_name}
                    <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>[{selectedCustomer.channel_name}]</span>
                    <span style={{ fontSize: 12, color: "#aaa", marginLeft: 8 }}>
                      AI 分析
                    </span>
                    <span style={{ marginLeft: 8 }}>
                      <Button
                        type="text"
                        size="small"
                        onClick={() => setAiResultCollapsed(c => !c)}
                        style={{ fontSize: 12, color: aiResultCollapsed ? "#1677ff" : "#888" }}
                      >
                        {aiResultCollapsed ? "▶ 展开" : "▼ 折叠"}
                      </Button>
                    </span>
                  </span>
                }
                bordered={false}
                size="small"
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#888" }}>基于该客户的历史数据生成分析报告</span>
                  <Button
                    type="primary"
                    size="small"
                    disabled={aiLoading}
                    onClick={() => {
                      const overviewData = {
                        total_calls: selectedCustomer.total_calls,
                        connected_calls: selectedCustomer.connected_calls,
                        call_minutes: selectedCustomer.call_minutes,
                        avg_connect_rate: selectedCustomer.avg_connect_rate,
                        intent_rate: selectedCustomer.intent_rate,
                        year: selectedYear,
                      };
                      setAiLoading(true);
                      setAiError(null);
                      setAiRetryCount(0);

                      const doRequest = (retryCount) => {
                        api.postAiAnalysis({
                          company_name: selectedCustomer.company_name,
                          channel_name: selectedCustomer.channel_name,
                          overview: overviewData,
                          monthly_data: customerTrend,
                          user_analysis: customerAnalysis,
                          ranking_metric: rankingMetric,
                        }).then(res => {
                          const analysisResult = res.analysis || "AI 暂未返回分析内容";
                          setAiResult(analysisResult);
                          setAiLoading(false);
                          setAiRetryCount(0);
                          // 覆盖式缓存
                          saveAiCache(selectedCustomer.company_id, selectedYear, {
                            analysis: analysisResult,
                            user_analysis: customerAnalysis,
                          });
                        }).catch(err => {
                          const detail = err?.response?.data?.detail || "";
                          if (detail.includes("负载较高") && retryCount < 3) {
                            setAiRetryCount(retryCount + 1);
                            setAiError(`服务繁忙，${(retryCount + 1) * 5}秒后自动重试... (${retryCount + 1}/3)`);
                            setTimeout(() => doRequest(retryCount + 1), (retryCount + 1) * 5000);
                          } else if (detail.includes("负载较高") && retryCount >= 3) {
                            setAiError("服务负载过高，请稍后再试");
                            setAiLoading(false);
                            setAiRetryCount(0);
                          } else {
                            setAiError(detail || "AI 分析请求失败");
                            setAiLoading(false);
                            setAiRetryCount(0);
                          }
                        });
                      };

                      doRequest(0);
                    }}
                  >
                    {aiLoading ? (aiRetryCount > 0 ? `重试中 (${aiRetryCount}/3)` : "分析中...") : "AI 分析"}
                  </Button>
                </div>
                {!aiResultCollapsed ? (
                  <>
                    <Input.TextArea
                      rows={3}
                      placeholder="记录您对该客户的分析判断，分析结果将显示在下方..."
                      value={customerAnalysis}
                      onChange={e => setCustomerAnalysis(e.target.value)}
                      style={{ marginBottom: 12 }}
                    />
                    {aiError && (
                      <div style={{
                        color: aiError.includes("自动重试") ? "#fa8c16" : "#ff4d4f",
                        fontSize: 12,
                        marginBottom: 8,
                        padding: "6px 10px",
                        background: aiError.includes("自动重试") ? "#fff7e6" : "#fff1f0",
                        borderRadius: 4,
                        border: `1px solid ${aiError.includes("自动重试") ? "#ffd591" : "#ffccc7"}`,
                      }}>
                        {aiError}
                      </div>
                    )}
                    {aiResult && (
                      <div style={{ background: "#f5f5f5", borderRadius: 6, padding: "10px 12px", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                        {aiResult}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: "#aaa", fontSize: 12, textAlign: "center", padding: "8px 0" }}>
                    分析内容已折叠，点击上方"展开"查看
                  </div>
                )}
              </Card>

              {/* 统计卡片 */}
              <Row gutter={[12, 12]}>
                {[
                  { title: "总外呼量", value: numFmt(selectedCustomer.total_calls), icon: <PhoneOutlined />, color: "#5470c6" },
                  { title: "总通话分钟数", value: numFmt(selectedCustomer.call_minutes), icon: <ClockCircleOutlined />, color: "#fac858" },
                  { title: "平均接通率", value: pctFmt(selectedCustomer.avg_connect_rate), icon: <CheckCircleOutlined />, color: "#91cc75" },
                  { title: "AB意向率", value: pctFmt(selectedCustomer.intent_rate), icon: <RiseOutlined />, color: "#ee6666" },
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
                <TrendChart title={chartTitle} data={trendData} isDaily={isDaily} />
              </Card>

              {/* 环比表 */}
              <Card
                title={isDaily ? "日环比" : "月度环比（环比：与上月比；同比：与去年同月比）"}
                bordered={false}
                size="small"
              >
                <Table
                  columns={deltaColumns}
                  dataSource={trendWithDelta}
                  rowKey={isDaily ? "date" : "month"}
                  pagination={false}
                  size="small"
                  scroll={{ x: isDaily ? 800 : 1100 }}
                />
              </Card>
            </div>
          </Col>
        )}
      </Row>
    </div>
  );
}
