// The top bar's data status: one capsule saying whether the data is current,
// with the observation and forecast times in its tooltip.
import { ago, escapeHtml, hhmm } from "./format.js";

const SEVERITY = { ok: 0, warn: 1, missing: 2, alert: 2 };
const LABEL = { ok: "資料即時", warn: "資料延遲", missing: "資料異常", alert: "資料異常" };

export function renderFreshness(element, freshness) {
  const obs = freshness.observations;
  const fc = freshness.forecasts;
  const level = SEVERITY[obs.level] >= SEVERITY[fc.level] ? obs.level : fc.level;
  const detail = [
    `觀測 ${hhmm(obs.dataTime)}（${ago(obs.dataTime)}）`,
    `預報 ${hhmm(fc.dataTime)} 取得`,
    obs.lastError ? `觀測錯誤：${obs.lastError}` : "",
    fc.lastError ? `預報錯誤：${fc.lastError}` : "",
  ].filter(Boolean).join("\n");
  element.innerHTML = `<span class="badge ${level}" title="${escapeHtml(detail)}">${LABEL[level]}</span>`;
}
