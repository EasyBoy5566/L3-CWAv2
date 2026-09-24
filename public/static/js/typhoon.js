// The typhoon card: what the cyclone is now, how far it is from Taiwan, and a
// timeline that walks a marker along its analysed track and its forecast.
import { beaufortLevel, cycloneClass, directionName, pointAt, timeline } from "./cyclone.js";
import { escapeHtml } from "./format.js";

const HOUR = 3600 * 1000;
const PLAY_STEP_MS = 60; // one hour of the track per frame step

const num = (value, digits = 0) => (value === null || value === undefined ? "—" : Number(value).toFixed(digits));
const km = (value) => (value === null || value === undefined ? "—" : Math.round(value).toLocaleString("zh-TW"));
// A moment in Taipei time as "9/26 08:00".
const when = (ms) => {
  const d = new Date(ms + 8 * HOUR);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
};
const relative = (hours) => (hours === 0 ? "現在" : hours > 0 ? `預報 +${hours} 小時` : `${-hours} 小時前`);

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
    else if (button.classList.contains("ty-now")) {
      this.pause();
      this.seek(0);
    } else if (button.classList.contains("ty-locate")) {
      const p = pointAt(this.line, this.hours);
      this.globe?.flyToTyphoon(p.lon, p.lat);
    } else if (button.classList.contains("ty-frame")) this.globe?.frameTyphoon(this.index);
    else if (button.classList.contains("ty-close")) {
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
    this.root.innerHTML = `
      <div class="ty-head">
        <svg class="ty-symbol" viewBox="-32 -32 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><circle r="10"/><path d="M0 -10Q19 -10 25 -25M0 10Q-19 10 -25 25"/></g></svg>
        <div class="ty-title"><b>${escapeHtml(cyclone.name ?? "")}</b><span>${escapeHtml(cyclone.nameEn ?? "")}${cyclone.number ? ` · 第 ${escapeHtml(cyclone.number)} 號` : ""}</span></div>
        <span class="ty-class"></span>
        ${tabs}
        <button type="button" class="icon-btn ty-close" aria-label="關閉颱風路徑" title="關閉颱風路徑">×</button>
      </div>
      <div class="ty-stats"></div>
      <p class="ty-near"></p>
      <div class="ty-time">
        <button type="button" class="icon-btn ty-play" aria-label="播放颱風路徑" title="播放颱風路徑">▶</button>
        <div class="ty-scale">
          <input class="ty-range" type="range" min="${first}" max="${last}" step="1" value="${this.hours}" aria-label="颱風路徑時間" style="--track:${track}">
          <div class="ty-ticks">${ticks}<b class="ty-now-mark" style="left:${at(0)}">現在</b></div>
        </div>
        <output class="ty-when"></output>
      </div>
      <div class="ty-actions">
        <button type="button" class="chip ty-now">回到現在</button>
        <button type="button" class="chip ty-locate">定位颱風</button>
        <button type="button" class="chip ty-frame">臺灣與颱風</button>
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
    $(".ty-now").disabled = hours === 0;
    const level = beaufortLevel(p.wind);
    const gustLevel = beaufortLevel(p.gust);
    const stat = (label, value, unit, note = "") =>
      `<div><small>${label}</small><b>${value}${unit ? `<small>${unit}</small>` : ""}</b>${note ? `<em>${note}</em>` : ""}</div>`;
    $(".ty-stats").innerHTML = [
      stat("中心氣壓", num(p.pressure), "hPa"),
      stat("最大風速", num(p.wind), "m/s", level === null ? "" : `${level} 級`),
      stat("瞬間陣風", num(p.gust), "m/s", gustLevel === null ? "" : `${gustLevel} 級`),
      stat("七級風暴半徑", num(p.r15), "km", p.r25 ? `十級 ${num(p.r25)} km` : ""),
      stat("移動", p.dir ? `向${directionName(p.dir)}` : "—", "", p.speed ? `${num(p.speed)} km/h` : ""),
    ].join("");
    $(".ty-near").innerHTML = this.nearText(p);
    this.globe?.scrubTyphoon(this.index, hours === 0 ? null : p);
  }

  // How far the centre and the gale circle are from Taiwan, and the closest forecast approach.
  nearText(p) {
    if (!this.globe) return "";
    const here = this.globe.distanceToTaiwan(p.lon, p.lat);
    const gale = Math.max(here.km - (p.r15 ?? 0), 0);
    const parts = [gale === 0
      ? `<b class="alert">七級風暴圈已觸及臺灣</b>`
      : `七級風暴圈距臺灣約 <b>${km(gale)}</b> km`];
    parts.push(`中心距${escapeHtml(here.county ?? "臺灣")} ${km(here.km)} km`);
    const future = this.line.points.filter((q) => q.forecast);
    if (future.length) {
      const closest = future
        .map((q) => ({ q, d: this.globe.distanceToTaiwan(q.lon, q.lat).km }))
        .reduce((a, b) => (b.d < a.d ? b : a));
      parts.push(`預測最接近：${when(closest.q.at)}（+${closest.q.hours}h）約 <b>${km(closest.d)}</b> km`);
    }
    return parts.map((part) => `<span>${part}</span>`).join('<span class="sep">·</span>');
  }

  // From "now" or the end, playing starts at the first analysed position.
  play() {
    if (this.hours === 0 || this.hours >= this.line.last) this.seek(this.line.first);
    const button = this.root.querySelector(".ty-play");
    button.textContent = "❚❚";
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
      button.textContent = "▶";
      button.setAttribute("aria-label", "播放颱風路徑");
    }
  }
}
