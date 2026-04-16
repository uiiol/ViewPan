import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Row, Col, Card, Table, Segmented, Badge, Select, Button } from "antd";
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

export default function ChannelPage(props) {
  const [years, setYears] = useState([]);
  const [channels, setChannels] = useState([]);

  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState("full-year");
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [availableMonths, setAvailableMonths] = useState([]);
  const [customStart, setCustomStart] = useState(null);
  const [customEnd, setCustomEnd] = useState(null);

  const [rankingMetric, setRankingMetric] = useState("call_minutes");
  const [rankingGrowthSort, setRankingGrowthSort] = useState(null);
  const [selectedChannelInTable, setSelectedChannelInTable] = useState(null);

  const [channelOverview, setChannelOverview] = useState(null);
  const [channelTrend, setChannelTrend] = useState([]);
  const [channelRanking, setChannelRanking] = useState([]);
  const [loading, setLoading] = useState(true);
  const [topCustomers, setTopCustomers] = useState([]);
  const [channelCompanies, setChannelCompanies] = useState([]); // 当前选中渠道的全部客户
  const [concentration, setConcentration] = useState(null);

  const navigate = useNavigate();

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem("channelpage_visible_cols")); } catch { return null; }
  });

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

  useEffect(() => {
    if (!selectedYear) return;
    api.getMonths(selectedYear).then(setAvailableMonths);
  }, [selectedYear]);

  // 渠道商排行榜数据
  useEffect(() => {
    if (!selectedYear) return;
    const abortCtrl = new AbortController();
    setLoading(true);

    let quarter = null, month = null;
    if (selectedPeriod === "full-year") {}
    else if (["Q1", "Q2", "Q3", "Q4"].includes(selectedPeriod)) quarter = selectedPeriod;
    else if (selectedPeriod === "first-half") quarter = "H1";
    else if (selectedPeriod === "second-half") quarter = "H2";
    else if (selectedPeriod.startsWith("month-")) month = parseInt(selectedPeriod.replace("month-", ""));

    const rankingParams = {
      year: selectedYear, quarter, month, metric: rankingMetric, limit: 0,
      start_date: selectedPeriod === "custom" && customStart ? `${selectedYear}-${String(customStart).padStart(2, "0")}-01` : undefined,
      end_date: selectedPeriod === "custom" && customEnd ? `${selectedYear}-${String(customEnd).padStart(2, "0")}-01` : undefined,
      sort_by_growth: rankingGrowthSort,
    };
    const concParams = { year: selectedYear, quarter, month, metric: rankingMetric,
      start_date: rankingParams.start_date, end_date: rankingParams.end_date };

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
  }, [selectedYear, selectedPeriod, rankingMetric, rankingGrowthSort, customStart, customEnd]);

  // 选中渠道商后，获取详情数据
  useEffect(() => {
    const ch = selectedChannel || selectedChannelInTable;
    if (!ch || !selectedYear) {
      setChannelOverview(null);
      setChannelTrend([]);
      return;
    }

    let quarter = null, month = null;
    if (selectedPeriod === "full-year") {}
    else if (["Q1", "Q2", "Q3", "Q4"].includes(selectedPeriod)) quarter = selectedPeriod;
    else if (selectedPeriod === "first-half") quarter = "H1";
    else if (selectedPeriod === "second-half") quarter = "H2";
    else if (selectedPeriod.startsWith("month-")) month = parseInt(selectedPeriod.replace("month-", ""));

    const isDailyMode = month !== null;

    const params = { year: selectedYear, channel_name: ch };
    if (quarter) params.quarter = quarter;
    if (month) params.month = month;
    if (selectedPeriod === "custom" && customStart && customEnd) {
      params.start_date = `${selectedYear}-${String(customStart).padStart(2, "0")}-01`;
      params.end_date = `${selectedYear}-${String(customEnd).padStart(2, "0")}-01`;
    }

    const trendParams = { year: selectedYear, channel_name: ch };
    if (isDailyMode) {
      const monthStart = dayjs(`${selectedYear}-${String(month).padStart(2, "0")}-01`);
      trendParams.start_date = monthStart.format("YYYY-MM-DD");
      trendParams.end_date = monthStart.endOf("month").format("YYYY-MM-DD");
    } else if (selectedPeriod === "custom" && customStart && customEnd) {
      trendParams.start_date = `${selectedYear}-${String(customStart).padStart(2, "0")}-01`;
      trendParams.end_date = `${selectedYear}-${String(customEnd).padStart(2, "0")}-01`;
      trendParams.compare_year = selectedYear - 1;
    } else if (quarter) {
      trendParams.quarter = quarter;
    } else {
      trendParams.compare_year = selectedYear - 1;
    }

    Promise.all([
      api.getChannelOverview(params),
      isDailyMode ? api.getDailyTrend(trendParams) : api.getMonthlyTrend(trendParams),
    ]).then(([ov, trend]) => {
      setChannelOverview(ov);
      setChannelTrend(Array.isArray(trend) ? trend : []);
    });
  }, [selectedYear, selectedPeriod, selectedChannel, selectedChannelInTable, customStart, customEnd]);

  // 获取渠道商Top3客户
  useEffect(() => {
    const ch = selectedChannel || selectedChannelInTable;
    if (!ch || !selectedYear) {
      setTopCustomers([]);
      return;
    }
    let quarter = null, month = null;
    if (selectedPeriod === "full-year") {}
    else if (["Q1", "Q2", "Q3", "Q4"].includes(selectedPeriod)) quarter = selectedPeriod;
    else if (selectedPeriod === "first-half") quarter = "H1";
    else if (selectedPeriod === "second-half") quarter = "H2";
    else if (selectedPeriod.startsWith("month-")) month = parseInt(selectedPeriod.replace("month-", ""));

    Promise.all([
      api.getCompanyRanking({ year: selectedYear, quarter, month, channel_name: ch, metric: rankingMetric, limit: 3 }),
      api.getCompanies({ channel_name: ch }),
    ]).then(([r, comp]) => {
      setTopCustomers(Array.isArray(r) ? r : []);
      setChannelCompanies(Array.isArray(comp) ? comp : []);
    });
  }, [selectedYear, selectedPeriod, selectedChannel, selectedChannelInTable]);

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

  const trendWithDelta = useMemo(() => channelTrend.map((row, i) => {
    const prev = i > 0 ? channelTrend[i - 1] : null;
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
  }), [channelTrend]);

  const isDaily = useMemo(() => channelTrend.length > 0 && !("month" in channelTrend[0]), [channelTrend]);
  const chartTitle = isDaily ? "日趋势（外呼量 / 通话分钟数 / 接通率 / 意向率）" : "月度趋势（外呼量 / 通话分钟数 / 接通率 / 意向率）";

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
  const showGrowthCol = rankingGrowthSort != null;
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
    ...(showGrowthCol ? [{ key: "growth_rate", label: "同比增长率" }] : []),
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
        const color = showGrowthCol
          ? (row.growth_rate == null ? "#5470c6" : row.growth_rate >= 0 ? "#52c41a" : "#ff4d4f")
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
      title: "同比增长率",
      key: "growth_rate",
      render: (_, row) => {
        if (row.growth_rate == null) return <span style={{ color: "#aaa" }}>无同期</span>;
        const sign = row.growth_rate >= 0 ? "+" : "";
        const color = row.growth_rate >= 0 ? "#52c41a" : "#ff4d4f";
        const curr = row[rankingMetric] || 0;
        const prev = row[`prev_${rankingMetric}`] || 0;
        const absDelta = curr - prev;
        const absSign = absDelta >= 0 ? "+" : "";
        const tooltip = `同比绝对值：${absSign}${numFmt(absDelta)}\n当期：${numFmt(curr)}\n同期：${numFmt(prev)}`;
        return (
          <span style={{ color, fontWeight: 600, cursor: "default" }} title={tooltip}>
            {sign}{(row.growth_rate * 100).toFixed(1)}%
          </span>
        );
      },
      align: "right",
    }] : []),
  ];

  const monthlyColumns = [
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

  const selectedChannelName = selectedChannelInTable || selectedChannel;

  return (
    <div style={{ padding: "20px 24px" }}>
      <Card bordered={false} style={{ marginBottom: 16, position: "sticky", top: 64, zIndex: 100 }}>
        <FilterBar
          years={years} selectedYear={selectedYear} onYearChange={y => { setSelectedYear(y); setSelectedPeriod("full-year"); setRankingGrowthSort(null); }}
          selectedPeriod={selectedPeriod} onPeriodChange={p => { setSelectedPeriod(p); setRankingGrowthSort(null); }}
          channels={channels} selectedChannel={selectedChannel} onChannelChange={v => { setSelectedChannel(v); setRankingGrowthSort(null); }}
          availableMonths={availableMonths}
          customStart={customStart} customEnd={customEnd}
          onCustomRangeChange={(s, e) => { setCustomStart(s); setCustomEnd(e); }}
        />
      </Card>

      <Row gutter={[16, 16]} align="stretch">
        {/* 左侧：渠道商排行榜 */}
        <Col span={selectedChannelName ? 10 : 24} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 终端客户分布 — 始终显示在排行榜上方 */}
          {concentration && (
            <Card title={`终端客户分布`} bordered={false} size="small">
              <Row gutter={[12, 8]}>
                <Col span={4}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>外呼渠道数</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#5470c6" }}>
                    {concentration.total_channels}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>渠道总数</div>
                </Col>
                <Col span={5}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>二八法则</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: top20Contribution >= 0.8 ? "#ff4d4f" : top20Contribution >= 0.5 ? "#fa8c16" : "#52c41a" }}>
                    {(top20Contribution * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>前20名渠道占分钟数</div>
                </Col>
                <Col span={5}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>单客户撑起</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: concentration.single_cust_channel_count > 0 ? "#ff4d4f" : "#52c41a" }}>
                    {concentration.single_cust_channel_count}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>单客占比&gt;50%渠道数</div>
                </Col>
                <Col span={5}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>头部渠道</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: concentration.head_channel_count > 0 ? "#ff4d4f" : "#52c41a" }}>
                    {concentration.head_channel_count}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>月均 &gt; 20万分钟</div>
                </Col>
                <Col span={5}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>尾部渠道</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: concentration.tail_channel_count > 0 ? "#fa8c16" : "#52c41a" }}>
                    {concentration.tail_channel_count}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>月均 &lt; 1万分钟</div>
                </Col>
              </Row>
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
                    onChange={v => { setRankingMetric(v); setSelectedChannelInTable(null); setRankingGrowthSort(null); }}
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
                    onChange={v => { setRankingGrowthSort(v); setSelectedChannelInTable(null); }}
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
                <TrendChart title={chartTitle} data={channelTrend} isDaily={isDaily} />
              </Card>

              {/* 月度环比表 */}
              <Card
                title={isDaily ? "日环比" : "月度环比（环比：与上月比；同比：与去年同月比）"}
                bordered={false}
                size="small"
              >
                <Table
                  columns={monthlyColumns}
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
