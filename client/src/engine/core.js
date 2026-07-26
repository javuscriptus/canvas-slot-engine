// Базис движка: сигналы, тикер, математика, интерполяция.
// Ни одной зависимости — всё, что ниже, работает в любом браузере с Canvas2D.

/* ─────────────────────────────── сигналы ────────────────────────── */

export class Signal {
  constructor() {
    this._handlers = [];
  }

  add(fn, ctx = null) {
    this._handlers.push({ fn, ctx, once: false });
    return () => this.remove(fn);
  }

  once(fn, ctx = null) {
    this._handlers.push({ fn, ctx, once: true });
    return () => this.remove(fn);
  }

  remove(fn) {
    const i = this._handlers.findIndex((h) => h.fn === fn);
    if (i >= 0) this._handlers.splice(i, 1);
  }

  removeAll() {
    this._handlers.length = 0;
  }

  emit(...args) {
    // Копия списка: обработчик вправе отписаться прямо во время рассылки.
    const list = this._handlers.slice();
    for (const h of list) {
      if (h.once) this.remove(h.fn);
      h.fn.apply(h.ctx, args);
    }
  }
}

/* ─────────────────────────────── время ──────────────────────────── */

/**
 * Тикер на requestAnimationFrame.
 *
 * dt клампится сверху: если вкладку свернули на минуту, браузер отдаст
 * гигантский delta, и вся анимация «телепортируется» в конец. Ограничение
 * в 100 мс превращает такой скачок в лёгкое подтормаживание.
 */
export class Ticker {
  constructor({ maxDelta = 0.1 } = {}) {
    this.onTick = new Signal();
    this.maxDelta = maxDelta;
    this.running = false;
    this.time = 0;
    this.fps = 60;
    this._last = 0;
    this._raf = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._loop = this._loop.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _loop(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > this.maxDelta) dt = this.maxDelta;
    this.time += dt;

    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    this.onTick.emit(dt, this.time);
  }
}

/* ───────────────────────────── математика ───────────────────────── */

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

/** Кадронезависимое сглаживание: гарантирует одинаковую скорость при любом FPS. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const randRange = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Меняет диапазон значения с зажимом по краям. */
export function remap(v, inMin, inMax, outMin, outMax) {
  return lerp(outMin, outMax, clamp(inverseLerp(inMin, inMax, v), 0, 1));
}

/* ────────────────────────────── easing ──────────────────────────── */

export const Easing = {
  linear: (t) => t,

  quadIn: (t) => t * t,
  quadOut: (t) => t * (2 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  cubicIn: (t) => t * t * t,
  cubicOut: (t) => --t * t * t + 1,
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),

  quartOut: (t) => 1 - --t * t * t * t,
  quintOut: (t) => 1 + --t * t * t * t * t,

  sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
  sineOut: (t) => Math.sin((t * Math.PI) / 2),
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

  expoIn: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  expoOut: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  circOut: (t) => Math.sqrt(1 - --t * t),

  backIn: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  backOut: (t) => 1 + 2.70158 * --t * t * t + 1.70158 * t * t,

  // Пружина: используется для «доводки» барабана после остановки.
  elasticOut: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },

  bounceOut: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

/* ──────────────────────────── утилиты ───────────────────────────── */

/** Промис-пауза, привязанная к тикеру (уважает паузу игры). */
export function wait(ticker, seconds) {
  return new Promise((resolve) => {
    let left = seconds;
    const off = ticker.onTick.add((dt) => {
      left -= dt;
      if (left <= 0) {
        off();
        resolve();
      }
    });
  });
}

/** Форматирование денег: 1234.5 → "1 234.50" */
export function formatMoney(value, { decimals = 2, thousands = " " } = {}) {
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return `${neg ? "-" : ""}${grouped}${frac ? "." + frac : ""}`;
}

/** Целые числа с разделителем разрядов, без дробной части. */
export function formatInt(value, thousands = " ") {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
}
