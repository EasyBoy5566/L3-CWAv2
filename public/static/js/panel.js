// One county's weather: now, hourly, week, trend, history, sun and moon.
// The globe's side panel and the standalone /region?name=<縣市> page both use it.
import { getJSON, regionUrl } from "./api.js";
import { ChartSet, historyDayOption, hourlyOption, humidityPressureOption, revisionsOption, trendOption } from "./charts.js";
import { dayLabel, escapeHtml, hhmm, moonPhase, moonSvg, num, todayInTaipei, windText, wxIcon } from "./format.js";
import { TEMPERATURE, colorAt } from "./scale.js";

const metric = (label, value) => `<div class="metric"><span>${label}</span><b>${value}</b></div>`;

export class RegionView {
  constructor(container, name, { mode = "drawer" } = {}) {
    this.container = container;
    this.name = name;
    this.mode = mode;
    this.charts = new ChartSet();
    this.trendDays = 7;
    this.historyDate = null;
    this.aborter = new AbortController();
  }

  async load() {
    const wide = this.mode === "page" ? "wide" : "";
    this.container.innerHTML = `
      <section class="rg-head ${wide}" data-part="head"></section>
      <section class="${wide}" data-part="now"><div class="skeleton"></div></section>
      <section class="${wide}" data-part="hourly"></section>
      <section data-part="week"></section>
      <section data-part="astro"></section>
      <section class="${wide}" data-part="trend"></section>
      <section class="${wide}" data-part="history"></section>`;
    await this.refresh();
    this.loadTrend();
    this.loadHistory();
  }

  part(name) {
    return this.container.querySelector(`[data-part="${name}"]`);
  }

  async refresh() {
    let data;
    try {
      data = await getJSON(regionUrl(this.name), { signal: this.aborter.signal });
    } catch (error) {
      if (error.name === "AbortError") return;
      this.part("now").innerHTML = `<div class="error-box">無法載入 ${escapeHtml(this.name)} 的資料：${escapeHtml(error.message)}</div>`;
      return;
    }
    this.data = data;
    this.renderHead(data);
    this.renderNow(data);
    this.renderHourly(data);
    this.renderWeek(data);
    this.renderAstro(data);
  }

  renderHead(data) {
    const link = this.mode === "drawer"
      ? `<a href="/region?${new URLSearchParams({ name: data.name })}" target="_blank" rel="noopener">開啟完整頁面 ↗</a>`
      : "";
    this.part("head").innerHTML = `
      <h2>${escapeHtml(data.name)}</h2>
      <div class="meta">預報發布 ${hhmm(data.forecastFetchedAt)} 取得 ${link ? "· " + link : ""}</div>`;
  }

  renderNow({ current, todayObserved }) {
    if (!current) {
      this.part("now").innerHTML = `<h3>現在</h3><div class="empty">目前沒有近 3 小時內的觀測資料。</div>`;
      return;
    }
    const today = todayObserved
      ? `今日實測 最高 ${num(todayObserved.tmax, 1, "°")} · 最低 ${num(todayObserved.tmin, 1, "°")}`
      : "";
    this.part("now").innerHTML = `
      <h3>現在 <small>${hhmm(current.observedAt)} 觀測 · ${current.stationCount} 站中位數</small></h3>
      <div class="now">
        <div class="temp">${num(current.temperature, 1)}<small>°C</small></div>
        <div>
          <div class="wx">${escapeHtml(current.weather ?? "")}</div>
          <div class="today">${today}</div>
        </div>
      </div>
      <div class="metrics">
        ${metric("相對濕度", num(current.humidity, 0, "%"))}
        ${metric("氣壓", num(current.pressure, 1, " hPa"))}
        ${metric("風", `${num(current.windSpeed, 1, " m/s")} ${windText(current.windDir)}`)}
        ${metric("今日累積雨量", num(current.rain, 1, " mm"))}
      </div>`;
  }

  renderHourly({ hourly }) {
    const element = this.part("hourly");
    if (!hourly.length) {
      element.innerHTML = `<h3>逐時預報</h3><div class="empty">暫無逐時預報。</div>`;
      return;
    }
    if (!element.querySelector(".chart")) {
      element.innerHTML = `<h3>逐時預報 <small>未來 ${Math.round((new Date(hourly.at(-1).time) - new Date(hourly[0].time)) / 3600000)} 小時</small></h3><div class="chart"></div>`;
    }
    this.charts.make(element.querySelector(".chart"), hourlyOption(hourly));
  }

  renderWeek({ week }) {
    const element = this.part("week");
    if (!week.length) {
      element.innerHTML = `<h3>一週預報</h3><div class="empty">暫無一週預報。</div>`;
      return;
    }
    const lows = week.map((d) => d.mint).filter((v) => v !== null);
    const highs = week.map((d) => d.maxt).filter((v) => v !== null);
    const lo = Math.min(...lows);
    const hi = Math.max(...highs);
    const span = Math.max(hi - lo, 1);
    const rows = week.map((d) => {
      const left = ((d.mint - lo) / span) * 100;
      const width = ((d.maxt - d.mint) / span) * 100;
      const approx = d.approx ? `<span class="approx" title="由 12 小時預報推估">約</span>` : "";
      return `<tr>
        <td>${dayLabel(d.dataDate)}</td>
        <td><span class="icon">${wxIcon(d.wxCode)}</span>${escapeHtml(d.wx ?? "")}</td>
        <td class="num">${approx}${num(d.mint)}°</td>
        <td><div class="temp-bar"><i style="left:${left}%;width:${Math.max(width, 2)}%;background:linear-gradient(90deg, ${colorAt(TEMPERATURE, d.mint)}, ${colorAt(TEMPERATURE, d.maxt)})"></i></div></td>
        <td class="num">${num(d.maxt)}°</td>
        <td class="num">${d.pop === null ? "—" : `${num(d.pop)}%`}</td>
      </tr>`;
    }).join("");
    element.innerHTML = `
      <h3>一週預報</h3>
      <table class="week">
        <thead><tr><th>日期</th><th>天氣</th><th class="num">最低</th><th></th><th class="num">最高</th><th class="num">降雨</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">一天為 00:00–24:00。標示「約」者由 12 小時預報推估；第 4 天之後氣象署未提供降雨機率。</p>`;
  }

