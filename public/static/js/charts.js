// ECharts wrappers. Each chart resizes with its container and is disposed
// with the panel, so opening county after county does not leak canvases.
/* global echarts */

const ECHARTS_URL = "/static/vendor/echarts-5.6.0/echarts.min.js";
let echartsLoading = null;

/** ECharts is a megabyte of script used only by the panel's chart, so it loads on first need. */
export function loadECharts() {
  if (window.echarts) return Promise.resolve();
  echartsLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ECHARTS_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      echartsLoading = null; // let a later panel try again
      script.remove();
      reject(new Error("圖表程式庫載入失敗"));
    };
    document.head.append(script);
  });
  return echartsLoading;
}

const TEXT = "rgba(226, 232, 240, 0.75)";
const GRID_LINE = "rgba(255, 255, 255, 0.08)";

export class ChartSet {
  constructor() {
    this.charts = [];
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) echarts.getInstanceByDom(entry.target)?.resize();
    });
  }

  make(element, option) {
    if (!element) return null;
    const existing = echarts.getInstanceByDom(element);
    if (existing) {
      existing.setOption(option, true);
      return existing;
    }
    // Sections re-render their HTML; drop charts whose element is gone.
    this.charts = this.charts.filter((chart) => {
      if (chart.getDom().isConnected) return true;
      this.observer.unobserve(chart.getDom());
      chart.dispose();
      return false;
    });
    const chart = echarts.init(element, null, { renderer: "canvas" });
    chart.setOption(option);
    this.charts.push(chart);
    this.observer.observe(element);
    return chart;
  }

  dispose() {
    this.observer.disconnect();
    for (const chart of this.charts) chart.dispose();
    this.charts = [];
  }
}

const pair = (rows, x, y) => rows.filter((r) => r[y] !== null && r[y] !== undefined).map((r) => [r[x], r[y]]);
const fade = (color, top, bottom) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [
  { offset: 0, color: color.replace("ALPHA", top) },
  { offset: 1, color: color.replace("ALPHA", bottom) },
]);

/** Temperature, feels-like and rain chance over the coming days, on glass. */
export function hourlyOption(hourly) {
  return {
    backgroundColor: "transparent",
    textStyle: { color: TEXT, fontFamily: "inherit" },
    grid: { left: 34, right: 34, top: 14, bottom: 24 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "rgba(255,255,255,0.35)" } },
      backgroundColor: "rgba(12, 18, 36, 0.55)",
      borderColor: "rgba(255, 255, 255, 0.25)",
      borderRadius: 14,
      padding: [8, 12],
      textStyle: { color: "#f1f5fb", fontSize: 12 },
      extraCssText: "backdrop-filter: blur(14px) saturate(160%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.35);",
      valueFormatter: (value) => (value === null || value === undefined ? "—" : `${value}`),
    },
    xAxis: {
      type: "time",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: TEXT, fontSize: 11, hideOverlap: true, formatter: { day: "{M}/{d}", hour: "{HH}時" } },
      splitLine: { show: true, lineStyle: { color: GRID_LINE } },
    },
    yAxis: [
      { type: "value", scale: true, axisLabel: { color: TEXT, fontSize: 11, formatter: "{value}°" }, splitLine: { lineStyle: { color: GRID_LINE } } },
      { type: "value", min: 0, max: 100, axisLabel: { color: TEXT, fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } },
    ],
    series: [
      {
        name: "降雨機率",
        type: "bar",
        yAxisIndex: 1,
        barMaxWidth: 7,
        data: pair(hourly, "time", "pop"),
        itemStyle: { borderRadius: [4, 4, 0, 0], color: fade("rgba(125, 211, 252, ALPHA)", 0.75, 0.15) },
        tooltip: { valueFormatter: (v) => `${v}%` },
      },
      {
        name: "溫度",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: pair(hourly, "time", "temperature"),
        lineStyle: { width: 2.6, color: "#fdba74", shadowColor: "rgba(253, 186, 116, 0.6)", shadowBlur: 10 },
        itemStyle: { color: "#fdba74" },
        areaStyle: { color: fade("rgba(251, 146, 60, ALPHA)", 0.35, 0) },
        tooltip: { valueFormatter: (v) => `${v}°C` },
      },
      {
        name: "體感溫度",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: pair(hourly, "time", "apparentTemperature"),
        lineStyle: { width: 1.6, type: [4, 4], color: "rgba(254, 240, 138, 0.9)" },
        itemStyle: { color: "#fef08a" },
        tooltip: { valueFormatter: (v) => `${v}°C` },
      },
    ],
  };
}
