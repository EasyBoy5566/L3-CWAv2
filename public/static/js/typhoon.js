// The typhoon card, kept to three rows: the cyclone, four numbers (how close
// its gale circle is to Taiwan, wind, pressure, movement), and a timeline that
// walks a marker along its analysed track and its forecast. Everything else is
// in the hover card of each track point on the map.
import { beaufortLevel, cycloneClass, directionName, pointAt, timeline } from "./cyclone.js";
import { escapeHtml } from "./format.js";

const HOUR = 3600 * 1000;
const PLAY_STEP_MS = 60; // one hour of the track per frame step

const PLAY = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6l7.6-4.8z" fill="currentColor"/></svg>`;
const PAUSE = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3.2" width="2.8" height="9.6" rx="1" fill="currentColor"/><rect x="9.2" y="3.2" width="2.8" height="9.6" rx="1" fill="currentColor"/></svg>`;
// A circular arrow: back to the present.
const RETURN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4.4 1.9v2.9h2.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const num = (value, digits = 0) => (value === null || value === undefined ? "—" : Number(value).toFixed(digits));
const km = (value) => (value === null || value === undefined ? "—" : Math.round(value).toLocaleString("zh-TW"));
// A moment in Taipei time as "9/26 08:00" (with minutes, for the satellite).
const when = (ms, minutes = false) => {
  const d = new Date(ms + 8 * HOUR);
  const mm = minutes ? String(d.getUTCMinutes()).padStart(2, "0") : "00";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${mm}`;
};
const relative = (hours) => (hours === 0 ? "最新定位" : hours > 0 ? `預報 +${hours} 小時` : `${-hours} 小時前`);

export class TyphoonCard {
  constructor(root, { onClose } = {}) {
    this.root = root;
    this.onClose = onClose;
    this.globe = null;
    this.cyclones = [];
    this.index = 0;
    this.hours = 0;
    this.timer = null;
    root.addEventListener("click", (event) => this.click(event));
    root.addEventListener("input", (event) => {
      if (event.target.matches(".ty-range")) {
        this.pause();
        this.seek(Number(event.target.value));
      }
    });
  }

  /** Show the card for these cyclones (or hide it when there are none), keeping the chosen one. */
  show(cyclones) {
    this.cyclones = cyclones;
    if (!cyclones.length) {
      this.hide();
      return;
    }
    const name = this.cyclone?.name;
    this.index = Math.max(0, cyclones.findIndex((c) => c.name === name));
    this.render();
    this.root.hidden = false;
  }

  hide() {
    this.pause();
    this.globe?.scrubTyphoon(this.index, null);
    this.root.hidden = true;
  }

  /** Pick cyclone `index` (a click on it on the map). */
  focus(index) {
    if (!this.cyclones[index]) return;
    this.globe?.scrubTyphoon(this.index, null);
    this.index = index;
    this.hours = 0;
    this.render();
    this.root.hidden = false;
    const now = this.cyclone.track.at(-1);
    this.globe?.flyToTyphoon(now.lon, now.lat);
  }

  get cyclone() {
    return this.cyclones[this.index];
  }

  click(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.cyclone !== undefined) this.focus(Number(button.dataset.cyclone));
    else if (button.classList.contains("ty-play")) this.timer ? this.pause() : this.play();
    else if (button.classList.contains("ty-live")) {
      this.pause();
      this.seek(0);
    } else if (button.classList.contains("ty-close")) {
      this.hide();
      this.onClose?.();
    }
  }

  render() {
    const cyclone = this.cyclone;
    this.line = timeline(cyclone);
    this.hours = Math.min(Math.max(this.hours, this.line.first), this.line.last);
    const { first, last } = this.line;
    const span = last - first || 1;
    const at = (hours) => `${(((hours - first) / span) * 100).toFixed(2)}%`;
    // Past track solid, forecast lighter; a tick for every fix and forecast point.
    const track = `linear-gradient(90deg, rgba(255,255,255,.55) 0 ${at(0)}, rgba(255,255,255,.18) ${at(0)} 100%)`;
    const ticks = this.line.points.map((p) =>
      `<i class="${p.forecast ? "f" : ""}" style="left:${at(p.hours)};--c:${cycloneClass(p.wind).color}"></i>`).join("");
    const tabs = this.cyclones.length > 1
      ? `<div class="ty-tabs">${this.cyclones.map((c, i) =>
        `<button type="button" class="chip${i === this.index ? " on" : ""}" data-cyclone="${i}">${escapeHtml(c.name ?? "")}</button>`).join("")}</div>`
      : "";
    const cloud = this.globe?.typhoonCloudTime?.();
    const sub = [cyclone.nameEn, cyclone.number ? `第 ${cyclone.number} 號` : null, cloud ? `雲圖 ${when(Date.parse(cloud), true)}` : null]
      .filter(Boolean).map(escapeHtml).join(" · ");
    this.root.innerHTML = `
      <div class="ty-head">
        <svg class="ty-symbol" viewBox="-32 -32 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><circle r="10"/><path d="M0 -10Q19 -10 25 -25M0 10Q-19 10 -25 25"/></g></svg>
        <div class="ty-title">
          <div><b>${escapeHtml(cyclone.name ?? "")}</b><span class="ty-class"></span></div>
          <span>${sub}</span>
        </div>
        ${tabs}
        <button type="button" class="icon-btn ty-close" aria-label="關閉颱風路徑" title="關閉颱風路徑">×</button>
      </div>
      <div class="ty-stats"></div>
      <div class="ty-time">
        <button type="button" class="ty-play" aria-label="播放颱風路徑" title="播放颱風路徑">${PLAY}</button>
        <div class="ty-scale">
          <input class="ty-range" type="range" min="${first}" max="${last}" step="1" value="${this.hours}" aria-label="颱風路徑時間" style="--track:${track}">
          <div class="ty-ticks">${ticks}<b class="ty-now-mark" style="left:${at(0)}">現在</b></div>
        </div>
        <output class="ty-when"></output>
        <button type="button" class="now-btn ty-live"></button>
      </div>`;
    this.seek(this.hours);
  }

  // Everything that follows the slider: the numbers, the distance, the marker.
  seek(hours) {
    this.hours = hours;
    const p = pointAt(this.line, hours);
    const cls = cycloneClass(p.wind);
    const $ = (selector) => this.root.querySelector(selector);
    this.root.style.setProperty("--ty", cls.color);
    $(".ty-range").value = String(hours);
    $(".ty-class").textContent = cls.name;
    $(".ty-when").innerHTML = `<b>${when(p.at ?? this.line.now + hours * HOUR)}</b><span>${relative(hours)}</span>`;
    // At the latest fix the button is a live marker; anywhere else it brings you back.
    // Rewritten only when it switches: a fresh icon under the pointer would
    // restart its hover spin on every step of playback.
    const live = $(".ty-live");
    const atNow = hours === 0;
    if (live.dataset.state !== String(atNow)) {
      live.dataset.state = String(atNow);
      live.classList.toggle("is-live", atNow);
      live.disabled = atNow;
      live.innerHTML = atNow ? "<i></i>現在" : `${RETURN}回到現在`;
      live.setAttribute("aria-label", atNow ? "目前顯示最新定位" : "回到最新定位");
    }
    const level = beaufortLevel(p.wind);
    const stat = (label, value, unit, note = "", extra = "") =>
      `<div${extra}><small>${label}</small><b>${value}${unit ? `<small>${unit}</small>` : ""}</b><em>${note}</em></div>`;
    const { gale, closest } = this.distance(p);
    $(".ty-stats").innerHTML = [
      gale === 0
        ? stat("暴風圈距臺灣", "已觸及", "", closest, ' class="ty-lead alert"')
        : stat("暴風圈距臺灣", km(gale), "km", closest, ' class="ty-lead"'),
      stat("最大風速", num(p.wind), "m/s", [level === null ? "" : `${level} 級`, p.gust ? `陣風 ${num(p.gust)}` : ""].filter(Boolean).join(" · ")),
      stat("中心氣壓", num(p.pressure), "hPa"),
      stat("移動", p.dir ? directionName(p.dir) : "—", "", p.speed ? `${num(p.speed)} km/h` : ""),
    ].join("");
    this.globe?.scrubTyphoon(this.index, hours === 0 ? null : p);
  }

  // How far the gale circle (七級風) is from Taiwan, and the forecast's closest approach.
  distance(p) {
    if (!this.globe) return { gale: null, closest: "" };
    const gale = Math.max(this.globe.distanceToTaiwan(p.lon, p.lat).km - (p.r15 ?? 0), 0);
    const future = this.line.points.filter((q) => q.forecast);
    if (!future.length) return { gale, closest: "" };
    const nearest = future
      .map((q) => ({ q, d: this.globe.distanceToTaiwan(q.lon, q.lat).km }))
      .reduce((a, b) => (b.d < a.d ? b : a));
    return { gale, closest: `最接近 ${km(nearest.d)} km · ${when(nearest.q.at).split(" ")[0]}` };
  }

  // From the latest fix or the end, playing starts at the first analysed position.
  play() {
    if (this.hours === 0 || this.hours >= this.line.last) this.seek(this.line.first);
    const button = this.root.querySelector(".ty-play");
    button.innerHTML = PAUSE;
    button.setAttribute("aria-label", "暫停");
    this.timer = setInterval(() => {
      if (this.hours >= this.line.last) {
        this.pause();
        return;
      }
      this.seek(this.hours + 1);
    }, PLAY_STEP_MS);
  }

  pause() {
    clearInterval(this.timer);
    this.timer = null;
    const button = this.root.querySelector(".ty-play");
    if (button) {
      button.innerHTML = PLAY;
      button.setAttribute("aria-label", "播放颱風路徑");
    }
  }
}
