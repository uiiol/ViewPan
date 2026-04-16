import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export default function EChart({ option, style, onChartClick }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }

    // 排行榜图表：保留实例 + 动画；其他图表：notMerge:true 快速重建
    const isRankingChart = option && option.series && option.series[0] && option.series[0].type === "bar" && option.animation !== false;
    chartRef.current.setOption(option, {
      notMerge: isRankingChart ? false : true,
      lazyUpdate: true,
      animation: isRankingChart,
      animationDuration: isRankingChart ? 500 : 0,
      animationEasing: "cubicOut",
    });

    if (onChartClick) {
      chartRef.current.off("click");
      chartRef.current.on("click", onChartClick);
    }
  }, [option, onChartClick]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} style={style} />;
}
