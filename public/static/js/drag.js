// The floating cards and how they share the screen: the controls, the
// weather cards and the typhoon card.
//
// A card is picked up by its grip and follows the pointer on a spring,
// pulling against a soft resistance past the screen's edge. Let go, it goes
// to the nearest edge (the weather cards, as tall as the screen, to the left
// or right one). Cards never overlap: the card last moved, or last to grow
// (the controls unfolding, a county opening), keeps its place and the others
// step aside by the shortest way that is clear; each still remembers where
// it was put and goes back there once the room is free again; the one last
// moved or grown is on top. Every move is a spring. A double click on a grip
// sends the card home, where the page puts it. Where each was put is
// remembered in this browser.
import { prefersReducedMotion } from "./glass.js";

const MARGIN = 12; // px kept clear at the screen's sides
const BOTTOM = 16; // and at its foot, as the cards sit by default
const GAP = 12; // between two cards
const THRESHOLD = 5; // px a press moves before it is a drag rather than a click
const STRETCH = 64; // the most a card goes past an edge while held
// Springs: a held card follows closely, a let-go one settles with a little bounce.
const FOLLOW = { stiffness: 700, damping: 46 };
const SETTLE = { stiffness: 240, damping: 22 };
const SUBSTEP = 1 / 240; // seconds per integration step
const GROWTH = 24; // px a card must grow by to count as opening
const Z_TOP = 26; // the front card's z-index; the others step down from it
// Big enough screens only; a phone's cards have nowhere to go.
const roomy = matchMedia("(min-width: 720px)");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Past a limit a held card moves less and less, up to STRETCH.
const resist = (value, min, max) => {
  if (value < min) return min - STRETCH * (1 - Math.exp((value - min) / (STRETCH * 2)));
  if (value > max) return max + STRETCH * (1 - Math.exp((max - value) / (STRETCH * 2)));
  return value;
};
const topBound = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top")) || 76;
const overlaps = (a, b) => a.left < b.right + GAP / 2 && b.left < a.right + GAP / 2 && a.top < b.bottom + GAP / 2 && b.top < a.bottom + GAP / 2;
const at = (home, offset) => ({
  left: home.left + offset.x, top: home.top + offset.y,
  right: home.left + offset.x + home.width, bottom: home.top + offset.y + home.height,
  width: home.width, height: home.height,
});

