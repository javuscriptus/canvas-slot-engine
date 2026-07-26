// Твины: анимация свойств узлов по времени тикера.
// Пул переиспользуемых объектов — за спин создаётся сотня твинов,
// и мусор от них заметен на слабых устройствах.

import { Easing, Signal } from "./core.js";

class Tween {
  constructor() {
    this.reset();
  }

  reset() {
    this.target = null;
    this.props = null;
    this.from = null;
    this.duration = 0;
    this.elapsed = 0;
    this.delay = 0;
    this.ease = Easing.linear;
    this.onComplete = null;
    this.onUpdate = null;
    this.repeat = 0;
    this.yoyo = false;
    this._reversed = false;
    this.active = false;
    this.id = 0;
  }

  update(dt) {
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return false;
      dt = -this.delay;
      this.delay = 0;
    }

    this.elapsed += dt;
    const raw = this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
    const t = this._reversed ? 1 - raw : raw;
    const k = this.ease(t);

    for (const key in this.props) {
      this.target[key] = this.from[key] + (this.props[key] - this.from[key]) * k;
    }
    if (this.onUpdate) this.onUpdate(k, this.target);

    if (raw >= 1) {
      if (this.yoyo && !this._reversed) {
        this._reversed = true;
        this.elapsed = 0;
        return false;
      }
      if (this.repeat > 0) {
        this.repeat--;
        this.elapsed = 0;
        this._reversed = false;
        for (const key in this.from) this.target[key] = this.from[key];
        return false;
      }
      if (this.onComplete) this.onComplete(this.target);
      return true;
    }
    return false;
  }
}

export class TweenManager {
  constructor() {
    this.active = [];
    this._pool = [];
    this._nextId = 1;
  }

  /**
   * @param target объект со свойствами-числами
   * @param props  конечные значения
   * @param opts   {duration, delay, ease, repeat, yoyo, onComplete, onUpdate}
   * @returns {number} id — для отмены через cancel()
   */
  to(target, props, opts = {}) {
    const tw = this._pool.pop() || new Tween();
    tw.reset();
    tw.id = this._nextId++;
    tw.target = target;
    tw.props = props;
    tw.from = {};
    for (const key in props) tw.from[key] = target[key];
    tw.duration = opts.duration ?? 0.3;
    tw.delay = opts.delay ?? 0;
    tw.ease = opts.ease ?? Easing.quadOut;
    tw.repeat = opts.repeat ?? 0;
    tw.yoyo = opts.yoyo ?? false;
    tw.onComplete = opts.onComplete ?? null;
    tw.onUpdate = opts.onUpdate ?? null;
    tw.active = true;
    this.active.push(tw);
    return tw.id;
  }

  /** Тот же to(), но в виде промиса — удобно в async-последовательностях. */
  toAsync(target, props, opts = {}) {
    return new Promise((resolve) => {
      this.to(target, props, {
        ...opts,
        onComplete: (t) => {
          if (opts.onComplete) opts.onComplete(t);
          resolve();
        }
      });
    });
  }

  delay(seconds) {
    return new Promise((resolve) => {
      this.to({ v: 0 }, { v: 1 }, { duration: seconds, onComplete: resolve });
    });
  }

  cancel(id) {
    const i = this.active.findIndex((t) => t.id === id);
    if (i >= 0) {
      const tw = this.active.splice(i, 1)[0];
      tw.active = false;
      this._pool.push(tw);
    }
  }

  /** Снимает все твины конкретного объекта — например, при рестарте анимации. */
  cancelTarget(target) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].target === target) {
        const tw = this.active.splice(i, 1)[0];
        tw.active = false;
        this._pool.push(tw);
      }
    }
  }

  cancelAll() {
    for (const tw of this.active) {
      tw.active = false;
      this._pool.push(tw);
    }
    this.active.length = 0;
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const tw = this.active[i];
      if (!tw.active) continue;
      if (tw.update(dt)) {
        this.active.splice(i, 1);
        tw.active = false;
        this._pool.push(tw);
      }
    }
  }
}
