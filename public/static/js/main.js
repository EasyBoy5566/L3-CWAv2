// The globe page: layers, dates, the county panel, the sun clock and polling.
import { getJSON } from "./api.js";
import { dayLabel, escapeHtml, hhmm, num } from "./format.js";
import { Segmented, prefersReducedMotion, refract, setSky } from "./glass.js";
import { createGlobe } from "./globe.js";
import { renderFreshness, renderSky } from "./header.js";
import { RegionView } from "./panel.js";
import { MISSING, colorAt, renderLegend, scaleFor } from "./scale.js";

const POLL_MS = 3 * 60 * 1000;
const $ = (id) => document.getElementById(id);

const state = {
  layer: "now",
  date: null,
  meta: null,
  values: {},
  region: null,
  view: null,
  globe: null,
  dataStamp: null,
  simulated: null, // a Date while the sun clock is dragged, else null (live)
};

// ---------- data ----------
async function loadMeta() {
  state.meta = await getJSON("/api/meta");
  renderFreshness($("freshness"), state.meta.freshness);
  const dates = state.meta.dates;
  if (!state.date || !dates.includes(state.date)) state.date = dates[0] ?? null;
  $("date").innerHTML = dates.map((d) => `<option value="${d}" ${d === state.date ? "selected" : ""}>${dayLabel(d)}</option>`).join("");
  syncStepper();
  return `${state.meta.freshness.observations.dataTime}|${state.meta.freshness.forecasts.dataTime}`;
}

async function loadLayer() {
  const query = state.layer === "now" ? "layer=now" : `layer=${state.layer}&date=${state.date ?? ""}`;
  const data = await getJSON(`/api/map?${query}`);
  state.values = data.values;
  const scale = scaleFor(state.layer);
  renderLegend($("legend"), scale);
  state.globe?.setValues(state.layer, state.values, scale);
  renderFallbackTiles();
}

// ---------- panel ----------
// The panel grows out of the point that was clicked, as a circle of glass
// widening to fill the sheet.
function revealPanel(origin) {
  const panel = $("panel");
  const opening = panel.hidden;
  panel.hidden = false;
  document.body.classList.add("panel-open");
  if (prefersReducedMotion()) return;
  if (!opening) {
    $("panel-body").classList.remove("swapping");
    void $("panel-body").offsetWidth;
    $("panel-body").classList.add("swapping");
    return;
  }
  const rect = panel.getBoundingClientRect();
  const x = origin ? origin.x - rect.left : rect.width - 40;
  const y = origin ? origin.y - rect.top : 40;
  const reach = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) + 40;
  panel.animate(
    [
      { clipPath: `circle(18px at ${x}px ${y}px)`, opacity: 0.3, transform: "scale(0.97)" },
      { clipPath: `circle(${reach}px at ${x}px ${y}px)`, opacity: 1, transform: "scale(1)" },
    ],
    { duration: 560, easing: "cubic-bezier(.2, .8, .2, 1)" },
  );
}

function hidePanel() {
  const panel = $("panel");
  document.body.classList.remove("panel-open");
  if (panel.hidden) return;
  if (prefersReducedMotion()) {
    panel.hidden = true;
    return;
  }
  const rect = panel.getBoundingClientRect();
  const animation = panel.animate(
    [
      { clipPath: `circle(${Math.hypot(rect.width, rect.height)}px at ${rect.width - 34}px 34px)`, opacity: 1 },
      { clipPath: `circle(16px at ${rect.width - 34}px 34px)`, opacity: 0 },
    ],
    { duration: 380, easing: "cubic-bezier(.4, 0, .6, 1)" },
  );
  animation.onfinish = () => { if (!state.region) panel.hidden = true; };
}

