// ECharts wrappers. Each chart resizes with its container and is disposed
// with the panel, so opening county after county does not leak canvases.
/* global echarts */

const TEXT = "#cbd5e1";
const GRID_LINE = "rgba(148, 163, 184, 0.15)";
const COLORS = { temp: "#f97316", feels: "#fbbf24", low: "#38bdf8", high: "#f87171", pop: "rgba(56, 189, 248, 0.45)", humidity: "#34d399", pressure: "#a78bfa", forecast: "#e2e8f0" };

const timeLabel = (value) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", hourCycle: "h23" }).format(new Date(value));

function base(extra = {}) {
  return {
    backgroundColor: "transparent",
    textStyle: { color: TEXT, fontFamily: "inherit" },
    grid: { left: 44, right: 44, top: 36, bottom: 28 },
    tooltip: { trigger: "axis", backgroundColor: "rgba(15, 23, 42, 0.95)", borderColor: "rgba(148, 163, 184, 0.3)", textStyle: { color: "#e2e8f0" } },
    legend: { top: 0, textStyle: { color: TEXT }, itemWidth: 14, itemHeight: 8 },
    ...extra,
  };
}

const timeAxis = () => ({
  type: "time",
  axisLine: { lineStyle: { color: GRID_LINE } },
  axisLabel: { color: TEXT, hideOverlap: true, formatter: { day: "{M}/{d}", hour: "{HH}:{mm}" } },
  splitLine: { show: false },
});

const valueAxis = (name, extra = {}) => ({
  type: "value",
  name,
  nameTextStyle: { color: TEXT, fontSize: 11 },
  axisLabel: { color: TEXT },
  splitLine: { lineStyle: { color: GRID_LINE } },
  scale: true,
  ...extra,
});

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

export function hourlyOption(hourly) {
  return base({
    tooltip: { ...base().tooltip, axisPointer: { type: "line" } },
    xAxis: timeAxis(),
    yAxis: [valueAxis("°C"), valueAxis("降雨 %", { min: 0, max: 100, scale: false, splitLine: { show: false } })],
    series: [
      { name: "溫度", type: "line", smooth: true, showSymbol: false, data: pair(hourly, "time", "temperature"), itemStyle: { color: COLORS.temp }, lineStyle: { width: 2.5 } },
      { name: "體感", type: "line", smooth: true, showSymbol: false, data: pair(hourly, "time", "apparentTemperature"), itemStyle: { color: COLORS.feels }, lineStyle: { type: "dashed", width: 1.5 } },
      { name: "降雨機率", type: "bar", yAxisIndex: 1, data: pair(hourly, "time", "pop"), itemStyle: { color: COLORS.pop }, barMaxWidth: 8 },
    ],
  });
}

// Observed hourly temperature with each day's forecast low/high as markers.
export function trendOption(trend) {
  const noon = (d) => `${d}T12:00:00+08:00`;
  return base({
    xAxis: timeAxis(),
    yAxis: valueAxis("°C"),
    series: [
      { name: "實測", type: "line", smooth: true, showSymbol: false, data: pair(trend.observed, "observedAt", "temperature"), itemStyle: { color: COLORS.temp } },
      { name: "預報最高", type: "scatter", symbol: "triangle", symbolSize: 9, data: trend.forecasts.filter((f) => f.maxt !== null).map((f) => [noon(f.dataDate), f.maxt]), itemStyle: { color: COLORS.high } },
      { name: "預報最低", type: "scatter", symbol: "triangle", symbolRotate: 180, symbolSize: 9, data: trend.forecasts.filter((f) => f.mint !== null).map((f) => [noon(f.dataDate), f.mint]), itemStyle: { color: COLORS.low } },
    ],
  });
}

export function humidityPressureOption(trend) {
  return base({
    xAxis: timeAxis(),
    yAxis: [valueAxis("濕度 %", { min: 0, max: 100, scale: false }), valueAxis("hPa", { splitLine: { show: false } })],
    series: [
      { name: "相對濕度", type: "line", smooth: true, showSymbol: false, data: pair(trend.observed, "observedAt", "humidity"), itemStyle: { color: COLORS.humidity } },
      { name: "氣壓", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false, data: pair(trend.observed, "observedAt", "pressure"), itemStyle: { color: COLORS.pressure } },
    ],
  });
}

// One day: the observed curve, and the latest forecast low/high as guides.
export function historyDayOption(history) {
  const last = history.revisions[history.revisions.length - 1];
  const guides = last
    ? [
      { yAxis: last.maxt, name: "預報最高", lineStyle: { color: COLORS.high, type: "dashed" }, label: { formatter: `預報最高 ${last.maxt}°`, color: COLORS.high } },
      { yAxis: last.mint, name: "預報最低", lineStyle: { color: COLORS.low, type: "dashed" }, label: { formatter: `預報最低 ${last.mint}°`, color: COLORS.low } },
    ].filter((g) => g.yAxis !== null)
    : [];
  return base({
    xAxis: timeAxis(),
    yAxis: valueAxis("°C"),
    series: [{
      name: "實測溫度", type: "line", smooth: true, showSymbol: false,
      data: pair(history.observed, "observedAt", "temperature"), itemStyle: { color: COLORS.temp },
      markLine: { symbol: "none", silent: true, data: guides },
    }],
  });
}

// How the forecast for one date changed as it drew closer.
export function revisionsOption(history) {
  const rows = history.revisions;
  return base({
    tooltip: { ...base().tooltip, formatter: (items) => `${timeLabel(items[0].value[0])} 發布<br>${items.map((i) => `${i.marker}${i.seriesName} ${i.value[1]}°`).join("<br>")}` },
    xAxis: timeAxis(),
    yAxis: valueAxis("°C"),
    series: [
      { name: "預報最高", type: "line", step: "end", data: pair(rows, "fetchedAt", "maxt"), itemStyle: { color: COLORS.high } },
      { name: "預報最低", type: "line", step: "end", data: pair(rows, "fetchedAt", "mint"), itemStyle: { color: COLORS.low } },
    ],
  });
}
