import { useEffect, useState, useMemo, useRef } from "react";
import { Row, Col, Card, Select, Switch } from "antd";
import { RiseOutlined, FallOutlined, WarningOutlined } from "@ant-design/icons";
import * as echarts from "echarts";
import * as api from "../api";

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

const ROW_H = 300;

function EChart({ option, style }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }
    chartRef.current.setOption(option, { notMerge: true });
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, [option]);

  return <div ref={containerRef} style={style} />;
}

export default function DashboardPage() {
  const [years, setYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cumulativeView, setCumulativeView] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.getYears().then(y => {
      if (cancelled) return;
      const latest = y.length ? y[y.length - 1] : 2026;
      setYears(y);
      setSelectedYear(latest);
      api.getDashboardSummary({ year: latest }).then(d => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedYear) return;
    let cancelled = false;
    setLoading(true);
    api.getDashboardSummary({ year: selectedYear }).then(d => {
      if (cancelled) return;
      setData(d);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedYear]);

  if (!selectedYear || !data) {
    return (
      <div style={{ padding: "20px 24px" }}>
        <Card bordered={false} style={{ marginBottom: 16, position: "sticky", top: 64, zIndex: 100 }}>
          <Select style={{ width: 100 }} loading />
        </Card>
      </div>
    );
  }

  // ---- Derived data ----
  const completionRate = data.target > 0 ? (data.ytd_call_minutes / data.target) * 100 : 0;
  const lastYearProgressRate = data.last_ytd_pace > 0
    ? (data.ytd_call_minutes / data.last_ytd_pace) * 100
    : null;
  const paceDiff = lastYearProgressRate != null
    ? (data.ytd_call_minutes / data.last_ytd_pace) - (data.target / data.last_ytd_pace)
    : null;
  const paceStatus = paceDiff == null ? "normal"
    : paceDiff > 0 ? "healthy"
    : paceDiff < -0.1 ? "danger"
    : "warning";
  const paceColor = paceStatus === "healthy" ? "#52c41a" : paceStatus === "danger" ? "#ff4d4f" : "#fa8c16";

  const monthsWithData = data.monthly_data?.length || 0;
  const avgMonthly = monthsWithData > 0 ? data.ytd_call_minutes / monthsWithData : 0;
  const linearForecast = avgMonthly * 12;
  const gapToTarget = data.target - linearForecast;
  const conservativeForecast = avgMonthly * (monthsWithData + (12 - monthsWithData) * 0.8);
  const optimisticForecast = avgMonthly * 12 * 1.1;

  // ---- Chart options ----
  const targetMonthly = data.target / 12;
  const months = data.monthly_data.map(d => `${Math.round(d.month)}月`);
  // 累加值
  let currCum = 0, prevCum = 0;
  const currMins = data.monthly_data.map(d => { currCum += d.call_minutes; return currCum; });
  const prevMins = data.monthly_data.map(d => { prevCum += d.prev_call_minutes; return prevCum; });
  const targetLine = months.map((_, i) => targetMonthly * (i + 1));

  const currData = cumulativeView ? currMins : data.monthly_data.map(d => d.call_minutes);
  const prevData = cumulativeView ? prevMins : data.monthly_data.map(d => d.prev_call_minutes);

  // 差距：同比增长率百分比
  const gapPct = cumulativeView ? currMins.map((v, i) => {
    const m = data.monthly_data[i];
    if (!m || m.call_minutes <= 0 || !prevMins[i]) return null;
    return ((v - prevMins[i]) / prevMins[i]) * 100;
  }) : data.monthly_data.map((m, i) => {
    if (!m || m.call_minutes <= 0 || !m.prev_call_minutes) return null;
    return ((m.call_minutes - m.prev_call_minutes) / m.prev_call_minutes) * 100;
  });

  // 累计同比涨幅/跌幅用于图例
  const totalCurr = currMins[currMins.length - 1] || 0;
  const totalPrev = prevMins[prevMins.length - 1] || 0;
  const overallGapPct = totalCurr > 0 && totalPrev > 0 ? ((totalCurr - totalPrev) / totalPrev) * 100 : 0;

  const monthlyTrendOption = {
    tooltip: {
      trigger: "axis",
      formatter: params => {
        const month = params[0].axisValue;
        const rows = [];
        const gapParam = params.find(p => p.seriesName.includes("同比"));
        params.forEach(p => {
          if (p.value == null) return;
          if (p.seriesName.includes("同比")) return;
          rows.push(`${p.marker} ${p.seriesName}：${numFmt(p.value)}`);
        });
        if (gapParam) {
          const v = gapParam.value;
          const num = typeof v === "object" ? v?.value : v;
          if (num != null) {
            const color = num >= 0 ? "#52c41a" : "#ff4d4f";
            const sign = num >= 0 ? "+" : "";
            rows.push(`<span style="color:${color}">●</span> ${selectedYear}年与${selectedYear-1}年同期差距：${sign}${num.toFixed(2)}%`);
          }
        }
        return `<div style="font-size:11"><strong>${month}</strong><br/>${rows.join("<br/>")}</div>`;
      },
    },
    legend: {
      data: cumulativeView
        ? [
            `${selectedYear}年累计`,
            `${selectedYear - 1}年同期累计`,
            "目标累计线",
            overallGapPct >= 0 ? `同比涨幅  +${overallGapPct.toFixed(2)}%` : `同比跌幅  ${overallGapPct.toFixed(2)}%`,
          ]
        : [`${selectedYear}年`, `${selectedYear - 1}年同期`, "目标月均线"],
      top: 0,
    },
    grid: { left: 65, right: 30, bottom: 28, top: 38 },
    xAxis: { type: "category", data: months },
    yAxis: cumulativeView
      ? { type: "value", name: "通话分钟数", axisLabel: { formatter: v => numFmt(v) }, splitLine: { show: false } }
      : { type: "value", name: "通话分钟数", axisLabel: { formatter: v => numFmt(v) } },
    series: cumulativeView ? [
      { name: `${selectedYear - 1}年同期累计`, type: "line", data: prevMins, itemStyle: { color: "#bbb" }, smooth: true, lineStyle: { type: "dashed", width: 2 }, symbol: "none" },
      { name: `${selectedYear}年累计`, type: "line", data: currMins, itemStyle: { color: "#5470c6" }, smooth: true, symbol: "none", areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(84,112,198,0.4)" }, { offset: 1, color: "rgba(84,112,198,0.05)" }]) } },
      { name: "目标累计线", type: "line", data: targetLine, itemStyle: { color: "#ee6666" }, smooth: false, symbol: "none", lineStyle: { type: "dashed", width: 1 } },
      {
        name: overallGapPct >= 0 ? `同比涨幅  +${overallGapPct.toFixed(2)}%` : `同比跌幅  ${overallGapPct.toFixed(2)}%`,
        type: "bar",
        data: gapPct.map(v => v != null ? { value: v, itemStyle: { color: v >= 0 ? "#52c41a" : "#ff4d4f" } } : { value: null }),
        barWidth: 18,
      },
    ] : [
      { name: `${selectedYear}年`, type: "bar", data: currData, itemStyle: { color: "#5470c6" } },
      { name: `${selectedYear - 1}年同期`, type: "bar", data: prevData, itemStyle: { color: "#ccc" } },
      { name: "目标月均线", type: "line", data: months.map(() => targetMonthly), itemStyle: { color: "#ee6666" }, smooth: false, symbol: "none", lineStyle: { type: "dashed", width: 1 } },
      {
        name: `同比涨幅`,
        type: "bar",
        data: gapPct.map(v => v != null ? { value: v, itemStyle: { color: v >= 0 ? "#52c41a" : "#ff4d4f" } } : { value: null }),
        barWidth: 18,
      },
    ],
  };

  const top10Option = (() => {
    const customers = [...(data.top_customers || [])].reverse();
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 160, right: 60, bottom: 20, top: 10 },
      xAxis: { type: "value", axisLabel: { formatter: v => numFmt(v) } },
      yAxis: { type: "category", data: customers.map(c => c.company_name), axisLabel: { width: 150, overflow: "truncate" } },
      series: [{
        type: "bar",
        data: customers.map(c => ({ value: c.call_minutes, itemStyle: { color: "#5470c6" } })),
        label: { show: true, position: "right", formatter: p => numFmt(p.value) },
      }],
    };
  })();

  const customerPieOption = (() => {
    const newCount = data.new_cust_count || 0;
    const returnCount = data.return_cust_count || 0;
    const lostSamePeriod = data.lost_same_period_count || 0;
    const lostNoPeriod = data.lost_no_period_count || 0;
    const newMins = data.new_cust_minutes || 0;
    const returnMins = data.return_minutes || 0;
    const totalMins = newMins + returnMins;
    // 外圈总数作为分母
    const outerTotal = newCount + returnCount + lostSamePeriod + lostNoPeriod || 1;

    return {
      tooltip: {
        trigger: "item",
        formatter: p => {
          if (p.seriesIndex === 0) return `${p.marker} ${p.name}<br/>通话分钟数：${numFmt(p.value)} 分钟`;
          return `${p.marker} ${p.name}<br/>客户数量：${p.value} 人（${((p.value / outerTotal) * 100).toFixed(1)}%）`;
        },
      },
      legend: {
        orient: "vertical", right: 5, top: "center",
        itemWidth: 10, itemHeight: 10,
        data: [
          { name: `● 新客户  ${newCount}人（${((newCount / outerTotal) * 100).toFixed(1)}%）`, icon: "circle" },
          { name: `● 老客户  ${returnCount}人（${((returnCount / outerTotal) * 100).toFixed(1)}%）`, icon: "circle" },
          { name: `● 同期有外呼  ${lostSamePeriod}人（${((lostSamePeriod / outerTotal) * 100).toFixed(1)}%）`, icon: "circle" },
          { name: `● 同期没外呼  ${lostNoPeriod}人（${((lostNoPeriod / outerTotal) * 100).toFixed(1)}%）`, icon: "circle" },
        ],
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["0%", "42%"],
          center: ["45%", "50%"],
          data: [
            { name: `新客户`, value: newMins, itemStyle: { color: "#5470c6" } },
            { name: `老客户`, value: returnMins, itemStyle: { color: "#91cc75" } },
          ],
          label: { show: false },
          emphasis: { scaleSize: 6 },
          animationDuration: 800,
        },
        {
          type: "pie",
          radius: ["46%", "85%"],
          center: ["45%", "50%"],
          data: [
            { name: `新客户`, value: newCount, itemStyle: { color: "#5470c6" } },
            { name: `老客户`, value: returnCount, itemStyle: { color: "#91cc75" } },
            { name: `同期有外呼`, value: lostSamePeriod, itemStyle: { color: "#ff7875" } },
            { name: `同期没外呼`, value: lostNoPeriod, itemStyle: { color: "#fa8c16" } },
          ],
          label: { show: false },
          emphasis: { scaleSize: 6 },
          animationDuration: 800,
        },
      ],
      graphic: { type: "group", children: [] },
    };
  })();

  const scatterOption = (() => {
    const scatter = data.scatter_data || [];
    const growth = [], shrink = [], newC = [];
    scatter.forEach(d => {
      if (d.prev_ytd_minutes === 0) {
        newC.push({ value: [d.prev_ytd_minutes, d.curr_ytd_minutes], name: d.company_name });
      } else if (d.curr_ytd_minutes >= d.prev_ytd_minutes) {
        growth.push({ value: [d.prev_ytd_minutes, d.curr_ytd_minutes], name: d.company_name });
      } else {
        shrink.push({ value: [d.prev_ytd_minutes, d.curr_ytd_minutes], name: d.company_name });
      }
    });
    // 取85分位数作为轴上限，让大部分点集中在中心区域
    const allVals = scatter.flatMap(d => [d.prev_ytd_minutes, d.curr_ytd_minutes]).filter(v => v > 0).sort((a, b) => a - b);
    const p85Idx = Math.floor(allVals.length * 0.85);
    const maxAxis = allVals[p85Idx] || 1;
    const axisMax = maxAxis * 1.2;
    return {
      tooltip: {
        trigger: "item",
        formatter: p => p.data.name
          ? `${p.data.name}<br/>去年同期: ${numFmt(p.data.value[0])}<br/>今年同期: ${numFmt(p.data.value[1])}`
          : "",
      },
      grid: { left: 65, right: 20, bottom: 35, top: 15 },
      xAxis: { type: "value", name: `${selectedYear - 1}年同期(分钟)`, axisLabel: { formatter: v => numFmt(v), fontSize: 10 }, max: axisMax },
      yAxis: { type: "value", name: `${selectedYear}年同期(分钟)`, axisLabel: { formatter: v => numFmt(v), fontSize: 10 }, max: axisMax },
      series: [
        { name: "增长", type: "scatter", data: growth, symbolSize: 9, itemStyle: { color: "#52c41a", opacity: 0.75 } },
        { name: "萎缩", type: "scatter", data: shrink, symbolSize: 9, itemStyle: { color: "#ff4d4f", opacity: 0.75 } },
        { name: "新客户", type: "scatter", data: newC, symbolSize: 11, itemStyle: { color: "#5470c6", opacity: 0.85 } },
        { name: "参考线", type: "line", data: [[0, 0], [axisMax, axisMax]], lineStyle: { color: "#ccc", type: "dashed", width: 1 }, symbol: "none", tooltip: { show: false } },
      ],
    };
  })();

  const gaugeOption = {
    series: [{
      type: "gauge",
      radius: "95%",
      center: ["50%", "55%"],
      startAngle: 200,
      endAngle: -20,
      min: 0,
      max: 100,
      splitNumber: 5,
      itemStyle: { color: paceColor },
      progress: { show: true, width: 16, itemStyle: { color: paceColor } },
      pointer: { show: false },
      axisLine: { lineStyle: { width: 16, color: [[1, "#f0f0f0"]] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      title: { show: false },
      detail: {
        valueAnimation: true,
        fontSize: 24,
        formatter: v => v.toFixed(1) + "%",
        color: "#333",
        offsetCenter: [0, "10%"],
      },
      data: [{ value: parseFloat(Math.min(completionRate, 100).toFixed(1)) }],
    }],
  };

  return (
    <div style={{ padding: "20px 24px" }}>
      <Card bordered={false} style={{ marginBottom: 16, position: "sticky", top: 64, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "#333", fontWeight: 500 }}>数据年份</span>
          <Select
            style={{ width: 100 }}
            value={selectedYear}
            onChange={y => setSelectedYear(y)}
            options={years.filter(y => y >= 2025).map(y => ({ label: `${y}年`, value: y }))}
          />
        </div>
      </Card>

      {/* Row 1 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card
            title={`${selectedYear}年目标完成进度（目标=${numFmt(data.target)}）`}
            bordered={false}
            extra={
              <span style={{ fontSize: 12, fontWeight: 600, color: paceColor }}>
                {paceStatus === "healthy" ? <RiseOutlined /> : paceStatus === "danger" ? <FallOutlined /> : <WarningOutlined />}
                {" "}{paceStatus === "healthy" ? "领先节奏" : paceStatus === "danger" ? "落后较多" : "略落后节奏"}
              </span>
            }
          >
            <Row gutter={16} align="middle">
              <Col span={11}>
                <EChart option={gaugeOption} style={{ height: 210 }} />
              </Col>
              <Col span={13}>
                <div style={{ lineHeight: 2.4, fontSize: 13 }}>
                  <div><span style={{ color: "#888" }}>目标值（去年×1.2）</span> <span style={{ fontWeight: 600 }}>{numFmt(data.target)}</span></div>
                  <div><span style={{ color: "#888" }}>当前完成</span> <span style={{ fontWeight: 600 }}>{numFmt(data.ytd_call_minutes)}</span></div>
                  <div><span style={{ color: "#888" }}>完成率</span> <span style={{ fontWeight: 600, color: paceColor }}>{pctFmt(completionRate / 100)}</span></div>
                  <div><span style={{ color: "#888" }}>去年同期</span> <span style={{ fontWeight: 600 }}>{numFmt(data.last_ytd_pace)}</span></div>
                  <div><span style={{ color: "#888" }}>去年全年</span> <span style={{ fontWeight: 600 }}>{numFmt(data.last_year_total)}</span></div>
                  {lastYearProgressRate != null && (
                    <div><span style={{ color: "#888" }}>同比进度</span> <span style={{ fontWeight: 600, color: lastYearProgressRate >= 100 ? "#52c41a" : "#ff4d4f" }}>{pctFmt(lastYearProgressRate / 100)}</span></div>
                  )}
                </div>
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title={`${selectedYear}年全年达标预测`} bordered={false}>
            <Row gutter={[12, 12]}>
              {[
                { label: "保守", value: conservativeForecast, color: "#ff4d4f", note: "剩余月份八折" },
                { label: "中性", value: linearForecast, color: "#fa8c16", note: "按当前月均" },
                { label: "乐观", value: optimisticForecast, color: "#52c41a", note: "月均×1.1" },
              ].map(s => {
                const rate = data.target > 0 ? (s.value / data.target) * 100 : 0;
                return (
                  <Col span={8} key={s.label}>
                    <div style={{ background: `${s.color}12`, border: `1px solid ${s.color}35`, borderRadius: 8, padding: "12px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: s.color, fontWeight: 600, marginBottom: 6 }}>{s.label}情景</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{numFmt(s.value)}</div>
                      <div style={{ fontSize: 11, marginTop: 4, color: rate >= 100 ? "#52c41a" : "#ff4d4f" }}>
                        {rate >= 100 ? "✓ 可达标" : "✗ 不达标"}
                      </div>
                      <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{s.note}</div>
                      <div style={{ marginTop: 8 }}>
                        <div style={{ height: 4, background: `${s.color}20`, borderRadius: 2 }}>
                          <div style={{ height: "100%", width: `${Math.min(rate, 100)}%`, background: s.color, borderRadius: 2 }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#aaa", marginTop: 3, textAlign: "right" }}>{pctFmt(rate / 100)}</div>
                      </div>
                    </div>
                  </Col>
                );
              })}
            </Row>
            <div style={{ marginTop: 14, display: "flex", gap: 16, fontSize: 13 }}>
              <div style={{ flex: 1, background: "#f5f5f5", borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ color: "#888", fontSize: 11 }}>当前月均</div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{numFmt(avgMonthly)} <span style={{ fontSize: 11, color: "#888", fontWeight: 400 }}>/月</span></div>
              </div>
              <div style={{ flex: 1, background: "#f5f5f5", borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ color: "#888", fontSize: 11 }}>距目标还差</div>
                <div style={{ fontWeight: 600, fontSize: 16, color: gapToTarget > 0 ? "#ff4d4f" : "#52c41a" }}>
                  {numFmt(Math.abs(gapToTarget))}
                </div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Row 2 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card
            title="月度趋势（通话分钟数）"
            bordered={false}
            bodyStyle={{ paddingBottom: 8 }}
            extra={
              <span style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                累计
                <Switch size="small" checked={cumulativeView} onChange={v => setCumulativeView(v)} />
              </span>
            }
          >
            <EChart option={monthlyTrendOption} style={{ height: ROW_H - 20 }} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Top 10 客户贡献（通话分钟数）" bordered={false} bodyStyle={{ paddingBottom: 8 }}>
            <EChart option={top10Option} style={{ height: ROW_H - 20 }} />
          </Card>
        </Col>
      </Row>

      {/* Row 3 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card
            title={
              <span>
                客户结构
                <span style={{ fontSize: 11, color: "#888", marginLeft: 12 }}>
                  内圈：通话分钟数构成 | 外圈：客户数量构成
                </span>
              </span>
            }
            bordered={false}
            bodyStyle={{ paddingBottom: 8 }}
            extra={
              <span style={{ fontSize: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span><span style={{ color: "#5470c6", fontWeight: 600 }}>●</span> 新客户 {data.new_cust_count}人</span>
                <span><span style={{ color: "#91cc75", fontWeight: 600 }}>●</span> 老客户 {data.return_cust_count}人</span>
                <span><span style={{ color: "#ff7875", fontWeight: 600 }}>●</span> 同期有外呼 {data.lost_same_period_count}人</span>
                <span><span style={{ color: "#fa8c16", fontWeight: 600 }}>●</span> 同期没外呼 {data.lost_no_period_count}人</span>
              </span>
            }
          >
            <EChart option={customerPieOption} style={{ height: ROW_H - 20 }} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            title="客户健康度（同期对比）"
            extra={<span style={{ fontSize: 10 }}><span style={{ color: "#52c41a" }}>●</span> 增长&nbsp;<span style={{ color: "#5470c6" }}>●</span> 新客户&nbsp;<span style={{ color: "#ff4d4f" }}>●</span> 萎缩</span>}
            bordered={false}
            bodyStyle={{ paddingBottom: 8 }}
          >
            <EChart option={scatterOption} style={{ height: ROW_H - 20 }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