function openRegion(name, { push = true, fly = true, origin = null } = {}) {
  if (!name) return closeRegion({ push });
  if (state.region !== name) {
    state.view?.dispose();
    state.region = name;
    state.view = new RegionView($("panel-body"), name, { mode: "drawer" });
    state.view.load();
  }
  revealPanel(origin);
  $("county").value = name;
  state.globe?.select(name);
  if (fly) state.globe?.flyTo(name, { panelOpen: true });
  if (push) history.pushState({ region: name }, "", `/?region=${encodeURIComponent(name)}`);
  document.title = `${name} · 臺灣 3D 氣象`;
}

function closeRegion({ push = true } = {}) {
  state.region = null;
  hidePanel();
  state.view?.dispose();
  state.view = null;
  $("county").value = "";
  state.globe?.select(null);
  if (push) history.pushState({ region: null }, "", "/");
  document.title = "臺灣 3D 氣象";
}

window.addEventListener("popstate", () => {
  const name = new URLSearchParams(location.search).get("region");
  if (name) openRegion(name, { push: false });
  else closeRegion({ push: false });
});

// ---------- hover card ----------
function showHover(name, position) {
  const card = $("hover");
  if (!name) {
    card.hidden = true;
    return;
  }
  const entry = state.values[name];
  let body = `<div class="muted">無資料</div>`;
  if (entry && state.layer === "now") {
    body = `<div class="value">${num(entry.temperature, 1, "°C")}</div>
      <div>${escapeHtml(entry.weather ?? "")} · 濕度 ${num(entry.humidity, 0, "%")}</div>
      <div class="muted">${hhmm(entry.observedAt)} 觀測</div>`;
  } else if (entry) {
    body = `<div class="value">${entry.approx ? "約 " : ""}${num(entry.mint)}–${num(entry.maxt)}°C</div>
      <div>${escapeHtml(entry.wx ?? "")}${entry.pop === null ? "" : ` · 降雨 ${num(entry.pop)}%`}</div>
      <div class="muted">${dayLabel(state.date)} 預報</div>`;
  }
  card.innerHTML = `<strong>${escapeHtml(name)}</strong>${body}<div class="muted">點擊查看詳細</div>`;
  card.hidden = false;
  const stage = document.querySelector(".stage").getBoundingClientRect();
  card.style.left = `${Math.min(position.x + 18, stage.width - card.offsetWidth - 10)}px`;
  card.style.top = `${Math.min(position.y + 18, stage.height - card.offsetHeight - 10)}px`;
}

// ---------- fallback when WebGL or Cesium is unavailable ----------
function renderFallbackTiles() {
  const element = $("fallback");
  if (element.hidden || !state.meta) return;
  const scale = scaleFor(state.layer);
  const tiles = state.meta.counties.map(({ name }) => {
    const value = state.values[name]?.value ?? null;
    const color = value === null ? MISSING : colorAt(scale, value);
    return `<button type="button" class="tile glass" data-name="${escapeHtml(name)}" style="box-shadow: inset 4px 0 0 ${color}">
      ${escapeHtml(name)}<strong>${value === null ? "—" : `${Math.round(value * 10) / 10}${scale.unit}`}</strong></button>`;
  }).join("");
  element.innerHTML = `<p class="notice">此瀏覽器無法顯示 3D 地圖，改以清單呈現。</p>${tiles}`;
}

$("fallback").addEventListener("click", (event) => {
  const tile = event.target.closest(".tile");
  if (tile) openRegion(tile.dataset.name, { origin: { x: event.clientX, y: event.clientY } });
});

// ---------- controls ----------
new Segmented($("layers"), {
  onChange: (layer) => {
    state.layer = layer;
    syncStepper();
    loadLayer().catch(showError);
  },
});

function syncStepper() {
  const select = $("date");
  const live = state.layer === "now";
  const index = [...select.options].findIndex((o) => o.value === state.date);
  select.disabled = live;
  $("date-prev").disabled = live || index <= 0;
  $("date-next").disabled = live || index < 0 || index >= select.options.length - 1;
  $("stepper").title = live ? "即時圖層不需選擇日期" : "";
}

