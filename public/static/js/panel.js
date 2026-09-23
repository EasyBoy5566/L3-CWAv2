// One county's weather, laid out like the iPhone Weather app: a hero with the
// temperature, an hourly strip, the week, a grid of detail tiles, then the
// observed trend and forecast history. The globe's side panel and the
// standalone /region?name=<縣市> page both use it.
import { getJSON, regionUrl } from "./api.js";
import { ChartSet, historyDayOption, humidityPressureOption, revisionsOption, trendOption } from "./charts.js";
import { dayLabel, escapeHtml, hhmm, moonPhase, moonSvg, num, todayInTaipei, windText } from "./format.js";
import { Segmented, refract } from "./glass.js";
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

// ---------- tile graphics ----------

function compass(direction, speed) {
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i * 5 * Math.PI) / 180;
    const long = i % 18 === 0;
    const r1 = long ? 40 : 44;
    return `<line x1="${60 + r1 * Math.sin(a)}" y1="${60 - r1 * Math.cos(a)}" x2="${60 + 48 * Math.sin(a)}" y2="${60 - 48 * Math.cos(a)}" stroke="rgba(255,255,255,${long ? 0.7 : 0.25})" stroke-width="${long ? 1.6 : 1}"/>`;
  }).join("");
  const letters = [["北", 60, 31], ["東", 91, 64], ["南", 60, 96], ["西", 29, 64]]
    .map(([t, x, y]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.75)">${t}</text>`).join("");
  // CWA gives where the wind comes from; the arrow points where it goes.
  const arrow = direction === null || direction === undefined ? "" : `
    <g transform="rotate(${direction + 180} 60 60)">
      <line x1="60" y1="98" x2="60" y2="26" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M60 18l-6 10h12z" fill="#fff"/>
      <circle cx="60" cy="100" r="3.6" fill="none" stroke="#fff" stroke-width="2"/>
    </g>`;
  return `<svg class="tile-art" viewBox="0 0 120 120" role="img" aria-label="風向">
    ${ticks}${letters}${arrow}
    <circle cx="60" cy="60" r="19" fill="rgba(10,16,32,.72)"/>
    <text x="60" y="61" text-anchor="middle" font-size="15" font-weight="600" fill="#fff">${speed === null || speed === undefined ? "—" : speed.toFixed(1)}</text>
    <text x="60" y="73" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.7)">m/s</text>
  </svg>`;
}

