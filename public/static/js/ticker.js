// The top bar's weather ticker: one alert at a time from /api/alerts, CWA's
// own warnings first, rotating every few seconds; paused while the pointer
// or keyboard is on it. Clicking an alert takes you to it.
import { escapeHtml } from "./format.js";

const ROTATE_MS = 6000;
// CWA's alert colours, and ours by level for the derived ones.
const COLORS = { 黃色: "#facc15", 橙色: "#fb923c", 紅色: "#ef4444" };
const BY_LEVEL = ["rgba(226, 232, 240, 0.7)", "#7dd3fc", "#fb923c", "#ef4444"];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

export class Ticker {
  constructor(root, { onPick } = {}) {
    this.root = root;
    this.onPick = onPick;
    this.alerts = [];
    this.index = 0;
    this.timer = 0;
    this.paused = false;
    root.innerHTML = `
      <button type="button" class="ticker-item" aria-live="polite"></button>`;
    this.item = root.querySelector(".ticker-item");
    this.item.addEventListener("click", () => {
      const alert = this.alerts[this.index];
      if (alert) this.onPick?.(alert);
    });
    const pause = (on) => {
      this.paused = on;
      if (!on) this.schedule();
    };
    root.addEventListener("pointerenter", () => pause(true));
    root.addEventListener("pointerleave", () => pause(false));
    root.addEventListener("focusin", () => pause(true));
    root.addEventListener("focusout", () => pause(false));
  }

  /** New alerts from the server; keeps showing the same one if it is still there. */
  set(alerts) {
    const current = this.alerts[this.index]?.id;
    this.alerts = alerts;
    const kept = alerts.findIndex((a) => a.id === current);
    this.index = kept >= 0 ? kept : 0;
    this.show(false);
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.alerts.length < 2) return;
    this.timer = setTimeout(() => {
      if (this.paused || document.hidden) return this.schedule();
      this.index = (this.index + 1) % this.alerts.length;
      this.show(true);
      this.schedule();
    }, ROTATE_MS);
  }

  show(animate) {
    const alert = this.alerts[this.index];
    const color = COLORS[alert?.color] ?? BY_LEVEL[alert?.level ?? 0] ?? BY_LEVEL[0];
    const html = alert
      // The sentence names the alert; the dot's colour is its level (CWA's own colour for its alerts).
      ? `<i class="ticker-mark" style="--mark:${color}"></i><span class="ticker-text">${escapeHtml(alert.text)}</span>`
      : `<i class="ticker-mark"></i><span class="ticker-text">目前沒有特別的天氣提醒</span>`;
    this.item.title = alert ? [alert.text, alert.detail].filter(Boolean).join("\n") : "";
    this.item.disabled = !alert;
    if (!animate || reducedMotion.matches) {
      this.item.innerHTML = html;
      return;
    }
    // The old line slides up and away; the new one rises in on a spring.
    const out = this.item.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-10px)" }], { duration: 220, easing: "ease-in" });
    out.finished.then(() => {
      this.item.innerHTML = html;
      this.item.animate(
        [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
        { duration: 520, easing: getComputedStyle(document.documentElement).getPropertyValue("--spring-soft").trim() || "ease-out" },
      );
    }, () => {});
  }
}
