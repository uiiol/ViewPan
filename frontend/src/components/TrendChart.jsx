import { useEffect, useRef, useState } from "react";
import { Card, Checkbox } from "antd";
import * as echarts from "echarts";

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

const ALL_SERIES = [
  { name: "外呼量", type: "bar", yAxisIndex: 0, dataKey: "total_calls", color: "#5470c6" },
  { name: "通话分钟数", type: "bar", yAxisIndex: 0, dataKey: "call_minutes", color: "#fac858" },
  { name: "接通率", type: "line", yAxisIndex: 1, dataKey: "avg_connect_rate", color: "#91cc75" },
  { name: "意向率", type: "line", yAxisIndex: 1, dataKey: "intent_rate", color: "#ee6666" },
];

export default function TrendChart({ title, data, isDaily }) {
  const [selectedMetrics, setSelectedMetrics] = useState(["外呼量", "通话分钟数", "接通率", "意向率"]);
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }

    const visibleSeries = ALL_SERIES.filter(s => selectedMetrics.includes(s.name));
    const hasRate = visibleSeries.some(s => s.yAxisIndex === 1);
    const hasCount = visibleSeries.some(s => s.yAxisIndex === 0);

    const xAxisData = isDaily
      ? data.map(d => (d.date || "").slice(5))
      : data.map(d => `${Math.round(d.month)}月`);

    const option = {
      tooltip: {
        trigger: "axis",
        formatter: params => params.map(p => {
          let val = p.value;
          if (p.seriesName === "接通率" || p.seriesName === "意向率") val = pctFmt(val);
          else val = numFmt(val);
          return `${p.marker} ${p.seriesName}: ${val}`;
        }).join("<br/>"),
      },
      legend: { data: visibleSeries.map(s => s.name) },
      grid: { left: 50, right: 20, bottom: 30, top: 40, containLabel: true },
      xAxis: { type: "category", data: xAxisData },
      yAxis: [
        { type: "value", name: hasCount ? "次数/分钟" : "", axisLabel: { formatter: v => numFmt(v) } },
        { type: "value", name: hasRate ? "比率" : "", axisLabel: { formatter: v => (v * 100).toFixed(0) + "%" } },
      ],
      series: visibleSeries.map(s => ({
        name: s.name,
        type: s.type,
        yAxisIndex: s.yAxisIndex,
        data: data.map(d => s.name === "意向率" ? (d.intent_rate || 0) : d[s.dataKey]),
        itemStyle: { color: s.color },
        smooth: true,
      })),
    };

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
  }, [data, isDaily, selectedMetrics]);

  return (
    <Card
      title={title}
      bordered={false}
      extra={
        <Checkbox.Group
          value={selectedMetrics}
          onChange={vals => setSelectedMetrics(vals)}
          options={[
            { label: "外呼量", value: "外呼量" },
            { label: "通话分钟数", value: "通话分钟数" },
            { label: "接通率", value: "接通率" },
            { label: "意向率", value: "意向率" },
          ]}
        />
      }
    >
      <div ref={containerRef} style={{ height: 300 }} />
    </Card>
  );
}
