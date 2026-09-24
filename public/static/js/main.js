// The globe page: layers, dates, the county panel, the sun clock and polling.
import { getJSON } from "./api.js";
import { loadECharts } from "./charts.js";
import { dayLabel, escapeHtml, hhmm, num } from "./format.js";
import { GlassSelect, Segmented, ensureRefraction, prefersReducedMotion, refract, revealInline, setSky, springEasing, stretchRefraction } from "./glass.js";
import { createGlobe } from "./globe.js";
import { renderFreshness } from "./header.js";
import { RegionView, townBody, townHead } from "./panel.js";
import { SECTIONS, TownData } from "./town-data.js";
import { Ticker } from "./ticker.js";
import { TyphoonCard } from "./typhoon.js";
import { MISSING, colorAt, renderLegend, scaleFor } from "./scale.js";

const POLL_MS = 3 * 60 * 1000;
const $ = (id) => document.getElementById(id);

// Both menus are drawn in glass; the hidden <select>s stay the source of truth.
const menus = {
  county: new GlassSelect($("county"), { columns: 2, placeholder: "選擇縣市…" }),
  date: new GlassSelect($("date")),
};
const townData = new TownData();
// Closing the card turns the typhoon layer off, as the switch would.
const typhoonCard = new TyphoonCard($("typhoon-card"), {
  onClose: () => {
    const input = document.querySelector('input[data-overlay="typhoon"]');
    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  },
});

const setCounty = (value) => {
  $("county").value = value;
  menus.county.sync();
};

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
  info: null, // the overlay entity under the pointer, if any
  hoverCounty: null,
  town: null, // the township whose card is open
  playTimer: null,
  simCity: "taipei",
  simulating: false,
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
  applyLayer();
}

// Values may arrive before the globe exists; it takes them when it does.
function applyLayer() {
  const scale = scaleFor(state.layer);
  renderLegend($("legend"), scale);
  state.globe?.setValues(state.layer, state.values, scale);
  renderFallbackTiles();
}

// ---------- panel ----------
// The county card springs open from nothing; picking another county while it
// is open fades the new county's weather in.
function revealPanel() {
  const opening = countyCard.hidden || Boolean(countyCard.dataset.closing);
  document.body.classList.add("panel-open");
  if (!opening) {
    if (prefersReducedMotion()) return;
    $("panel-body").classList.remove("swapping");
    void $("panel-body").offsetWidth;
    $("panel-body").classList.add("swapping");
    return;
  }
  delete countyCard.dataset.closing;
  countyCard.hidden = false;
  springHeight(countyCard, 0, "spring", 720);
}

function hidePanel() {
  document.body.classList.remove("panel-open");
  springAway(countyCard, () => Boolean(state.region));
}

const regionUrl = (county, town) => `/?${new URLSearchParams(town ? { region: county, town: town.town } : { region: county })}`;

const ALL_SECTIONS = Object.keys(SECTIONS);

function showTown(town) {
  state.town = town;
  state.globe?.select(state.region, town?.town);
  if (town) openTownCard(town);
  else closeTownCard();
}

function openRegion(name, { push = true, fly = true, origin = null, town = null } = {}) {
  if (!name) return closeRegion({ push });
  if (state.region !== name) {
    state.view?.dispose();
    state.region = name;
    $("county-peek").innerHTML = `<b>${escapeHtml(name)}</b>`;
    state.view = new RegionView($("panel-body"), name, { mode: "drawer", onSummary: countySummary });
    state.view.load();
  }
  revealPanel();
  setCounty(name);
  showTown(town);
  // A county flies in; a township is brought to the centre of the visible map,
  // keeping the height when it was clicked there.
  if (fly && !town) state.globe?.flyTo(name);
  else if (fly && town) state.globe?.flyToTown(town, { keepHeight: Boolean(origin) });
  if (push) history.pushState({}, "", regionUrl(name, town));
  document.title = `${town ? town.town + " · " : ""}${name} · 臺灣 3D 氣象`;
}

function closeRegion({ push = true } = {}) {
  state.region = null;
  hidePanel();
  state.view?.dispose();
  state.view = null;
  state.town = null;
  closeTownCard();
  setCounty("");
  state.globe?.select(null);
  if (push) history.pushState({ region: null }, "", "/");
  document.title = "臺灣 3D 氣象";
}

