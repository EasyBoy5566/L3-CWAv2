// One county's weather in liquid glass: a hero with the temperature and
// capsules for the day's range, an hourly strip of glass capsules, the
// temperature and rain chart, the week, and a grid of detail tiles. The
// globe's side panel and the standalone /region?name=<縣市> page share it.
import { getJSON, regionUrl } from "./api.js";
import { ChartSet, hourlyOption, loadECharts } from "./charts.js";
import { escapeHtml, hhmm, moonPhase, moonSvg, num, todayInTaipei, windText } from "./format.js";
import { refract } from "./glass.js";
import { GLYPH, SUNRISE, SUNSET, kindFromCode, kindFromText, weatherIcon } from "./icons.js";
import { TEMPERATURE, colorAt } from "./scale.js";

const weekdayFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", weekday: "short" });
const weekday = (ymd) => weekdayFormat.format(new Date(`${ymd}T12:00:00+08:00`));
const deg = (value) => (value === null || value === undefined ? "—" : `${Math.round(value)}°`);
const at = (ymd, hm) => new Date(`${ymd}T${hm}:00+08:00`);
// Taipei wall-clock time as "YYYY-MM-DDTHH:MM", comparable with CWA timestamps.
const taipeiNow = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);

function title(glyph, text, extra = "") {
  return `<h3 class="wx-title"><span class="glyph">${GLYPH[glyph]}</span><span class="label">${text}</span>${extra}</h3>`;
}

// Night falls between sunset and sunrise; CWA's tables give both per day.
function nightAt(iso, astro) {
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  const entry = astro.get(day);
  return time < (entry?.sunrise ?? "06:00") || time >= (entry?.sunset ?? "18:00");
}

function beaufort(speed) {
  const limits = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const level = limits.findIndex((limit) => speed < limit);
  return level === -1 ? 12 : level;
}

function uvLevel(value) {
  if (value <= 2) return "低量級";
  if (value <= 5) return "中量級";
  if (value <= 7) return "高量級";
  if (value <= 10) return "過量級";
  return "危險級";
}

function dragToScroll(list) {
  let startX = null;
  let startScroll = 0;
  list.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startScroll = list.scrollLeft;
    list.setPointerCapture(event.pointerId);
    list.classList.add("dragging");
  });
  list.addEventListener("pointermove", (event) => {
    if (startX !== null) list.scrollLeft = startScroll - (event.clientX - startX);
  });
  const stop = () => {
    startX = null;
    list.classList.remove("dragging");
  };
  list.addEventListener("pointerup", stop);
  list.addEventListener("pointercancel", stop);
}

// ---------- township card ----------

// A township's weather, for its own card beside the controls (town-card.js),
// apart from the county's panel: sized for a narrow column.
export function townHead(town) {
  return `<div class="town-head"><span class="scope-tag">鄉鎮</span><h3>${escapeHtml(town.town)}</h3><span>${escapeHtml(town.county)}</span></div>`;
}

// Where each gauge's marker sits: heat-injury index 24–38, UV 0–12.
const HEAT_RANGE = [24, 38];
const UV_TOP = 12;

function meter({ kind, label, value, level, at, tip }) {
  const place = value === null || value === undefined ? null : Math.min(Math.max(at, 0), 1);
  return `<div class="meter ${kind}" title="${escapeHtml(tip)}">
      <div class="meter-top"><span>${label}</span><b>${place === null ? "—" : Math.round(value)}</b><em>${escapeHtml(level)}</em></div>
      <div class="meter-bar">${place === null ? "" : `<i style="left:${(place * 100).toFixed(1)}%"></i>`}</div>
    </div>`;
}

// The windows are nested (the last hour is inside the last three), so the bars
// only grow downwards: how the rain has piled up, looking back from now.
const RAIN_WINDOWS = [["r1h", "近 1 小時"], ["r3h", "近 3 小時"], ["r24h", "近 24 小時"], ["r3d", "近 3 天"]];

// CWA's rainfall grades (雨量分級).
function rainGrade(r) {
  const day = r.r24h ?? 0;
  if (day >= 500) return "超大豪雨";
  if (day >= 350) return "大豪雨";
  if (day >= 200 || (r.r3h ?? 0) >= 100) return "豪雨";
  if (day >= 80 || (r.r1h ?? 0) >= 40) return "大雨";
  return null;
}

