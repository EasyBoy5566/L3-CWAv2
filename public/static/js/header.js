// The top bar: today's sun and moon, and how fresh the data is.
import { getJSON } from "./api.js";
import { ago, escapeHtml, hhmm, moonPhase, todayInTaipei } from "./format.js";

export async function renderSky(element, county = "臺北市") {
  const phase = moonPhase();
  try {
    const { times } = await getJSON(`/api/astro?county=${encodeURIComponent(county)}&date=${todayInTaipei()}`);
    if (!times) throw new Error("no data");
    element.innerHTML = `
      <span>☀ 日出 <b>${escapeHtml(times.sunrise ?? "—")}</b> 日落 <b>${escapeHtml(times.sunset ?? "—")}</b></span>
      <span>☾ ${phase.name} · 月出 <b>${escapeHtml(times.moonrise ?? "—")}</b> 月落 <b>${escapeHtml(times.moonset ?? "—")}</b></span>
      <span>${escapeHtml(county)}</span>`;
  } catch {
    element.innerHTML = `<span>☾ ${phase.name}</span>`;
  }
}

const LEVEL_TEXT = { ok: "", warn: "（延遲）", alert: "（過期）", missing: "（無資料）" };

export function renderFreshness(element, freshness) {
  const obs = freshness.observations;
  const fc = freshness.forecasts;
  element.innerHTML = `
    <span class="badge ${obs.level}" title="${escapeHtml(obs.lastError ?? "")}">觀測 ${hhmm(obs.dataTime)} · ${ago(obs.dataTime)}${LEVEL_TEXT[obs.level]}</span>
    <span class="badge ${fc.level}" title="${escapeHtml(fc.lastError ?? "")}">預報 ${hhmm(fc.dataTime)}${LEVEL_TEXT[fc.level]}</span>`;
}