class Card {
  constructor(layout, element, { key, handles, tall = false, visible = () => true, carry = null }) {
    Object.assign(this, { layout, element, handles, tall, visible, carry });
    // Offsets from the page's places; kept under a new name when those move
    // (the controls and weather cards swapped sides), so old ones are forgotten.
    this.key = `card-offset-2:${key}`;
    this.wanted = this.load(); // where it was put
    this.target = { ...this.wanted }; // where it is going
    this.pos = { ...this.wanted }; // where it is
    this.velocity = { x: 0, y: 0 };
    this.spring = SETTLE;
    this.apply();
    element.addEventListener("pointerdown", (event) => this.down(event));
    element.addEventListener("dblclick", (event) => {
      if (!event.target.closest(".grabber")) return;
      this.wanted = { x: 0, y: 0 };
      this.save();
      layout.front(this);
    });
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key));
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved;
    } catch {
      // Storage may be unavailable; the card starts at home.
    }
    return { x: 0, y: 0 };
  }

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.wanted));
    } catch {
      // Not remembered this time.
    }
  }

  apply() {
    const { x, y } = roomy.matches ? this.pos : { x: 0, y: 0 };
    this.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  /** Where the page puts the card, before any offset: layout boxes ignore transforms. */
  home() {
    const parent = this.element.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { left: parent.left + this.element.offsetLeft, top: parent.top + this.element.offsetTop, width: this.element.offsetWidth, height: this.element.offsetHeight };
  }

  shown() {
    return this.visible() && this.element.offsetWidth > 0;
  }

  // The offsets that keep a card with this home on screen.
  limits(home = this.home()) {
    const minX = MARGIN - home.left;
    const minY = topBound() - home.top;
    return {
      minX, maxX: Math.max(minX, innerWidth - MARGIN - home.left - home.width),
      minY, maxY: Math.max(minY, innerHeight - BOTTOM - home.top - home.height),
    };
  }

  /** The nearest edge: left or right for a tall card, any of the four otherwise. */
  snap(offset) {
    const { minX, maxX, minY, maxY } = this.limits();
    const x = clamp(offset.x, minX, maxX);
    const y = clamp(offset.y, minY, maxY);
    if (this.tall) return { x: x - minX <= maxX - x ? minX : maxX, y: 0 };
    const edges = [[x - minX, { x: minX, y }], [maxX - x, { x: maxX, y }], [y - minY, { x, y: minY }], [maxY - y, { x, y: maxY }]];
    return edges.reduce((a, b) => (b[0] < a[0] ? b : a))[1];
  }

  down(event) {
    if (event.button !== 0 || !roomy.matches) return;
    const handle = event.target.closest(this.handles);
    if (!handle || !this.element.contains(handle)) return;
    // A button inside the grip still works as a button.
    const control = event.target.closest("button, a, input, select, textarea");
    if (control && control !== handle) return;
    const start = { x: event.clientX, y: event.clientY, from: { ...this.pos }, moved: false };
    handle.setPointerCapture(event.pointerId);

    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        start.moved = true;
        this.element.classList.add("dragging");
        this.layout.front(this, false);
        // The weather cards fold to their headers while carried.
        if (this.carry) {
          this.carry(true);
          start.limits = null;
        }
      }
      start.limits ??= this.limits();
      const { minX, maxX, minY, maxY } = start.limits;
      this.spring = FOLLOW;
      this.layout.move(this, { x: resist(start.from.x + dx, minX, maxX), y: resist(start.from.y + dy, minY, maxY) });
      // The others make room as it passes.
      this.layout.arrangeSoon();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (!start.moved) return; // a click
      this.element.classList.remove("dragging");
      // The click that ends a drag is not a click on the grip.
      const swallow = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      handle.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => handle.removeEventListener("click", swallow, { capture: true }), 60);
      this.carry?.(false);
      this.spring = SETTLE;
      // Where it was let go, against the nearest edge; others make room.
      this.wanted = this.snap(this.target);
      this.save();
      this.layout.front(this);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }
}

export class CardLayout {
  constructor() {
    this.cards = []; // most recently moved or grown first
    this.frame = 0;
    this.pending = 0;
    this.sizes = new Map();
    this.observer = new ResizeObserver((entries) => {
      // A card that opens or unfolds keeps its place; the others step aside.
      // Only a real unfolding counts, not a line of text coming or going.
      let grew = null;
      let most = GROWTH;
      for (const entry of entries) {
        const card = this.cards.find((c) => c.element === entry.target || c.element.contains(entry.target));
        if (!card) continue;
        const size = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const growth = size - (this.sizes.get(entry.target) ?? 0);
        this.sizes.set(entry.target, size);
        if (growth >= most && !card.element.classList.contains("dragging")) [grew, most] = [card, growth];
      }
      if (grew) this.front(grew, false);
      this.arrangeSoon();
    });
    window.addEventListener("resize", () => this.arrangeSoon());
    roomy.addEventListener("change", () => this.arrangeSoon());
  }

  /** A card; `watch` are the elements whose size or showing moves it. */
  add(element, options, watch = [element]) {
    const card = new Card(this, element, options);
    this.cards.push(card);
    for (const el of watch) this.observer.observe(el);
    // The typhoon card widens when the county card closes; settle once it has.
    element.addEventListener("transitionend", (event) => { if (event.target === element) this.arrangeSoon(); });
    this.arrangeSoon();
    return card;
  }

