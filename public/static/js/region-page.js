// The standalone /region?name=<縣市> page: the same view as the globe's panel.
import { getJSON } from "./api.js";
import { refract, setSky } from "./glass.js";
import { renderFreshness, renderSky } from "./header.js";
import { RegionView } from "./panel.js";

const POLL_MS = 3 * 60 * 1000;
const name = document.body.dataset.region;
const view = new RegionView(document.getElementById("region-root"), name, { mode: "page" });
let stamp = null;

async function poll() {
  if (document.hidden) return;
  setSky();
  try {
    const meta = await getJSON("/api/meta");
    renderFreshness(document.getElementById("freshness"), meta.freshness);
    const next = `${meta.freshness.observations.dataTime}|${meta.freshness.forecasts.dataTime}`;
    if (stamp && next !== stamp) await view.refresh();
    stamp = next;
  } catch {
    // The badges keep their last state; the next poll retries.
  }
}

setSky();
refract();
renderSky(document.getElementById("sky"), name);
view.load();
poll();
setInterval(poll, POLL_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
