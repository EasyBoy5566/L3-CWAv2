// The globe page: layers, dates, the county panel, the sun clock and polling.
import { getJSON } from "./api.js";
import { dayLabel, escapeHtml, hhmm, num } from "./format.js";
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
};

// ---------- data ----------
async function loadMeta() {
  state.meta = await getJSON("/api/meta");
  renderFreshness($("freshness"), state.meta.freshness);
  const select = $("date");
  const dates = state.meta.dates;
  if (!state.date || !dates.includes(state.date)) state.date = dates[0] ?? null;
  select.innerHTML = dates.map((d) => `<option value="${d}" ${d === state.date ? "selected" : ""}>${dayLabel(d)}</option>`).join("");
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
function openRegion(name, { push = true, fly = true } = {}) {
  if (!name) return closeRegion({ push });
  if (state.region !== name) {
    state.view?.dispose();
    state.region = name;
    state.view = new RegionView($("panel-body"), name, { mode: "drawer" });
    state.view.load();
  }
  const panel = $("panel");
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.remove("closing"));
  $("county").value = name;
  state.globe?.select(name);
  if (fly) state.globe?.flyTo(name, { panelOpen: true });
  if (push) history.pushState({ region: name }, "", `/?region=${encodeURIComponent(name)}`);
  document.title = `${name} · 臺灣 3D 氣象`;
}

function closeRegion({ push = true } = {}) {
  const panel = $("panel");
  panel.classList.add("closing");
  setTimeout(() => { if (panel.classList.contains("closing")) panel.hidden = true; }, 300);
  state.view?.dispose();
  state.view = null;
  state.region = null;
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
  const x = Math.min(position.x + 16, stage.width - card.offsetWidth - 8);
  const y = Math.min(position.y + 16, stage.height - card.offsetHeight - 8);
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}

// ---------- fallback when WebGL or Cesium is unavailable ----------
function renderFallbackTiles() {
  const element = $("fallback");
  if (element.hidden || !state.meta) return;
  const scale = scaleFor(state.layer);
  const tiles = state.meta.counties.map(({ name }) => {
    const value = state.values[name]?.value ?? null;
    const color = value === null ? MISSING : colorAt(scale, value);
    return `<button type="button" class="tile" data-name="${escapeHtml(name)}" style="border-left: 6px solid ${color}">
      ${escapeHtml(name)}<strong>${value === null ? "—" : `${Math.round(value * 10) / 10}${scale.unit}`}</strong></button>`;
  }).join("");
  element.innerHTML = `<p class="notice">此瀏覽器無法顯示 3D 地圖，改以清單呈現。</p>${tiles}`;
}

$("fallback").addEventListener("click", (event) => {
  const tile = event.target.closest(".tile");
  if (tile) openRegion(tile.dataset.name);
});

// ---------- controls ----------
$("layers").addEventListener("click", (event) => {
  const layer = event.target.closest("button")?.dataset.layer;
  if (!layer || layer === state.layer) return;
  state.layer = layer;
  for (const button of $("layers").querySelectorAll("button")) {
    button.setAttribute("aria-checked", String(button.dataset.layer === layer));
  }
  $("date").disabled = layer === "now";
  loadLayer().catch(showError);
});

$("date").addEventListener("change", (event) => {
  state.date = event.target.value;
  loadLayer().catch(showError);
});

$("county").addEventListener("change", (event) => openRegion(event.target.value));
$("panel-close").addEventListener("click", () => closeRegion());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.region) closeRegion();
});

// The slider simulates today's sun and moon in Taipei time.
function sliderToDate(minutes) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return new Date(`${today}T${hh}:${mm}:00+08:00`);
}

function syncSliderToNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":");
  $("clock").value = Number(parts[0]) * 60 + Number(parts[1]);
  $("clock-label").textContent = "現在";
}

$("clock").addEventListener("input", (event) => {
  const date = sliderToDate(Number(event.target.value));
  $("clock-label").textContent = hhmm(date.toISOString());
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
  state.globe?.setMode2D(on);
});
$("home").addEventListener("click", () => state.globe?.flyHome());

function showError(error) {
  const element = $("freshness");
  element.insertAdjacentHTML("beforeend", `<span class="badge alert" title="${escapeHtml(error.message)}">資料載入失敗</span>`);
}

// ---------- polling ----------
async function poll() {
  if (document.hidden) return;
  try {
    const stamp = await loadMeta();
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
      onSelect: (name) => openRegion(name),
    });
  } catch (error) {
    console.error(error);
    $("globe").hidden = true;
    $("fallback").hidden = false;
    document.querySelector(".controls").querySelector("#clock").closest("section").hidden = true;
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