function rainBlock(r) {
  const top = Math.max(...RAIN_WINDOWS.map(([key]) => r[key] ?? 0), r.r10m ?? 0);
  if (top <= 0) return `<p class="rain-none">${GLYPH.uv}過去 3 天都沒有降雨</p>`;
  const raining = (r.r10m ?? 0) > 0;
  const since = RAIN_WINDOWS.find(([key]) => (r[key] ?? 0) > 0);
  const grade = rainGrade(r);
  const status = raining
    ? `<b class="wet">正在下雨</b><span>近 10 分鐘 ${num(r.r10m, 1)} mm</span>`
    : `<b>目前沒有下雨</b><span>${since[1]}內下過雨</span>`;
  // Square root, so a shower still shows next to a three-day total.
  const width = (value) => (value > 0 ? Math.max(Math.sqrt(value / top) * 100, 3) : 0);
  return `<p class="rain-status">${status}${grade ? `<em class="grade" title="中央氣象署雨量分級">${grade}</em>` : ""}</p>
    <div class="rain-ladder">${RAIN_WINDOWS.map(([key, label]) => `
      <div class="rain-step${(r[key] ?? 0) > 0 ? " wet" : ""}">
        <span>${label}</span><i><em style="width:${width(r[key] ?? 0).toFixed(1)}%"></em></i><b>${num(r[key], 1)}<small> mm</small></b>
      </div>`).join("")}</div>`;
}

export function townBody(data) {
  const parts = [];
  const note = (text) => `<p class="note">${text}</p>`;

  // Now: the township's forecast, with heat and UV beside it.
  const f = data.forecast?.row;
  const meters = [];
  const h = data.heat?.row;
  if (h) {
    const peak = h.peak === null ? "" : `24 小時內最高 ${Math.round(h.peak)}（${hhmm(h.peakTime)}）${h.peakWarning ? ` ${h.peakWarning}` : ""}`;
    meters.push(meter({ kind: "heat", label: "熱傷害", value: h.index, level: h.warning ?? "無警示", at: (h.index - HEAT_RANGE[0]) / (HEAT_RANGE[1] - HEAT_RANGE[0]), tip: peak }));
  }
  const u = data.uv?.row;
  if (u) {
    const where = data.uv.borrowed ? `，取自${u.name}站` : "";
    meters.push(meter({ kind: "uv", label: "紫外線", value: u.uv, level: uvLevel(u.uv), at: u.uv / UV_TOP, tip: `${data.uv.date ?? ""} 當日最大值${where}` }));
  }
  parts.push(`
    <div class="town-now">
      <div class="town-temp">${f ? deg(f.t) : "—"}</div>
      <div class="town-wx">
        ${f ? `<div>${weatherIcon(kindFromCode(f.wxCode), { size: 22, night: nightAt(taipeiNow(), new Map()) })}${escapeHtml(f.wx ?? "")}</div>
        <small>降雨機率 ${f.pop === null ? "—" : `${Math.round(f.pop)}%`}</small>` : "<small>暫無鄉鎮預報</small>"}
      </div>
      <div class="town-meters">${meters.join("")}</div>
    </div>`);

  // Rain: the township's wettest gauge per period, as a row of figures.
  const r = data.rain;
  parts.push(`<div class="town-block">
      <div class="town-block-head">${GLYPH.rain}<span>雨量</span><small>${r?.count ? `累積雨量 · 鄉鎮內 ${r.count} 站最大值` : ""}</small></div>
      ${data.rain?.error ? note("雨量資料載入失敗") : r?.count ? rainBlock(r) : note("鄉鎮內沒有雨量站")}
    </div>`);

  // Stations: one table, every column labelled.
  const st = data.stations;
  parts.push(`<div class="town-block">
      <div class="town-block-head">${GLYPH.thermo}<span>氣象站</span><small>${st?.list?.length ? `${st.count} 站 · ${hhmm(st.time)} 觀測` : ""}</small></div>
      ${data.stations?.error ? note("觀測資料載入失敗") : st?.list?.length ? `
      <table class="town-table">
        <colgroup><col><col class="c-t"><col class="c-rh"><col class="c-gust"></colgroup>
        <thead><tr><th>測站</th><th>氣溫</th><th>濕度</th><th>陣風<small> m/s</small></th></tr></thead>
        <tbody>${st.list.map((s) => `<tr>
          <td title="${escapeHtml(s.name)}">${escapeHtml(s.name)}<small>${s.alt === null ? "" : `${Math.round(s.alt)} m`}</small></td>
          <td class="t">${num(s.t, 1, "°")}</td>
          <td>${num(s.rh, 0, "%")}</td>
          <td>${s.gust === null ? "—" : num(s.gust, 1)}</td>
        </tr>`).join("")}</tbody>
      </table>` : note("鄉鎮內沒有氣象站")}
    </div>`);
  return parts.join("");
}