function gauge(value, low = 980, high = 1040) {
  const start = -225;
  const sweep = 270;
  const point = (angle, r) => {
    const a = (angle * Math.PI) / 180;
    return [60 + r * Math.cos(a), 60 + r * Math.sin(a)];
  };
  const ticks = Array.from({ length: 46 }, (_, i) => {
    const angle = start + (sweep * i) / 45;
    const [x1, y1] = point(angle, 40);
    const [x2, y2] = point(angle, 48);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,.28)" stroke-width="1.2" stroke-linecap="round"/>`;
  }).join("");
  let marker = "";
  if (value !== null && value !== undefined) {
    const t = Math.min(Math.max((value - low) / (high - low), 0), 1);
    const [x1, y1] = point(start + sweep * t, 37);
    const [x2, y2] = point(start + sweep * t, 51);
    marker = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>`;
  }
  return `<svg class="tile-art" viewBox="0 0 120 120" role="img" aria-label="氣壓">
    ${ticks}${marker}
    <text x="60" y="63" text-anchor="middle" font-size="17" font-weight="600" fill="#fff">${value === null || value === undefined ? "—" : Math.round(value)}</text>
    <text x="60" y="77" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.7)">hPa</text>
    <text x="30" y="104" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.55)">低</text>
    <text x="90" y="104" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.55)">高</text>
  </svg>`;
}

// The sun's path as a sine arc over the horizon, with a dot where it is now.
function sunArc(sunrise, sunset, now) {
  const width = 160;
  const horizon = 46;
  const x = (t) => 10 + (t + 0.25) * ((width - 20) / 1.5);
  const y = (t) => horizon - 32 * Math.sin(Math.PI * t);
  const points = [];
  for (let t = -0.25; t <= 1.2501; t += 0.025) points.push(`${x(t).toFixed(1)},${y(t).toFixed(1)}`);
  const path = `M${points.join(" L")}`;
  const t = Math.min(Math.max((now - sunrise) / (sunset - sunrise), -0.25), 1.25);
  const up = t >= 0 && t <= 1;
  const clip = `sun-above-${sunrise.getTime()}`;
  return `<svg class="tile-art wide" viewBox="0 0 ${width} 64" role="img" aria-label="太陽軌跡">
    <defs><clipPath id="${clip}"><rect x="0" y="0" width="${width}" height="${horizon}"/></clipPath></defs>
    <path d="${path}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2"/>
    <path d="${path}" fill="none" stroke="rgba(253,224,71,.85)" stroke-width="2.4" clip-path="url(#${clip})"/>
    <line x1="4" y1="${horizon}" x2="${width - 4}" y2="${horizon}" stroke="rgba(255,255,255,.35)" stroke-width="1"/>
    <circle cx="${x(t)}" cy="${y(t)}" r="${up ? 5.5 : 4}" fill="${up ? "#fff7cc" : "rgba(255,255,255,.5)"}"/>
  </svg>`;
}

export class RegionView {
  constructor(container, name, { mode = "drawer" } = {}) {
    this.container = container;
    this.name = name;
    this.mode = mode;
    this.charts = new ChartSet();
    this.trendDays = 7;
    this.aborter = new AbortController();
  }

  async load() {
    const page = this.mode === "page";
    const card = (part, extra = "") =>
      `<section class="wx-card ${extra}${page ? " glass" : ""}" data-part="${part}"${page ? ' data-refract="30"' : ""}></section>`;
    this.container.classList.add("wx");
    this.container.innerHTML = `
      ${page ? "" : `<div class="wx-compact" data-part="compact" aria-hidden="true"></div>`}
      <header class="wx-hero" data-part="hero"><div class="skeleton"></div></header>
      ${card("hourly", "span")}
      ${card("week", "week")}
      <div class="wx-tiles" data-part="tiles"></div>
      ${card("trend", "span")}
      ${card("history", "span")}
      <p class="wx-foot" data-part="foot"></p>`;
    refract(this.container);
    this.initTrend();
    if (!page) this.watchHero();
    await this.refresh();
    this.loadTrend();
    this.loadHistory();
  }

  part(name) {
    return this.container.querySelector(`[data-part="${name}"]`);
  }

  // When the hero scrolls away, a one-line header takes its place, as in iOS.
  watchHero() {
    const compact = this.part("compact");
    this.heroObserver = new IntersectionObserver(([entry]) => {
      compact.classList.toggle("shown", !entry.isIntersecting);
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
    // The panel's sky follows the weather, as the iOS backgrounds do.
    this.container.dataset.sky = `${kind}-${night ? "night" : "day"}`;
    this.renderHero(data, kind, night);
    this.renderHourly(data);
    this.renderWeek(data);
    this.renderTiles(data);
    this.renderFoot(data);
  }

  renderHero({ name, current, hourly, week }, kind, night) {
    const temperature = current?.temperature ?? hourly[0]?.temperature ?? null;
    const condition = current?.weather ?? hourly[0]?.wx ?? "";
    const today = week.find((d) => d.dataDate === todayInTaipei()) ?? week[0];
    this.part("hero").innerHTML = `
      <h2>${escapeHtml(name)}</h2>
      <div class="wx-temp">${temperature === null ? "—" : Math.round(temperature)}<span>°</span></div>
      <div class="wx-cond">${weatherIcon(kind, { night, size: 22 })}${escapeHtml(condition)}</div>
      ${today ? `<div class="wx-hilo">最高 ${deg(today.maxt)}　最低 ${deg(today.mint)}</div>` : ""}`;
    const compact = this.part("compact");
    if (compact) {
      compact.innerHTML = `<div class="bar"><b>${escapeHtml(name)}</b><span>${temperature === null ? "—" : Math.round(temperature)}° ｜ ${escapeHtml(condition)}</span></div>`;
    }
  }

  renderHourly({ hourly, periods, current }) {
    const element = this.part("hourly");
    if (!hourly.length) {
      element.innerHTML = `${title("clock", "每小時預報")}<div class="empty">暫無逐時預報。</div>`;
      return;
    }
    const summary = (periods[0]?.description ?? "").split("。").filter(Boolean).slice(0, 2).join("。");
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
      ${summary ? `<p class="wx-summary">${escapeHtml(summary)}。</p>` : ""}
      ${title("clock", "每小時預報")}
      <ol class="hours">${items.map((item) => item.html).join("")}</ol>`;
    dragToScroll(element.querySelector(".hours"));
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
      return `<li>
        <span class="d">${d.dataDate === today ? "今天" : weekday(d.dataDate)}</span>
        <span class="i">${weatherIcon(kindFromCode(d.wxCode), { size: 26, label: d.wx ?? "" })}${d.pop >= 20 ? `<small class="pop">${Math.round(d.pop)}%</small>` : ""}</span>
        <span class="lo">${d.approx ? `<i title="由 12 小時預報推估">約</i>` : ""}${deg(d.mint)}</span>
        <span class="bar"><i style="left:${left}%;width:${width}%;background:linear-gradient(90deg, ${colorAt(TEMPERATURE, d.mint)}, ${colorAt(TEMPERATURE, d.maxt)})"></i>${dot}</span>
        <span class="hi">${deg(d.maxt)}</span>
      </li>`;
    }).join("");
    element.innerHTML = `${title("calendar", `${week.length} 天預報`)}<ol class="days">${rows}</ol>`;
  }

  renderTiles({ current, hourly, periods, astronomy }) {
    const page = this.mode === "page";
    const first = hourly[0] ?? {};
    const tile = (glyph, label, main, foot, extra = "") => `
      <section class="wx-card tile ${extra}${page ? " glass" : ""}"${page ? ' data-refract="24"' : ""}>
        ${title(glyph, label)}
        <div class="tile-main">${main}</div>
        <p class="tile-foot">${foot}</p>
      </section>`;

    const actual = current?.temperature ?? first.temperature;
    const feels = first.apparentTemperature;
    let feelsNote = "";
    if (feels !== null && feels !== undefined && actual !== null && actual !== undefined) {
      if (Math.abs(feels - actual) < 1.5) feelsNote = "與實際溫度相近。";
      else feelsNote = feels > actual ? "濕度讓體感比實際更熱。" : "風讓體感比實際更涼。";
    }

    const humidity = current?.humidity ?? first.humidity;
    const speed = current?.windSpeed ?? null;
    const direction = current?.windDir ?? null;
    const next = periods.find((p) => p.pop !== null);
    const uvPeriod = periods.find((p) => p.uvIndex !== null);
    const uv = uvPeriod?.uvIndex ?? null;
    const uvTomorrow = uvPeriod && uvPeriod.startTime.slice(0, 10) !== todayInTaipei();

    const today = astronomy.find((a) => a.date === todayInTaipei()) ?? astronomy[0];
    let sunTile = "";
    if (today?.sunrise && today?.sunset) {
      const rise = at(today.date, today.sunrise);
      const set = at(today.date, today.sunset);
      const now = new Date();
      const tomorrow = astronomy.find((a) => a.date > today.date);
      let label = "日落";
      let time = today.sunset;
      let foot = `日出：${today.sunrise}`;
      if (now < rise) {
        label = "日出";
        time = today.sunrise;
        foot = `日落：${today.sunset}`;
      } else if (now >= set) {
        label = "日出";
        time = tomorrow?.sunrise ?? "—";
        foot = `今日日落：${today.sunset}`;
      }
      sunTile = tile("sun", label, `<div class="big">${time}</div>${sunArc(rise, set, now)}`, foot);
    }

    const phase = moonPhase();
    const moonFoot = today ? `月出 ${today.moonrise ?? "—"}　月落 ${today.moonset ?? "—"}` : "";

    this.part("tiles").innerHTML = [
      tile("thermo", "體感溫度", `<div class="big">${deg(feels)}</div>`, feelsNote),
      tile("drop", "濕度", `<div class="big">${num(humidity, 0, "%")}</div>`,
        first.dewPoint === null || first.dewPoint === undefined ? "" : `目前露點溫度為 ${deg(first.dewPoint)}。`),
      tile("wind", "風", compass(direction, speed),
        speed === null ? "暫無風的觀測。" : `${windText(direction)}，蒲福 ${beaufort(speed)} 級。`, "art"),
      tile("gauge", "氣壓", gauge(current?.pressure ?? null), "測站氣壓；縣內無平地測站時取鄰近測站。", "art"),
      tile("rain", "降雨量", `<div class="big">${num(current?.rain, 1, "")}<small> 毫米</small></div>`,
        `今日累積。${next ? `未來 12 小時降雨機率 ${Math.round(next.pop)}%。` : ""}`),
      tile("uv", uvTomorrow ? "紫外線（明日）" : "紫外線",
        `<div class="big">${uv === null ? "—" : Math.round(uv)}</div><div class="sub">${uv === null ? "" : uvLevel(uv)}</div>
         <div class="uv-bar">${uv === null ? "" : `<em style="left:${Math.min(uv / 11, 1) * 100}%"></em>`}</div>`,
        uv === null ? "暫無紫外線預報。" : "白天時段的最高值。"),
      sunTile,
      tile("moon", "月相", `<div class="moon-row">${moonSvg(phase, 54)}<div><div class="big small">${phase.name}</div><div class="sub">照亮 ${Math.round(phase.illumination * 100)}%</div></div></div>`, moonFoot),
    ].join("");
    refract(this.part("tiles"));
  }

  renderFoot({ name, current, forecastFetchedAt }) {
    const link = this.mode === "drawer"
      ? ` · <a href="/region?${new URLSearchParams({ name })}" target="_blank" rel="noopener">開啟完整頁面 ↗</a>` : "";
    const observed = current ? `${hhmm(current.observedAt)} 觀測（${current.stationCount} 站中位數）` : "無即時觀測";
    this.part("foot").innerHTML = `${observed} · 預報 ${hhmm(forecastFetchedAt)} 取得 · 資料：中央氣象署${link}`;
  }

  initTrend() {
    const element = this.part("trend");
    const tabs = [1, 7, 30].map((d) => `<button type="button" data-value="${d}" aria-pressed="${d === this.trendDays}">${d} 天</button>`).join("");
    element.innerHTML = `
      ${title("chart", "過去觀測", `<span class="tabs" role="group" aria-label="期間">${tabs}</span>`)}
      <div class="trend-body"></div>
      <p class="note">縣市平地測站中位數，每小時一點；三角形為當日最後一版預報的最高／最低。</p>`;
    new Segmented(element.querySelector(".tabs"), {
      attribute: "aria-pressed",
      onChange: (value) => {
        this.trendDays = Number(value);
        this.loadTrend();
      },
    });
  }

  async loadTrend() {
    const element = this.part("trend").querySelector(".trend-body");
    element.innerHTML = `<div class="chart" data-chart="trend"></div><div class="chart small" data-chart="hp"></div>`;
    try {
      const trend = await getJSON(regionUrl(this.name, "/trend", { days: this.trendDays }), { signal: this.aborter.signal });
      if (!trend.observed.length) {
        element.innerHTML = `<div class="empty">觀測資料累積中，排程每 10 分鐘寫入一次。</div>`;
        return;
      }
      this.charts.make(element.querySelector('[data-chart="trend"]'), trendOption(trend));
      this.charts.make(element.querySelector('[data-chart="hp"]'), humidityPressureOption(trend));
    } catch (error) {
      if (error.name !== "AbortError") element.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    }
  }

  async loadHistory(day) {
    const element = this.part("history");
    let history;
    try {
      history = await getJSON(regionUrl(this.name, "/history", day ? { date: day } : {}), { signal: this.aborter.signal });
    } catch (error) {
      if (error.name !== "AbortError") element.innerHTML = `${title("history", "預報與實測")}<div class="error-box">${escapeHtml(error.message)}</div>`;
      return;
    }
    const last = history.revisions.at(-1);
    const summary = history.summary;
    const diff = (forecast, observed) => (forecast === null || forecast === undefined || observed === null || observed === undefined
      ? "—" : `${forecast - observed > 0 ? "+" : ""}${(forecast - observed).toFixed(1)}°`);
    const stat = (label, value) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
    element.innerHTML = `
      ${title("history", "預報與實測", `<input type="date" value="${history.date}" min="${history.range.first ?? history.date}" max="${history.range.last}" aria-label="日期">`)}
      <div class="stats">
        ${stat("實測 高／低", summary ? `${deg(summary.tmax)} / ${deg(summary.tmin)}${summary.partial ? "<small>至目前</small>" : ""}` : "—")}
        ${stat("預報 高／低", last ? `${deg(last.maxt)} / ${deg(last.mint)}` : "—")}
        ${stat("誤差 高／低", summary && last ? `${diff(last.maxt, summary.tmax)} / ${diff(last.mint, summary.tmin)}` : "—")}
        ${stat("預報版本", `${history.revisions.length}`)}
      </div>
      ${history.observed.length ? `<div class="chart" data-chart="day"></div>` : `<div class="empty">${dayLabel(history.date)} 沒有實測資料${history.range.first ? `，可查詢 ${history.range.first} 之後` : ""}。</div>`}
      ${history.revisions.length > 1 ? `<p class="note">預報修正歷程：每一版對 ${dayLabel(history.date)} 的預報</p><div class="chart small" data-chart="revisions"></div>` : ""}`;
    element.querySelector("input[type=date]").addEventListener("change", (event) => {
      if (event.target.value) this.loadHistory(event.target.value);
    });
    if (history.observed.length) this.charts.make(element.querySelector('[data-chart="day"]'), historyDayOption(history));
    if (history.revisions.length > 1) this.charts.make(element.querySelector('[data-chart="revisions"]'), revisionsOption(history));
  }

  dispose() {
    this.aborter.abort();
    this.heroObserver?.disconnect();
    this.charts.dispose();
    this.container.classList.remove("wx");
    delete this.container.dataset.sky;
    this.container.innerHTML = "";
  }
}