const townFromUrl = (county) => {
  const name = new URLSearchParams(location.search).get("town");
  return name && state.globe ? state.globe.town(county, name) : null;
};

window.addEventListener("popstate", () => {
  const name = new URLSearchParams(location.search).get("region");
  if (name) openRegion(name, { push: false, town: townFromUrl(name) });
  else closeRegion({ push: false });
});

// ---------- hover card ----------
function placeCard(card, position) {
  const stage = document.querySelector(".stage").getBoundingClientRect();
  card.style.left = `${Math.min(position.x + 18, stage.width - card.offsetWidth - 10)}px`;
  card.style.top = `${Math.min(position.y + 18, stage.height - card.offsetHeight - 10)}px`;
}

// The typhoon under the pointer takes the card from the county.
function showInfo(info, position) {
  state.info = info;
  const card = $("hover");
  if (!info) {
    if (!state.hoverCounty) card.hidden = true;
    return;
  }
  const rows = info.lines.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`).join("");
  card.innerHTML = `<strong>${escapeHtml(info.title ?? "")}</strong><div class="muted">${escapeHtml(info.sub ?? "")}</div>
    <dl class="info-rows">${rows}</dl>`;
  card.hidden = false;
  placeCard(card, position);
}

function showHover(name, position, town = null) {
  state.hoverCounty = name;
  if (state.info) return;
  const card = $("hover");
  if (!name) {
    card.hidden = true;
    return;
  }
  const forecast = town ? townData.peekForecast(town.county, town.town) : null;
  if (town) {
    const body = forecast
      ? `<div class="value">${num(forecast.t, 0, "°C")}</div><div>${escapeHtml(forecast.wx ?? "")}${forecast.pop === null ? "" : ` · 降雨 ${num(forecast.pop)}%`}</div><div class="muted">鄉鎮逐時預報</div>`
      : "";
    card.innerHTML = `<strong>${escapeHtml(town.town)}</strong><div class="muted">${escapeHtml(name)}</div>${body}<div class="muted">點擊查看鄉鎮資料</div>`;
    card.hidden = false;
    placeCard(card, position);
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
  placeCard(card, position);
}

// ---------- map layers ----------
function setOverlayStatus(name, text, { error = false, busy = false } = {}) {
  const row = document.querySelector(`.toggle[data-overlay="${name}"]`);
  const note = row.querySelector("small");
  note.textContent = text || note.dataset.note;
  row.classList.toggle("error", error);
  row.classList.toggle("busy", busy);
}

$("overlays").addEventListener("change", async (event) => {
  const input = event.target.closest("input[data-overlay]");
  if (!input || !state.globe) return;
  const name = input.dataset.overlay;
  if (!input.checked) {
    await state.globe.setOverlay(name, false);
    setOverlayStatus(name, "");
    if (name === "typhoon") typhoonCard.hide();
    return;
  }
  // The typhoon takes the map: the county and township cards step aside.
  if (name === "typhoon" && state.region) closeRegion();
  setOverlayStatus(name, "載入中…", { busy: true });
  try {
    const status = await state.globe.setOverlay(name, true);
    if (input.checked) setOverlayStatus(name, status);
    if (input.checked && name === "typhoon") typhoonCard.show(state.globe.typhoons());
  } catch (error) {
    input.checked = false;
    setOverlayStatus(name, error.message, { error: true });
  }
});

// ---------- 3D: buildings and the shadow simulation ----------
// With 建築模型 on, the top bar's middle is the sun clock; otherwise it is
// the weather ticker. Turning the buildings off also stops the simulation
// and returns the sun to now.
function syncSimMode() {
  const on = $("buildings").checked;
  if (document.body.classList.contains("sim-mode") === on) return;
  document.body.classList.toggle("sim-mode", on);
  if (on) return;
  setPlaying(false);
  stopSimulation();
  syncSliderToNow();
  state.globe?.setTime(null);
}

$("buildings").addEventListener("change", async (event) => {
  const on = event.target.checked;
  syncSimMode();
  try {
    await state.globe?.setBuildings(on);
  } catch (error) {
    event.target.checked = false;
    syncSimMode();
    $("buildings-note").textContent = error.message;
  }
});


// North, central and south: each preset turns the buildings on and flies to a skyline.
new Segmented($("sim-cities"), {
  onChange: (city) => {
    state.simCity = city;
    showCity(city).catch(showError);
  },
});
$("sim-cities").addEventListener("click", (event) => {
  // Picking the preset already chosen flies there again.
  const button = event.target.closest("button");
  if (button?.getAttribute("aria-checked") === "true") showCity(button.dataset.value).catch(showError);
});

async function showCity(city) {
  if (!state.globe?.hasTerrain) return;
  $("buildings").checked = true;
  syncSimMode();
  if (state.region) closeRegion();
  await state.globe.showCity(city);
}

// Play starts the shadow simulation over the chosen skyline, from the long
// morning shadows; later presses pause and resume without moving the camera.
async function startSimulation() {
  if (!state.globe?.hasTerrain || state.simulating) return;
  state.simulating = true;
  $("buildings").checked = true;
  syncSimMode();
  if (state.region) closeRegion();
  await state.globe.startShadowSimulation(state.simCity);
  setClock(7 * 60);
}

function stopSimulation() {
  if (!state.simulating) return;
  state.simulating = false;
  state.globe?.stopShadowSimulation();
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

// ---------- the side cards ----------
// On the left the controls; on the right the county's weather with a
// township's under it. Every card changes height on a spring (springHeight)
// and its glass follows every frame (stretchRefraction), for the card that
// springs and for the one it pushes or squeezes: each side is a flex column.
const sideCards = () => [...document.querySelectorAll(".left-stack > .glass:not([hidden]), .right-stack > .glass:not([hidden])")];
const isHeightAnimation = (a) => a.effect?.getKeyframes?.().some((k) => "height" in k);
let following = 0;
function followCards() {
  for (const card of sideCards()) card.classList.add("morphing");
  if (following) return;
  const step = () => {
    const cards = sideCards();
    for (const card of cards) stretchRefraction(card, card.offsetHeight);
    if (cards.some((card) => card.getAnimations().some((a) => a.playState === "running" && isHeightAnimation(a)))) {
      following = requestAnimationFrame(step);
      return;
    }
    following = 0;
    for (const card of document.querySelectorAll(".left-stack > .glass, .right-stack > .glass")) {
      card.classList.remove("morphing");
      if (!card.hidden) ensureRefraction(card);
    }
  };
  following = requestAnimationFrame(step);
}
// Spring `card` from the height it had (`from`, measured before the change)
// to the height it has now.
function springHeight(card, from, easing = "spring", duration = 700) {
  for (const animation of card.getAnimations()) if (isHeightAnimation(animation)) animation.cancel();
  const to = card.offsetHeight;
  if (!prefersReducedMotion() && Math.abs(to - from) > 1) {
    card.animate(
      [{ height: `${from}px`, minHeight: "0px", overflow: "hidden" }, { height: `${to}px`, minHeight: "0px", overflow: "hidden" }],
      { duration, easing: springEasing(easing) },
    );
  }
  followCards();
}
// Shrink `card` away and hide it; `stillWanted()` is asked at the end, in
// case it was reopened meanwhile.
function springAway(card, stillWanted) {
  if (card.hidden || card.dataset.closing) return;
  card.dataset.closing = "1";
  const from = card.offsetHeight;
  for (const animation of card.getAnimations()) if (isHeightAnimation(animation)) animation.cancel();
  const done = () => {
    delete card.dataset.closing;
    if (!stillWanted()) card.hidden = true;
  };
  if (prefersReducedMotion()) return done();
  const animation = card.animate(
    [{ height: `${from}px`, minHeight: "0px", opacity: 1, overflow: "hidden" }, { height: "0px", minHeight: "0px", opacity: 0, overflow: "hidden" }],
    { duration: 300, easing: "cubic-bezier(.4, 0, .6, 1)" },
  );
  followCards();
  animation.finished.then(() => {
    done();
    animation.cancel();
  }, () => {});
}

// The right column is an accordion: the county card or the township card is
// open, the other folded to its header. A township picked opens its card
// and folds the county's; a county picked opens the county's. Resting the
// pointer on a folded card (or tapping its header) opens that one instead.
const countyCard = $("panel");
const townCard = $("town-card");
refract(townCard);
function focusCard(which) {
  const townOn = !townCard.hidden && !townCard.dataset.closing;
  const foldCounty = which === "town" && townOn;
  const foldTown = which === "county";
  if (countyCard.classList.contains("collapsed") === foldCounty && townCard.classList.contains("collapsed") === foldTown) return;
  const cards = [countyCard, townCard].filter((card) => !card.hidden && !card.dataset.closing);
  const from = new Map(cards.map((card) => [card, card.offsetHeight]));
  countyCard.classList.toggle("collapsed", foldCounty);
  townCard.classList.toggle("collapsed", foldTown);
  for (const card of cards) springHeight(card, from.get(card), "spring", 650);
}
for (const [card, which] of [[countyCard, "county"], [townCard, "town"]]) {
  let timer = 0;
  // A short rest first, so passing over it on the way elsewhere does not flip them.
  card.addEventListener("pointerenter", () => {
    if (!card.classList.contains("collapsed")) return;
    timer = setTimeout(() => focusCard(which), 160);
  });
  card.addEventListener("pointerleave", () => clearTimeout(timer));
}
$("county-peek").addEventListener("click", () => focusCard("county"));
$("town-peek").addEventListener("click", () => focusCard("town"));

// The county card's folded header, from its view.
function countySummary({ name, temperature, condition, icon }) {
  $("county-peek").innerHTML = `<b>${escapeHtml(name)}</b><span class="peek-temp">${temperature === null ? "—" : Math.round(temperature)}°</span>${icon}<span class="peek-cond">${escapeHtml(condition)}</span>`;
}

// The township card: its header at once, then its data; each change springs.
let townShown = null;
function townPeek(town, forecast = null) {
  $("town-peek").innerHTML = `<span class="scope-tag">鄉鎮</span><b>${escapeHtml(town.town)}</b>${forecast ? `<span class="peek-temp">${Math.round(forecast.t)}°</span><span class="peek-cond">${escapeHtml(forecast.wx ?? "")}</span>` : ""}`;
}
async function openTownCard(town) {
  const opening = townCard.hidden || Boolean(townCard.dataset.closing);
  const countyFrom = countyCard.hidden ? 0 : countyCard.offsetHeight;
  const townFrom = opening ? 0 : townCard.offsetHeight;
  delete townCard.dataset.closing;
  townShown = town;
  townCard.hidden = false;
  townPeek(town);
  $("town-content").innerHTML = `${townHead(town)}<div class="skeleton"></div>`;
  $("town-content").scrollTop = 0;
  countyCard.classList.add("collapsed");
  townCard.classList.remove("collapsed");
  if (!countyCard.hidden) springHeight(countyCard, countyFrom, "spring", 650);
  springHeight(townCard, townFrom, "spring", 700);
  const data = await townData.forTown(town, ALL_SECTIONS);
  if (townShown !== town) return; // another township was picked meanwhile
  townPeek(town, data.forecast?.row);
  const before = townCard.offsetHeight;
  $("town-content").innerHTML = `${townHead(town)}${townBody(data)}`;
  springHeight(townCard, before, "spring-soft", 560);
}
function closeTownCard() {
  townShown = null;
  if (townCard.hidden || townCard.dataset.closing) return;
  // The county's card opens again as the township's goes, unless the county
  // is going too (its region closed).
  if (state.region && !countyCard.hidden && !countyCard.dataset.closing && countyCard.classList.contains("collapsed")) {
    const from = countyCard.offsetHeight;
    countyCard.classList.remove("collapsed");
    springAway(townCard, () => townShown !== null);
    springHeight(countyCard, from, "spring", 650);
    return;
  }
  springAway(townCard, () => townShown !== null);
}
// Closing the township card keeps its county open.
townCard.querySelector(".town-close").addEventListener("click", () => {
  if (!state.region) return closeTownCard();
  showTown(null);
  history.pushState({}, "", regionUrl(state.region, null));
  document.title = `${state.region} · 臺灣 3D 氣象`;
});

// ---------- controls ----------
// The controls card stays folded to its header and legend, and unfolds while
// the pointer is over it (or the keyboard is in it, or one of its menus is
// open). Without hover (touch), the header opens and closes it.
const controls = document.querySelector(".controls");
const canHover = matchMedia("(hover: hover)").matches;
let closeTimer = 0;
function setControlsOpen(open) {
  if (controls.classList.contains("open") === open) return;
  // The card's height springs from the old size to the new one: opening
  // overshoots a little and settles; closing tucks in with a smaller bounce.
  const from = controls.offsetHeight;
  controls.classList.toggle("open", open);
  $("controls-peek").setAttribute("aria-expanded", String(open));
  $("controls-body").inert = !open;
  springHeight(controls, from, open ? "spring" : "spring-soft", open ? 700 : 520);
}
// Kept open while a keyboard user is in it or one of its menus is open (a
// menu sits on <body>, so the pointer leaves the card to use it).
const controlsBusy = () => Boolean(controls.querySelector(":focus-visible, .gselect.open"));
function closeControlsSoon() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => (controlsBusy() ? closeControlsSoon() : setControlsOpen(false)), 350);
}
if (canHover) {
  controls.addEventListener("pointerenter", () => {
    clearTimeout(closeTimer);
    setControlsOpen(true);
  });
  controls.addEventListener("pointerleave", closeControlsSoon);
}
controls.addEventListener("focusin", () => {
  if (controls.querySelector(":focus-visible")) setControlsOpen(true);
});
controls.addEventListener("focusout", (event) => {
  if (!controls.contains(event.relatedTarget)) closeControlsSoon();
});
$("controls-peek").addEventListener("click", () => setControlsOpen(canHover || !controls.classList.contains("open")));
document.addEventListener("pointerdown", (event) => {
  if (canHover || !controls.classList.contains("open")) return;
  if (!controls.contains(event.target) && !event.target.closest?.(".gselect-menu")) setControlsOpen(false);
});

new Segmented($("layers"), {
  onChange: (layer, button) => {
    $("peek-layer").textContent = button.textContent;
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
  menus.date.sync();
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
// Move the sun clock to a minute of the day, as if the slider were dragged.
function setClock(minutes) {
  const slider = $("clock");
  slider.value = String(minutes);
  slider.dispatchEvent(new Event("input"));
}

// Playing sweeps the sun across the day, ten minutes a step, and loops.
function setPlaying(on) {
  clearInterval(state.playTimer);
  state.playTimer = null;
  $("clock-play").setAttribute("aria-pressed", String(on));
  $("clock-play").textContent = on ? "❚❚" : "▶";
  $("clock-play").setAttribute("aria-label", on ? "暫停" : "播放一天的日照");
  if (!on) return;
  state.playTimer = setInterval(() => {
    const next = Number($("clock").value) + 10;
    setClock(next > 1439 ? 0 : next);
  }, 90);
}

$("clock-play").addEventListener("click", async () => {
  const on = $("clock-play").getAttribute("aria-pressed") !== "true";
  if (on) await startSimulation().catch(showError);
  setPlaying(on);
});

function sliderToDate(minutes) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return new Date(`${today}T${hh}:${mm}:00+08:00`);
}

function applySky(date) {
  const sky = setSky(date);
  state.globe?.setSky(sky);
  $("clock-icon").textContent = sky === "day" ? "☀" : sky === "dusk" ? "◒" : "☾";
}

function syncSliderToNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":");
  $("clock").value = Number(parts[0]) * 60 + Number(parts[1]);
  $("clock-label").textContent = "現在";
  revealInline($("clock-now"), false);
  state.simulated = null;
  applySky(new Date());
}

$("clock").addEventListener("input", (event) => {
  const date = sliderToDate(Number(event.target.value));
  state.simulated = date;
  $("clock-label").textContent = hhmm(date.toISOString());
  revealInline($("clock-now"), true);
  applySky(date);
  state.globe?.setTime(date);
});
$("clock-now").addEventListener("click", () => {
  setPlaying(false);
  stopSimulation();
  syncSliderToNow();
  state.globe?.setTime(null);
});
// The button offers the other mode. The globe reports every switch, including
// the ones it makes itself (a building preset returns to 3D).
function syncModeButton(on) {
  const button = $("mode");
  button.setAttribute("aria-pressed", String(on));
  button.textContent = on ? "3D" : "2D";
  button.setAttribute("aria-label", on ? "切換到 3D" : "切換到 2D");
}

$("mode").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!state.globe || button.disabled) return;
  const on = button.getAttribute("aria-pressed") !== "true";
  button.disabled = true; // waits out the dissolve
  try {
    await state.globe.setMode2D(on);
  } finally {
    button.disabled = false;
  }
});
$("home").addEventListener("click", () => state.globe?.flyHome());

function showError(error) {
  const element = $("freshness");
  element.querySelector(".load-error")?.remove();
  element.insertAdjacentHTML("beforeend", `<span class="badge alert load-error" title="${escapeHtml(error.message)}">資料載入失敗：${escapeHtml(error.message)}</span>`);
}

// ---------- the weather ticker ----------
const ticker = new Ticker($("ticker"), {
  onPick: (alert) => {
    if (alert.category === "typhoon") {
      const input = document.querySelector('input[data-overlay="typhoon"]');
      if (!input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    if (alert.counties?.length) openRegion(alert.counties[0]);
  },
});
async function loadAlerts() {
  try {
    ticker.set((await getJSON("/api/alerts")).alerts);
  } catch {
    // Keeps the last alerts; the next poll retries.
  }
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
    loadAlerts();
    if (state.globe) {
      const statuses = await state.globe.refreshOverlays();
      for (const [name, status] of Object.entries(statuses)) setOverlayStatus(name, status);
      if ("typhoon" in statuses) typhoonCard.show(state.globe.typhoons());
    }
  } catch (error) {
    showError(error);
  }
}

// ---------- start ----------
// Nothing on the way to the first view waits on anything else: the data
// requests, the county geometry and Cesium all start together, and what is
// needed only later (township lines, the township forecast, the chart
// library) follows once the map is on screen.
async function start() {
  syncSliderToNow();
  refract();
  loadAlerts();
  const metaLoaded = loadMeta().then((stamp) => {
    state.dataStamp = stamp;
    renderFallbackTiles();
  }).catch(showError);
  const layerLoaded = loadLayer().catch(showError);

  const token = document.body.dataset.cesiumToken;
  try {
    if (!window.Cesium) throw new Error("Cesium 載入失敗");
    state.globe = await createGlobe($("globe"), {
      token,
      counties: JSON.parse($("county-points").textContent),
      onHover: showHover,
      onInfo: showInfo,
      onSelect: (name, position, town) => openRegion(name, { origin: position, town }),
      onMode: syncModeButton,
      onTyphoon: (index) => typhoonCard.focus(index),
    });
    typhoonCard.globe = state.globe;
    document.querySelector(".credit").hidden = true;
    state.globe.setSky(document.body.dataset.sky);
    if (!state.globe.hasTerrain) {
      $("buildings").disabled = true;
      $("buildings-note").textContent = "需要 Cesium ion token";
      for (const button of $("sim-cities").querySelectorAll("button")) button.disabled = true;
    }
  } catch (error) {
    console.error(error);
    $("globe").hidden = true;
    $("fallback").hidden = false;
    document.querySelector(".topbar .tools").hidden = true;
  }

  applyLayer();

  const initial = new URLSearchParams(location.search).get("region");
  if (initial) {
    openRegion(initial, { push: false });
    // A township link opens the county at once and the township when its geometry is in.
    if (new URLSearchParams(location.search).get("town")) {
      state.globe?.townsReady.then(() => {
        const town = townFromUrl(initial);
        if (town && state.region === initial) openRegion(initial, { push: false, town });
      });
    }
  }

  await (state.globe?.ready ?? Promise.resolve());
  $("loading").classList.add("done");
  await Promise.all([metaLoaded, layerLoaded]);

  // After the first view: the township forecast (for hovering townships) and the chart library.
  townData.load("townships").catch(() => {});
  (window.requestIdleCallback ?? setTimeout)(() => loadECharts().catch(() => {}));

  setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
}

start();