export class RegionView {
  // onSummary({ name, temperature, condition, icon }): the county in one line,
  // for its folded card.
  constructor(container, name, { mode = "drawer", onSummary } = {}) {
    this.container = container;
    this.name = name;
    this.mode = mode;
    this.onSummary = onSummary;
    this.charts = new ChartSet();
    this.aborter = new AbortController();
  }

  async load() {
    const page = this.mode === "page";
    // Inside the globe's panel (already glass) cards are lighter lenses; on
    // the standalone page each is a full pane of glass.
    const card = (part) =>
      `<section class="wx-card ${page ? "glass" : "lens"}" data-part="${part}"${page ? ' data-refract="30"' : ""}></section>`;
    this.container.classList.add("wx");
    this.container.innerHTML = `
      ${page ? "" : `<div class="wx-compact" data-part="compact" aria-hidden="true"></div>`}
      <header class="wx-hero" data-part="hero"><div class="skeleton"></div></header>
      ${card("hourly")}
      ${card("chart")}
      ${card("week")}
      <div class="wx-tiles" data-part="tiles"></div>
      <p class="wx-foot" data-part="foot"></p>`;
    refract(this.container);
    if (!page) this.watchHero();
    await this.refresh();
  }

  part(name) {
    return this.container.querySelector(`[data-part="${name}"]`);
  }

  // When the hero scrolls away, a one-line header takes its place, as in iOS.
  // Only once it has gone up past the top: a tall township card above it (a
  // mountain township with many stations) pushes it below the bottom, and
  // that is not scrolling past it.
  watchHero() {
    const compact = this.part("compact");
    this.heroObserver = new IntersectionObserver(([entry]) => {
      const above = entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
      compact.classList.toggle("shown", !entry.isIntersecting && above);
    }, { root: this.container, threshold: 0, rootMargin: "-60px 0px 0px 0px" });
    this.heroObserver.observe(this.part("hero"));
  }

  async refresh() {
    let data;
    try {
      data = await getJSON(regionUrl(this.name), { signal: this.aborter.signal });
    } catch (error) {
      if (error.name === "AbortError") return;
      this.part("hero").innerHTML = `<h2>${escapeHtml(this.name)}</h2><div class="error-box">無法載入資料：${escapeHtml(error.message)}</div>`;
      return;
    }
    this.data = data;
    this.astro = new Map(data.astronomy.map((a) => [a.date, a]));
    const night = nightAt(taipeiNow(), this.astro);
    const kind = kindFromText(data.current?.weather) ?? kindFromCode(data.hourly[0]?.wxCode) ?? "partly";
    this.renderHero(data, kind, night);
    this.renderHourly(data);
    this.renderChart(data);
    this.renderWeek(data);
    this.renderTiles(data);
    this.renderFoot(data);
  }

  renderHero({ name, current, hourly, week, periods }, kind, night) {
    const temperature = current?.temperature ?? hourly[0]?.temperature ?? null;
    const condition = current?.weather ?? hourly[0]?.wx ?? "";
    const today = week.find((d) => d.dataDate === todayInTaipei()) ?? week[0];
    const summary = (periods[0]?.description ?? "").split("。").filter(Boolean).slice(0, 2).join("。");
    // The feels-like temperature lives in the details card below.
    this.part("hero").innerHTML = `
      <h2 class="wx-name">${escapeHtml(name)}</h2>
      <div class="wx-now">
        <div class="wx-temp">${temperature === null ? "—" : Math.round(temperature)}<span>°</span></div>
        <div class="wx-side">
          <div class="wx-cond">${weatherIcon(kind, { night, size: 30 })}<span>${escapeHtml(condition)}</span></div>
          ${today ? `<div class="wx-hilo"><span>最高 <b class="up">${deg(today.maxt)}</b></span><span>最低 <b class="down">${deg(today.mint)}</b></span></div>` : ""}
        </div>
      </div>
      ${summary ? `<p class="wx-summary">${escapeHtml(summary)}。</p>` : ""}`;
    const compact = this.part("compact");
    if (compact) {
      compact.innerHTML = `<div class="bar"><b>${escapeHtml(name)}</b><span>${temperature === null ? "—" : Math.round(temperature)}° ｜ ${escapeHtml(condition)}</span></div>`;
    }
    this.onSummary?.({ name, temperature, condition, icon: weatherIcon(kind, { night, size: 22 }) });
  }

