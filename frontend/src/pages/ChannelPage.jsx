import { useEffect, useState, useMemo } from "react";
import { Row, Col, Card, Table, Segmented, Badge, Tooltip } from "antd";
import { PhoneOutlined, CheckCircleOutlined, ClockCircleOutlined, RiseOutlined, InfoCircleOutlined } from "@ant-design/icons";
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
  return { text: `${sign}${delta.toFixed(1)}%`, absDelta: delta, type: delta >= 0 ? "up" : "down" };
}

// 计算数组的中位数/Q1(25th)/Q3(75th)
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

export default function ChannelPage() {
  const [years, setYears] = useState([]);
  const [channels, setChannels] = useState([]);

  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState("full-year");
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [availableMonths, setAvailableMonths] = useState([]);
  const [customStart, setCustomStart] = useState(null);
  const [customEnd, setCustomEnd] = useState(null);

  const [rankingMetric, setRankingMetric] = useState("call_minutes");
  const [selectedChannelInTable, setSelectedChannelInTable] = useState(null);
  const [customerRanking, setCustomerRanking] = useState([]);

  const [channelOverview, setChannelOverview] = useState(null);
  const [channelTrend, setChannelTrend] = useState([]);
  const [channelRanking, setChannelRanking] = useState([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!selectedYear) return;
    const abortCtrl = new AbortController();

    setLoading(true);
    let quarter = null, month = null;
    if (selectedPeriod === "full-year") {}
    else if (["Q1", "Q2", "Q3", "Q4"].includes(selectedPeriod)) quarter = selectedPeriod;
    else if (selectedPeriod === "first-half") { quarter = "H1"; }
    else if (selectedPeriod === "second-half") { quarter = "H2"; }
    else if (selectedPeriod.startsWith("month-")) month = parseInt(selectedPeriod.replace("month-", ""));

    const params = { year: selectedYear };
    if (quarter) params.quarter = quarter;
    if (month) params.month = month;
    if (selectedPeriod === "custom" && customStart && customEnd) {
      params.start_date = `${selectedYear}-${String(customStart).padStart(2, "0")}-01`;
      params.end_date = `${selectedYear}-${String(customEnd).padStart(2, "0")}-01`;
    }
    if (selectedChannel) params.channel_name = selectedChannel;

    const isDailyMode = month !== null;

    // 月度趋势带上同比年份（去年）
    const trendParams = isDailyMode
      ? { year: selectedYear, start_date: dayjs(`${selectedYear}-${String(month).padStart(2, "0")}-01`).startOf("month").format("YYYY-MM-DD"), end_date: dayjs(`${selectedYear}-${String(month).padStart(2, "0")}-01`).endOf("month").format("YYYY-MM-DD"), channel_name: selectedChannel }
      : selectedPeriod === "custom" && customStart && customEnd
        ? { year: selectedYear, start_date: `${selectedYear}-${String(customStart).padStart(2, "0")}-01`, end_date: `${selectedYear}-${String(customEnd).padStart(2, "0")}-01`, channel_name: selectedChannel, compare_year: selectedYear - 1 }
        : { year: selectedYear, quarter, month, channel_name: selectedChannel, compare_year: selectedYear - 1 };

    const rankingParams = { year: selectedYear, quarter, month, metric: rankingMetric, start_date: params.start_date, end_date: params.end_date };

    Promise.all([
      api.getChannelOverview(params),
      isDailyMode ? api.getDailyTrend(trendParams) : api.getMonthlyTrend(trendParams),
      api.getChannelRanking(rankingParams),
    ]).then(([ov, trend, ranking]) => {
      if (abortCtrl.signal.aborted) return;
      setChannelOverview(ov);
      setChannelTrend(trend);
      setChannelRanking(ranking);
      setLoading(false);
    });

    return () => abortCtrl.abort();
  }, [selectedYear, selectedPeriod, selectedChannel, rankingMetric, customStart, customEnd]);

  useEffect(() => {
    let quarter = null, month = null;
    if (selectedPeriod === "full-year") {}
    else if (["Q1", "Q2", "Q3", "Q4"].includes(selectedPeriod)) quarter = selectedPeriod;
    else if (selectedPeriod === "first-half") { quarter = "H1"; }
    else if (selectedPeriod === "second-half") { quarter = "H2"; }
    else if (selectedPeriod.startsWith("month-")) month = parseInt(selectedPeriod.replace("month-", ""));

    const effectiveChannel = selectedChannelInTable || selectedChannel;
    if (!effectiveChannel) {
      setCustomerRanking([]);
      return;
    }

    api.getCompanyRanking({
      year: selectedYear, quarter, month,
      channel_name: effectiveChannel,
      metric: rankingMetric,
      limit: 20,
      start_date: selectedPeriod === "custom" && customStart ? `${selectedYear}-${String(customStart).padStart(2, "0")}-01` : undefined,
      end_date: selectedPeriod === "custom" && customEnd ? `${selectedYear}-${String(customEnd).padStart(2, "0")}-01` : undefined,
    }).then(r => setCustomerRanking(Array.isArray(r) ? r : []));
  }, [selectedYear, selectedPeriod, selectedChannel, selectedChannelInTable, rankingMetric, customStart, customEnd]);

  const avgConnectRate = channelOverview?.avg_connect_rate ? pctFmt(channelOverview.avg_connect_rate) : "-";
  const intentRate = channelOverview?.ab_intent && channelOverview?.connected_calls
    ? pctFmt(channelOverview.ab_intent / channelOverview.connected_calls)
    : "-";

  // 环比 + 同比计算
  const trendWithDelta = useMemo(() => channelTrend.map((row, i) => {
    const prev = i > 0 ? channelTrend[i - 1] : null;
    // 环比（当月 vs 上月）
    const qoq = {
      calls_delta: deltaFmt(row.total_calls, prev?.total_calls),
      minutes_delta: deltaFmt(row.call_minutes, prev?.call_minutes),
      connect_rate_delta: deltaFmt(row.avg_connect_rate, prev?.avg_connect_rate),
      intent_rate_delta: deltaFmt(row.intent_rate, prev?.intent_rate),
    };
    // 同比（当年 vs 上年同月）
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
        title={delta.absDelta != null ? `绝对值：${delta.absDelta >= 0 ? "+" : ""}${numFmt(Math.abs(delta.absDelta))}` : undefined}
      >
        {delta.text}
      </span>
    );
  };

  // 月度列：含环比+同比
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

  const dailyColumns = [
    { title: "日期", dataIndex: "date", key: "date", render: d => d.slice(5), width: 80 },
    { title: "外呼量", dataIndex: "total_calls", key: "total_calls", render: v => numFmt(v), align: "right" },
    { title: "环比", dataIndex: "calls_delta", key: "calls_delta", render: deltaTag, align: "right" },
    { title: "通话分钟数", dataIndex: "call_minutes", key: "call_minutes", render: v => numFmt(v), align: "right" },
    { title: "环比", dataIndex: "minutes_delta", key: "minutes_delta", render: deltaTag, align: "right" },
    { title: "接通率", dataIndex: "avg_connect_rate", key: "avg_connect_rate", render: v => pctFmt(v), align: "right" },
    { title: "环比", dataIndex: "connect_rate_delta", key: "connect_rate_delta", render: deltaTag, align: "right" },
    { title: "意向率", dataIndex: "intent_rate", key: "intent_rate", render: v => pctFmt(v), align: "right" },
    { title: "环比", dataIndex: "intent_rate_delta", key: "intent_rate_delta", render: deltaTag, align: "right" },
  ];

  const deltaColumns = isDaily ? dailyColumns : monthlyColumns;

  // 排行榜颜色提示：计算中位数/平均数/Q1/Q3
  const rankingStats = useMemo(() => {
    return statsFromArr(channelRanking, rankingMetric);
  }, [channelRanking, rankingMetric]);

  // 颜色标注说明
  const RANK_COLORS = {
    top: "#52c41a",    // 高于Q3（优秀）
    mid: "#888",       // Q1~Q3之间（正常）
    low: "#ff4d4f",    // 低于Q1（需关注）
  };

  const getRankColor = (val) => {
    if (val == null || !rankingStats.q3) return undefined;
    if (val >= rankingStats.q3) return RANK_COLORS.top;
    if (val <= rankingStats.q1) return RANK_COLORS.low;
    return RANK_COLORS.mid;
  };

  const metricLabelMap = { call_minutes: "通话分钟数", total_calls: "外呼量", connected_calls: "接通量" };

  const baseRankingCols = [
    { title: "排名", key: "rank", width: 50, render: (_, __, i) => i + 1 },
    {
      title: "渠道商",
      dataIndex: "channel_name",
      key: "channel_name",
      ellipsis: true,
      render: (v, row) => {
        const color = getRankColor(row[rankingMetric]);
        const tag = color ? <span style={{ color, fontWeight: 600 }}>●</span> : null;
        return (
          <span
            style={{ color: selectedChannelInTable === v ? "#1677ff" : undefined, cursor: "pointer", fontWeight: selectedChannelInTable === v ? 600 : 400 }}
            onClick={() => setSelectedChannelInTable(selectedChannelInTable === v ? null : v)}
          >
            {selectedChannelInTable === v ? <Badge color="blue" text={v} /> : tag}{" "}{v}
          </span>
        );
      },
    },
  ];

  const normalRankingCols = [
    {
      title: metricLabelMap[rankingMetric],
      dataIndex: rankingMetric,
      key: rankingMetric,
      render: (v, row) => {
        const color = getRankColor(v);
        return <span style={{ color: color || undefined, fontWeight: color ? 600 : 400 }}>{numFmt(v)}</span>;
      },
      align: "right",
    },
    { title: "外呼量", dataIndex: "total_calls", key: "total_calls", render: v => numFmt(v), align: "right" },
    { title: "接通量", dataIndex: "connected_calls", key: "connected_calls", render: v => numFmt(v), align: "right" },
    { title: "平均接通率", dataIndex: "avg_connect_rate", key: "avg_connect_rate", render: v => pctFmt(v), align: "right" },
    { title: "AB意向率", dataIndex: "intent_rate", key: "intent_rate", render: v => pctFmt(v), align: "right" },
  ];

  const rankingColumns = baseRankingCols.concat(normalRankingCols);

  // 客户排行榜颜色
  const custRankingStats = useMemo(() => statsFromArr(customerRanking, rankingMetric), [customerRanking, rankingMetric]);
  const getCustRankColor = (val) => {
    if (val == null || !custRankingStats.q3) return "#5470c6";
    if (val >= custRankingStats.q3) return "#52c41a";
    if (val <= custRankingStats.q1) return "#ff4d4f";
    return "#5470c6";
  };

  const customerBarOption = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 160, right: 60, bottom: 20, top: 20 },
    xAxis: { type: "value", axisLabel: { formatter: v => numFmt(v) } },
    yAxis: {
      type: "category",
      data: [...customerRanking].reverse().map(d => d.company_name),
      axisLabel: { width: 150, overflow: "truncate" },
    },
    series: [{
      type: "bar",
      data: [...customerRanking].reverse().map(d => ({
        value: d[rankingMetric],
        itemStyle: { color: getCustRankColor(d[rankingMetric]) },
      })),
      label: { show: true, position: "right", formatter: p => numFmt(p.value) },
    }],
  };

  const legendEl = (
    <span style={{ fontSize: 11, color: "#888" }}>
      <Tooltip title="高于Q3（优秀）"><span style={{ color: RANK_COLORS.top }}>●</span> 优秀&nbsp;</Tooltip>
      <Tooltip title="Q1~Q3（正常）"><span style={{ color: RANK_COLORS.mid }}>●</span> 正常&nbsp;</Tooltip>
      <Tooltip title="低于Q1（需关注）"><span style={{ color: RANK_COLORS.low }}>●</span> 需关注&nbsp;</Tooltip>
      <span style={{ marginLeft: 6, color: "#aaa" }}>
        [{metricLabelMap[rankingMetric]} 中位数 {numFmt(rankingStats.median)} / 平均 {numFmt(rankingStats.avg)}]
      </span>
    </span>
  );

  return (
    <div style={{ padding: "20px 24px" }}>
      <Card bordered={false} style={{ marginBottom: 16, position: "sticky", top: 64, zIndex: 100 }}>
        <FilterBar
          years={years} selectedYear={selectedYear} onYearChange={y => { setSelectedYear(y); setSelectedChannelInTable(null); }}
          selectedPeriod={selectedPeriod} onPeriodChange={p => { setSelectedPeriod(p); setSelectedChannelInTable(null); }}
          channels={channels} selectedChannel={selectedChannel} onChannelChange={v => { setSelectedChannel(v); setSelectedChannelInTable(null); }}
          availableMonths={availableMonths}
          customStart={customStart} customEnd={customEnd}
          onCustomRangeChange={(s, e) => { setCustomStart(s); setCustomEnd(e); }}
        />
      </Card>

      <Row gutter={[16, 16]}>
        {[
          { title: "总外呼量", value: numFmt(channelOverview?.total_calls), icon: <PhoneOutlined />, color: "#5470c6" },
          { title: "总通话分钟数", value: numFmt(channelOverview?.call_minutes), icon: <ClockCircleOutlined />, color: "#fac858" },
          { title: "平均接通率", value: avgConnectRate, icon: <CheckCircleOutlined />, color: "#91cc75" },
          { title: "AB意向率", value: intentRate, icon: <RiseOutlined />, color: "#ee6666" },
        ].map(item => (
          <Col xs={12} sm={8} xl={6} key={item.title}>
            <Card bordered={false} style={{ borderTop: `3px solid ${item.color}` }}>
              <Statistic title={<span style={{ fontSize: 13 }}>{item.title}</span>} value={item.value}
                prefix={<span style={{ color: item.color }}>{item.icon}</span>} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <TrendChart title={chartTitle} data={channelTrend} isDaily={isDaily} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card title={isDaily ? "日环比" : "月度环比（环比：与上月比；同比：与去年同月比）"} bordered={false}>
            <Table columns={deltaColumns} dataSource={trendWithDelta} rowKey={isDaily ? "date" : "month"}
              pagination={false} size="small" scroll={{ x: isDaily ? 800 : 1100 }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }} align="stretch">
        <Col span={selectedChannelInTable ? 10 : 24} style={{ display: "flex", flexDirection: "column" }}>
          <Card
            title={
              <span>
                渠道商排行榜
                <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>
                  <Segmented
                    size="small"
                    value={rankingMetric}
                    onChange={v => setRankingMetric(v)}
                    options={[
                      { label: "通话分钟数", value: "call_minutes" },
                      { label: "外呼量", value: "total_calls" },
                      { label: "接通量", value: "connected_calls" },
                    ]}
                  />
                  <span style={{ marginLeft: 8 }}>
                    {legendEl}
                  </span>
                </span>
              </span>
            }
            bordered={false}
            extra={selectedChannelInTable && (
              <span style={{ fontSize: 12, color: "#1677ff", cursor: "pointer" }} onClick={() => setSelectedChannelInTable(null)}>
                清除选择
              </span>
            )}
            style={{ flex: 1, display: "flex", flexDirection: "column" }}
            bodyStyle={{ flex: 1, overflow: "auto" }}
          >
            <Table
              columns={rankingColumns}
              dataSource={channelRanking}
              rowKey="channel_name"
              pagination={false}
              size="small"
              rowClassName={row => selectedChannelInTable === row.channel_name ? "ant-table-row-selected" : ""}
              onRow={row => ({
                onClick: () => setSelectedChannelInTable(selectedChannelInTable === row.channel_name ? null : row.channel_name),
                style: { cursor: "pointer" },
              })}
            />
          </Card>
        </Col>

        {selectedChannelInTable && (
          <Col span={14} style={{ position: "relative" }}>
            <div style={{ position: "sticky", top: 80, zIndex: 200 }}>
              <Card
                title={
                  <span>
                    客户排行榜
                    <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>— {selectedChannelInTable}</span>
                    <span style={{ fontSize: 11, color: "#aaa", marginLeft: 8 }}>
                      [
                      <span style={{ color: "#52c41a" }}>●</span> 优秀&nbsp;
                      <span style={{ color: "#5470c6" }}>●</span> 正常&nbsp;
                      <span style={{ color: "#ff4d4f" }}>●</span> 需关注&nbsp;
                      中位数 {numFmt(custRankingStats.median)} / 平均 {numFmt(custRankingStats.avg)}
                      ]
                    </span>
                  </span>
                }
                bordered={false}
              >
                <EChart option={customerBarOption} style={{ height: Math.max(300, customerRanking.length * 28) }} />
              </Card>
            </div>
          </Col>
        )}
      </Row>
    </div>
  );
}