function stepDate(delta) {
  const options = [...$("date").options];
  const index = options.findIndex((o) => o.value === state.date) + delta;
  if (index < 0 || index >= options.length) return;
  state.date = options[index].value;
  $("date").value = state.date;
  syncStepper();
  loadLayer().catch(showError);
}

$("date").addEventListener("change", (event) => {
  state.date = event.target.value;
  syncStepper();
  loadLayer().catch(showError);
});
$("date-prev").addEventListener("click", () => stepDate(-1));
$("date-next").addEventListener("click", () => stepDate(1));

$("county").addEventListener("change", (event) => openRegion(event.target.value));
$("panel-close").addEventListener("click", () => closeRegion());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.region) closeRegion();
});

// The slider simulates today's sun and moon in Taipei time, and the glass
// follows: clearer by day, warmer at dusk, deeper at night.
function sliderToDate(minutes) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return new Date(`${today}T${hh}:${mm}:00+08:00`);
}

function applySky(date) {
  const sky = setSky(date);
  $("clock-icon").textContent = sky === "day" ? "☀" : sky === "dusk" ? "◒" : "☾";
}

function syncSliderToNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":");
  $("clock").value = Number(parts[0]) * 60 + Number(parts[1]);
  $("clock-label").textContent = "現在";
  $("clock-now").hidden = true;
  state.simulated = null;
  applySky(new Date());
}

$("clock").addEventListener("input", (event) => {
  const date = sliderToDate(Number(event.target.value));
  state.simulated = date;
  $("clock-label").textContent = hhmm(date.toISOString());
  $("clock-now").hidden = false;
  applySky(date);
  state.globe?.setTime(date);
});
$("clock-now").addEventListener("click", () => {
  syncSliderToNow();
  state.globe?.setTime(null);
});
$("shadows").addEventListener("click", (event) => {
  const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(on));
  state.globe?.setShadows(on);
});
$("mode").addEventListener("click", (event) => {
  const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(on));
  event.currentTarget.textContent = on ? "3D" : "2D";
  event.currentTarget.setAttribute("aria-label", on ? "3D 檢視" : "2D 檢視");
  state.globe?.setMode2D(on);
});
$("home").addEventListener("click", () => state.globe?.flyHome());

function showError(error) {
  const element = $("freshness");
  element.querySelector(".load-error")?.remove();
  element.insertAdjacentHTML("beforeend", `<span class="badge alert load-error" title="${escapeHtml(error.message)}">資料載入失敗：${escapeHtml(error.message)}</span>`);
}

// ---------- polling ----------
async function poll() {
  if (document.hidden) return;
  if (!state.simulated) applySky(new Date());
  try {
    const stamp = await loadMeta();
    $("freshness").querySelector(".load-error")?.remove();
    if (stamp !== state.dataStamp) {
      state.dataStamp = stamp;
      await loadLayer();
      await state.view?.refresh();
    }
  } catch (error) {
    showError(error);
  }
}

// ---------- start ----------
async function start() {
  syncSliderToNow();
  refract();
  renderSky($("sky"));
  try {
    state.dataStamp = await loadMeta();
  } catch (error) {
    showError(error);
  }

  const token = document.body.dataset.cesiumToken;
  try {
    if (!window.Cesium) throw new Error("Cesium 載入失敗");
    state.globe = await createGlobe($("globe"), {
      token,
      counties: state.meta?.counties ?? [],
      onHover: showHover,
      onSelect: (name, position) => openRegion(name, { origin: position }),
    });
    document.querySelector(".credit").hidden = true;
  } catch (error) {
    console.error(error);
    $("globe").hidden = true;
    $("fallback").hidden = false;
    document.querySelector(".clock").hidden = true;
  }

  try {
    await loadLayer();
  } catch (error) {
    showError(error);
  }

  const initial = new URLSearchParams(location.search).get("region");
  if (initial) openRegion(initial, { push: false });

  await (state.globe?.ready ?? Promise.resolve());
  $("loading").classList.add("done");

  setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
}

start();