  renderHourly({ hourly, current }) {
    const element = this.part("hourly");
    if (!hourly.length) {
      element.innerHTML = `${title("clock", "每小時預報")}<div class="empty">暫無逐時預報。</div>`;
      return;
    }
    const items = hourly.map((h, i) => {
      const hour = h.time.slice(11, 13);
      const label = i === 0 ? "現在" : hour === "00" ? weekday(h.time.slice(0, 10)) : `${Number(hour)}時`;
      const live = i === 0 && current?.temperature !== null && current?.temperature !== undefined;
      const pop = h.pop >= 20 ? `<small class="pop">${Math.round(h.pop)}%</small>` : `<small class="pop"></small>`;
      return {
        time: new Date(h.time).getTime(),
        html: `<li class="${i === 0 ? "now" : ""}${hour === "00" && i ? " midnight" : ""}">
          <span class="t">${label}</span>
          <span class="i">${weatherIcon(kindFromCode(h.wxCode), { night: nightAt(h.time, this.astro), size: 28, label: h.wx ?? "" })}${pop}</span>
          <b>${deg(live ? current.temperature : h.temperature)}</b>
        </li>`,
      };
    });
    // Sunrise and sunset slot in between the hours, as in iOS.
    const first = items[0].time;
    const last = items[items.length - 1].time;
    for (const [day, a] of this.astro) {
      for (const [key, label, icon] of [["sunrise", "日出", SUNRISE], ["sunset", "日落", SUNSET]]) {
        if (!a[key]) continue;
        const moment = at(day, a[key]).getTime();
        if (moment <= first || moment >= last) continue;
        items.push({ time: moment, html: `<li class="sun-event"><span class="t">${a[key]}</span><span class="i">${icon}<small class="pop"></small></span><b>${label}</b></li>` });
      }
    }
    items.sort((a, b) => a.time - b.time);
    element.innerHTML = `
      ${title("clock", "每小時預報", `<span class="hint">拖曳查看更多</span>`)}
      <ol class="hours">${items.map((item) => item.html).join("")}</ol>`;
    dragToScroll(element.querySelector(".hours"));
  }

  renderChart({ hourly }) {
    const element = this.part("chart");
    if (!hourly.length) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    const key = (color, label, dashed = false) =>
      `<span class="key"><i style="background:${color}"${dashed ? ' class="dashed"' : ""}></i>${label}</span>`;
    if (!element.querySelector(".chart")) {
      element.innerHTML = `
        ${title("chart", "溫度與降雨", `<span class="keys">${key("#fdba74", "溫度")}${key("#fef08a", "體感", true)}${key("#7dd3fc", "降雨機率")}</span>`)}
        <div class="chart"></div>`;
    }
    const chart = element.querySelector(".chart");
    loadECharts().then(() => {
      if (chart.isConnected) this.charts.make(chart, hourlyOption(hourly));
    }).catch((error) => {
      chart.innerHTML = `<p class="note">${escapeHtml(error.message)}</p>`;
    });
  }

  renderWeek({ week, current }) {
    const element = this.part("week");
    if (!week.length) {
      element.innerHTML = `${title("calendar", "一週預報")}<div class="empty">暫無一週預報。</div>`;
      return;
    }
    const now = current?.temperature ?? null;
    const values = week.flatMap((d) => [d.mint, d.maxt]).concat(now ?? []).filter((v) => v !== null);
    const lo = Math.floor(Math.min(...values));
    const hi = Math.ceil(Math.max(...values));
    const span = Math.max(hi - lo, 1);
    const today = todayInTaipei();
    const rows = week.map((d) => {
      const left = ((d.mint - lo) / span) * 100;
      const width = Math.max(((d.maxt - d.mint) / span) * 100, 3);
      const dot = d.dataDate === today && now !== null ? `<em style="left:${((now - lo) / span) * 100}%"></em>` : "";
      return `<li class="${d.dataDate === today ? "today" : ""}">
        <span class="d">${d.dataDate === today ? "今天" : weekday(d.dataDate)}</span>
        <span class="i">${weatherIcon(kindFromCode(d.wxCode), { size: 26, label: d.wx ?? "" })}${d.pop >= 20 ? `<small class="pop">${Math.round(d.pop)}%</small>` : ""}</span>
        <span class="lo">${d.approx ? `<i title="由 12 小時預報推估">約</i>` : ""}${deg(d.mint)}</span>
        <span class="bar"><i style="left:${left}%;width:${width}%;background:linear-gradient(90deg, ${colorAt(TEMPERATURE, d.mint)}, ${colorAt(TEMPERATURE, d.maxt)})"></i>${dot}</span>
        <span class="hi">${deg(d.maxt)}</span>
      </li>`;
    }).join("");
    element.innerHTML = `${title("calendar", `${week.length} 天預報`)}<ol class="days">${rows}</ol>`;
  }