  renderAstro({ astronomy }) {
    const today = astronomy.find((a) => a.date === todayInTaipei()) ?? astronomy[0];
    const phase = moonPhase();
    const element = this.part("astro");
    if (!today) {
      element.innerHTML = `<h3>日月</h3><div class="empty">暫無日出日落資料。</div>`;
      return;
    }
    element.innerHTML = `
      <h3>日月 <small>${dayLabel(today.date)}</small></h3>
      <div class="astro">
        ${metric("日出", escapeHtml(today.sunrise ?? "—"))}
        ${metric("日落", escapeHtml(today.sunset ?? "—"))}
        ${metric("月出", escapeHtml(today.moonrise ?? "—"))}
        ${metric("月落", escapeHtml(today.moonset ?? "—"))}
      </div>
      <div class="astro">
        <div class="metric" style="display:flex;gap:10px;align-items:center">${moonSvg(phase)}<div><span>月相</span><b>${phase.name}</b></div></div>
        ${metric("照亮比例", `${Math.round(phase.illumination * 100)}%`)}
      </div>`;
  }

  async loadTrend() {
    const element = this.part("trend");
    const tabs = [1, 7, 30].map((d) => `<button type="button" data-days="${d}" aria-pressed="${d === this.trendDays}">${d} 天</button>`).join("");
    element.innerHTML = `
      <h3>趨勢 <span class="tabs">${tabs}</span></h3>
      <div class="chart" data-chart="trend"></div>
      <div class="chart small" data-chart="hp"></div>
      <p class="note">實測為縣市內平地測站中位數（每小時一點）；三角形為當日最後一版預報的最高／最低。</p>`;
    element.querySelector(".tabs").addEventListener("click", (event) => {
      const days = Number(event.target.dataset.days);
      if (days && days !== this.trendDays) {
        this.trendDays = days;
        this.loadTrend();
      }
    });
    try {
      const trend = await getJSON(regionUrl(this.name, "/trend", { days: this.trendDays }), { signal: this.aborter.signal });
      if (!trend.observed.length) {
        element.querySelector('[data-chart="trend"]').outerHTML = `<div class="empty">觀測資料累積中，排程每 10 分鐘寫入一次。</div>`;
        element.querySelector('[data-chart="hp"]').remove();
        return;
      }
      this.charts.make(element.querySelector('[data-chart="trend"]'), trendOption(trend));
      this.charts.make(element.querySelector('[data-chart="hp"]'), humidityPressureOption(trend));
    } catch (error) {
      if (error.name !== "AbortError") element.insertAdjacentHTML("beforeend", `<div class="error-box">${escapeHtml(error.message)}</div>`);
    }
  }

  async loadHistory(day) {
    const element = this.part("history");
    let history;
    try {
      history = await getJSON(regionUrl(this.name, "/history", day ? { date: day } : {}), { signal: this.aborter.signal });
    } catch (error) {
      if (error.name !== "AbortError") element.innerHTML = `<h3>歷史</h3><div class="error-box">${escapeHtml(error.message)}</div>`;
      return;
    }
    this.historyDate = history.date;
    const last = history.revisions.at(-1);
    const summary = history.summary;
    const diff = (forecast, observed) => (forecast === null || forecast === undefined || observed === null || observed === undefined
      ? "—" : `${forecast - observed > 0 ? "+" : ""}${(forecast - observed).toFixed(1)}°`);
    element.innerHTML = `
      <h3>歷史 <small>預報與實測</small></h3>
      <div class="history-controls">
        <label class="field"><span>日期</span>
          <input type="date" value="${history.date}" min="${history.range.first ?? history.date}" max="${history.range.last}">
        </label>
        <span class="note">${history.range.first ? `可查詢 ${history.range.first} 起的資料` : "資料累積中"}</span>
      </div>
      <div class="history-summary">
        ${metric("實測最高／最低", summary ? `${num(summary.tmax, 1)}° / ${num(summary.tmin, 1)}°${summary.partial ? "（至目前）" : ""}` : "—")}
        ${metric("最後預報最高／最低", last ? `${num(last.maxt)}° / ${num(last.mint)}°` : "—")}
        ${metric("預報誤差 高／低", summary && last ? `${diff(last.maxt, summary.tmax)} / ${diff(last.mint, summary.tmin)}` : "—")}
        ${metric("預報版本數", `${history.revisions.length}`)}
      </div>
      ${history.observed.length ? `<div class="chart" data-chart="day"></div>` : `<div class="empty">這一天沒有實測資料。</div>`}
      ${history.revisions.length > 1 ? `<h3>預報修正歷程 <small>每一版對 ${dayLabel(history.date)} 的預報</small></h3><div class="chart small" data-chart="revisions"></div>` : ""}`;
    element.querySelector("input[type=date]").addEventListener("change", (event) => {
      if (event.target.value) this.loadHistory(event.target.value);
    });
    if (history.observed.length) this.charts.make(element.querySelector('[data-chart="day"]'), historyDayOption(history));
    if (history.revisions.length > 1) this.charts.make(element.querySelector('[data-chart="revisions"]'), revisionsOption(history));
  }

  dispose() {
    this.aborter.abort();
    this.charts.dispose();
    this.container.innerHTML = "";
  }
}
