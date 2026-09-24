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

// ---------- township card ----------

function townHead(town) {
  return `<div class="town-head"><h3>${escapeHtml(town.town)}</h3><span>${escapeHtml(town.county)} · 鄉鎮</span></div>`;
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

const RAIN_PERIODS = [["r10m", "10 分鐘"], ["r1h", "1 小時"], ["r3h", "3 小時"], ["r24h", "24 小時"], ["r3d", "3 天"]];

function townBody(data) {
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
      <div class="town-block-head">${GLYPH.rain}<span>雨量</span><small>${r?.count ? `鄉鎮內 ${r.count} 站最大值 · mm` : ""}</small></div>
      ${data.rain?.error ? note("雨量資料載入失敗") : r?.count ? `<div class="rain-row">${RAIN_PERIODS.map(([key, label]) => `
        <div class="rain-cell${key === "r24h" ? " main" : ""}${(r[key] ?? 0) > 0 ? " wet" : ""}"><b>${num(r[key], 1)}</b><span>${label}</span></div>`).join("")}</div>`
        : note("鄉鎮內沒有雨量站")}
    </div>`);

  // Stations: one table, every column labelled.
  const st = data.stations;
  parts.push(`<div class="town-block">
      <div class="town-block-head">${GLYPH.thermo}<span>氣象站</span><small>${st?.list?.length ? `${st.count} 站 · ${hhmm(st.time)} 觀測` : ""}</small></div>
      ${data.stations?.error ? note("觀測資料載入失敗") : st?.list?.length ? `
      <table class="town-table">
        <colgroup><col><col class="c-alt"><col class="c-t"><col class="c-rh"><col class="c-gust"></colgroup>
        <thead><tr><th>測站</th><th>海拔</th><th>氣溫</th><th>濕度</th><th>陣風</th></tr></thead>
        <tbody>${st.list.map((s) => `<tr>
          <td title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</td>
          <td>${s.alt === null ? "—" : `${Math.round(s.alt)} m`}</td>
          <td class="t">${num(s.t, 1, "°")}</td>
          <td>${num(s.rh, 0, "%")}</td>
          <td>${s.gust === null ? "—" : `${num(s.gust, 1)} m/s`}</td>
        </tr>`).join("")}</tbody>
      </table>` : note("鄉鎮內沒有氣象站")}
    </div>`);
  return parts.join("");
}

export class RegionView {
  constructor(container, name, { mode = "drawer" } = {}) {
    this.container = container;
    this.name = name;
    this.mode = mode;
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
      <section class="town" data-part="town" hidden></section>
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
    const feels = hourly[0]?.apparentTemperature;
    const summary = (periods[0]?.description ?? "").split("。").filter(Boolean).slice(0, 2).join("。");
    const chip = (content, extra = "") => `<span class="chip lens ${extra}">${content}</span>`;
    this.part("hero").innerHTML = `
      <div class="wx-place">
        <h2>${escapeHtml(name)}</h2>
        ${chip(`${weatherIcon(kind, { night, size: 18 })}${escapeHtml(condition)}`, "cond")}
      </div>
      <div class="wx-now">
        <div class="wx-temp">${temperature === null ? "—" : Math.round(temperature)}<span>°</span></div>
        <div class="wx-range">
          ${today ? chip(`<b class="up">↑</b>最高 ${deg(today.maxt)}`) + chip(`<b class="down">↓</b>最低 ${deg(today.mint)}`) : ""}
          ${feels === null || feels === undefined ? "" : chip(`體感 ${deg(feels)}`)}
        </div>
      </div>
      ${summary ? `<p class="wx-summary">${escapeHtml(summary)}。</p>` : ""}`;
    const compact = this.part("compact");
    if (compact) {
      compact.innerHTML = `<div class="bar"><b>${escapeHtml(name)}</b><span>${temperature === null ? "—" : Math.round(temperature)}° ｜ ${escapeHtml(condition)}</span></div>`;
    }
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

  renderTiles({ current, hourly, periods, astronomy }) {
    const page = this.mode === "page";
    const first = hourly[0] ?? {};
    const tile = (glyph, label, main, foot, extra = "") => `
      <section class="wx-card tile ${extra} ${page ? "glass" : "lens"}"${page ? ' data-refract="24"' : ""}>
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

  // ---------- township card ----------

  /** Show one township's data above the county's hero. `town` comes from geo.loadTowns. */
  async showTown(town, townData, sections) {
    const element = this.part("town");
    this.town = town;
    element.hidden = false;
    element.innerHTML = `${townHead(town)}<div class="wx-card lens town-card"><div class="skeleton town-skeleton"></div></div>`;
    this.container.scrollTo({ top: 0, behavior: "smooth" });
    const data = await townData.forTown(town, sections);
    if (this.town !== town || !element.isConnected) return; // another township was picked meanwhile
    element.innerHTML = `${townHead(town)}<div class="wx-card lens town-card">${townBody(data)}</div>`;
  }

  hideTown() {
    this.town = null;
    const element = this.part("town");
    if (!element) return;
    element.hidden = true;
    element.innerHTML = "";
  }

  dispose() {
    this.aborter.abort();
    this.heroObserver?.disconnect();
    this.charts.dispose();
    this.container.classList.remove("wx");
    this.container.innerHTML = "";
  }
}