  // Everything else about now, in one card: two columns of label, value and a
  // short note, where eight separate tiles used to take a screen and a half.
  renderTiles({ current, hourly, periods, astronomy }) {
    const page = this.mode === "page";
    const first = hourly[0] ?? {};
    const item = (glyph, label, value, note = "") => `
      <div class="detail">
        <span class="detail-label">${GLYPH[glyph]}${label}</span>
        <b class="detail-value">${value}</b>
        <small class="detail-note">${note}</small>
      </div>`;
    const unit = (value, digits, text) => (value === null || value === undefined ? "—" : `${num(value, digits)}<small>${text}</small>`);

    const actual = current?.temperature ?? first.temperature;
    const feels = first.apparentTemperature;
    let feelsNote = "";
    if (feels !== null && feels !== undefined && actual !== null && actual !== undefined) {
      if (Math.abs(feels - actual) < 1.5) feelsNote = "與實際溫度相近";
      else feelsNote = feels > actual ? "濕度讓體感更熱" : "風讓體感更涼";
    }
    const humidity = current?.humidity ?? first.humidity;
    const speed = current?.windSpeed ?? null;
    const direction = current?.windDir ?? null;
    const next = periods.find((p) => p.pop !== null);
    const uvPeriod = periods.find((p) => p.uvIndex !== null);
    const uv = uvPeriod?.uvIndex ?? null;
    const uvTomorrow = uvPeriod && uvPeriod.startTime.slice(0, 10) !== todayInTaipei();

    // The next sun event, and the other one as the note.
    const today = astronomy.find((a) => a.date === todayInTaipei()) ?? astronomy[0];
    let sun = item("sun", "日出日落", "—");
    if (today?.sunrise && today?.sunset) {
      const now = new Date();
      const tomorrow = astronomy.find((a) => a.date > today.date);
      if (now < at(today.date, today.sunrise)) sun = item("sun", "日出", today.sunrise, `日落 ${today.sunset}`);
      else if (now < at(today.date, today.sunset)) sun = item("sun", "日落", today.sunset, `日出 ${today.sunrise}`);
      else sun = item("sun", "明日日出", tomorrow?.sunrise ?? "—", `今日日落 ${today.sunset}`);
    }
    const phase = moonPhase();

    const card = `<section class="wx-card wx-details ${page ? "glass" : "lens"}"${page ? ' data-refract="24"' : ""}>
      ${title("gauge", "目前狀況")}
      <div class="details">
        ${item("thermo", "體感", deg(feels), feelsNote)}
        ${item("drop", "濕度", num(humidity, 0, "%"), first.dewPoint === null || first.dewPoint === undefined ? "" : `露點 ${deg(first.dewPoint)}`)}
        ${item("wind", "風", unit(speed, 1, "m/s"), speed === null ? "暫無觀測" : `${windText(direction)} · 蒲福 ${beaufort(speed)} 級`)}
        ${item("gauge", "氣壓", unit(current?.pressure, 0, "hPa"), "測站氣壓")}
        ${item("rain", "今日雨量", unit(current?.rain, 1, "mm"), next ? `12 小時內降雨機率 ${Math.round(next.pop)}%` : "")}
        ${item("uv", uvTomorrow ? "紫外線（明日）" : "紫外線", uv === null ? "—" : `${Math.round(uv)}<small>${uvLevel(uv)}</small>`,
          uv === null ? "暫無預報" : `<i class="uv-line"><em style="left:${(Math.min(uv / 11, 1) * 100).toFixed(1)}%"></em></i>`)}
        ${sun}
        ${item("moon", "月相", `${moonSvg(phase, 18)}${phase.name}`, `照亮 ${Math.round(phase.illumination * 100)}%${today?.moonrise ? ` · 月出 ${today.moonrise}` : ""}`)}
      </div>
    </section>`;
    this.part("tiles").innerHTML = card;
    refract(this.part("tiles"));
  }

  renderFoot({ name, current, forecastFetchedAt }) {
    const link = this.mode === "drawer"
      ? ` · <a href="/region?${new URLSearchParams({ name })}" target="_blank" rel="noopener">開啟完整頁面 ↗</a>` : "";
    const observed = current ? `${hhmm(current.observedAt)} 觀測（${current.stationCount} 站中位數）` : "無即時觀測";
    this.part("foot").innerHTML = `${observed} · 預報 ${hhmm(forecastFetchedAt)} 取得 · 資料：中央氣象署${link}`;
  }

  dispose() {
    this.aborter.abort();
    this.heroObserver?.disconnect();
    this.charts.dispose();
    this.container.classList.remove("wx");
    this.container.innerHTML = "";
  }
}