  /** Put `card` first, so it keeps its place and is on top, and lay the rest out around it. */
  front(card, arrange = true) {
    this.cards = [card, ...this.cards.filter((c) => c !== card)];
    this.cards.forEach((c, i) => { c.element.style.zIndex = String(Z_TOP - i); });
    if (arrange) this.arrange();
  }

  arrangeSoon() {
    cancelAnimationFrame(this.pending);
    this.pending = requestAnimationFrame(() => this.arrange());
  }

  // Every card where it was put, unless an earlier card is there: then the
  // nearest clear place, found by pushing it to each side of what it meets.
  arrange() {
    if (!roomy.matches) {
      for (const card of this.cards) this.jump(card, { x: 0, y: 0 });
      return;
    }
    const placed = [];
    for (const card of this.cards) {
      const home = card.home();
      if (card.element.classList.contains("dragging")) {
        if (card.shown()) placed.push(at(home, card.target));
        continue;
      }
      const { minX, maxX, minY, maxY } = card.limits(home);
      const fit = (o) => ({ x: clamp(o.x, minX, maxX), y: card.tall ? 0 : clamp(o.y, minY, maxY) });
      const wanted = fit(card.wanted);
      if (!card.shown()) {
        this.move(card, wanted);
        continue;
      }
      const clear = (o) => !placed.some((p) => overlaps(at(home, o), p));
      let best = wanted;
      if (!clear(wanted)) {
        const distance = (o) => Math.hypot(o.x - wanted.x, o.y - wanted.y);
        // Beside each card in the way, then beside what that meets in turn.
        const around = (o) => placed.flatMap((p) => [
          { x: p.left - GAP - home.width - home.left, y: o.y },
          { x: p.right + GAP - home.left, y: o.y },
          { x: o.x, y: p.top - GAP - home.height - home.top },
          { x: o.x, y: p.bottom + GAP - home.top },
        ]).map(fit);
        const first = around(wanted);
        const options = [...first, ...first.filter((o) => !clear(o)).flatMap(around)].filter(clear);
        if (options.length) best = options.reduce((a, b) => (distance(b) < distance(a) ? b : a));
      }
      placed.push(at(home, best));
      this.move(card, best);
    }
  }

  jump(card, offset) {
    card.target = { ...offset };
    card.pos = { ...offset };
    card.velocity = { x: 0, y: 0 };
    card.apply();
  }

  /** Send a card towards `offset` on its spring. */
  move(card, offset) {
    card.target = { ...offset };
    if (prefersReducedMotion()) return this.jump(card, offset);
    if (!this.frame) {
      let last = performance.now();
      const step = (now) => {
        // Real time, in small fixed steps: a slow frame neither slows the
        // spring down nor sets it shaking.
        const elapsed = Math.min((now - last) / 1000, 0.25);
        last = now;
        const steps = Math.max(1, Math.ceil(elapsed / SUBSTEP));
        const dt = elapsed / steps;
        let moving = false;
        for (const c of this.cards) {
          if (Math.abs(c.target.x - c.pos.x) < 0.3 && Math.abs(c.target.y - c.pos.y) < 0.3 && Math.hypot(c.velocity.x, c.velocity.y) < 0.3) {
            if (c.pos.x !== c.target.x || c.pos.y !== c.target.y) this.jump(c, c.target);
            continue;
          }
          moving = true;
          const { stiffness, damping } = c.spring;
          for (let k = 0; k < steps; k++) {
            c.velocity.x += (stiffness * (c.target.x - c.pos.x) - damping * c.velocity.x) * dt;
            c.velocity.y += (stiffness * (c.target.y - c.pos.y) - damping * c.velocity.y) * dt;
            c.pos.x += c.velocity.x * dt;
            c.pos.y += c.velocity.y * dt;
          }
          c.apply();
        }
        this.frame = moving ? requestAnimationFrame(step) : 0;
      };
      this.frame = requestAnimationFrame(step);
    }
  }
}
