// Система частиц с пулом. Всё летающее золото, искры и конфетти —
// отсюда. Частицы рисуются одним узлом Custom: 300 отдельных спрайтов
// в графе сцены стоили бы дороже, чем сам их рендер.

import { Node } from "./display.js";
import { randRange, randInt, clamp } from "./core.js";

class Particle {
  constructor() {
    this.active = false;
  }

  spawn(cfg) {
    this.active = true;
    this.x = cfg.x;
    this.y = cfg.y;
    this.vx = cfg.vx;
    this.vy = cfg.vy;
    this.gravity = cfg.gravity;
    this.drag = cfg.drag;
    this.life = cfg.life;
    this.maxLife = cfg.life;
    this.size = cfg.size;
    this.sizeEnd = cfg.sizeEnd;
    this.rotation = cfg.rotation;
    this.spin = cfg.spin;
    this.alpha = cfg.alpha;
    this.alphaEnd = cfg.alphaEnd;
    this.frame = cfg.frame;
    this.blend = cfg.blend;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) {
      this.active = false;
      return;
    }
    this.vy += this.gravity * dt;
    this.vx *= Math.pow(this.drag, dt * 60);
    this.vy *= Math.pow(this.drag, dt * 60);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rotation += this.spin * dt;
  }
}

export class ParticleSystem extends Node {
  constructor(capacity = 400) {
    super();
    this.pool = Array.from({ length: capacity }, () => new Particle());
    this.capacity = capacity;
    this.count = 0;
  }

  _take() {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.pool[i].active) return this.pool[i];
    }
    return null;   // пул исчерпан — молча пропускаем, ронять кадр нельзя
  }

  /**
   * @param {object} o
   *   frame        кадр спрайта
   *   x, y         точка испускания
   *   count        сколько частиц
   *   speed        [min, max] скорость
   *   angle        [min, max] радианы
   *   life         [min, max] секунды
   *   size         [min, max] размер в дизайнерских пикселях
   *   sizeEnd      множитель размера к концу жизни
   *   gravity, drag
   *   alphaEnd
   *   spin         [min, max] рад/с
   *   blend        режим наложения
   */
  emit(o) {
    const count = o.count ?? 10;
    for (let i = 0; i < count; i++) {
      const p = this._take();
      if (!p) return;
      const angle = randRange(o.angle?.[0] ?? 0, o.angle?.[1] ?? Math.PI * 2);
      const speed = randRange(o.speed?.[0] ?? 100, o.speed?.[1] ?? 300);
      const size = randRange(o.size?.[0] ?? 20, o.size?.[1] ?? 40);
      p.spawn({
        x: o.x + randRange(-(o.spread?.[0] ?? 0), o.spread?.[0] ?? 0),
        y: o.y + randRange(-(o.spread?.[1] ?? 0), o.spread?.[1] ?? 0),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 0.99,
        life: randRange(o.life?.[0] ?? 0.6, o.life?.[1] ?? 1.2),
        size,
        sizeEnd: size * (o.sizeEnd ?? 1),
        rotation: randRange(0, Math.PI * 2),
        spin: randRange(o.spin?.[0] ?? -3, o.spin?.[1] ?? 3),
        alpha: o.alpha ?? 1,
        alphaEnd: o.alphaEnd ?? 0,
        frame: o.frame,
        blend: o.blend ?? null
      });
    }
  }

  update(dt) {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (p.active) {
        p.update(dt);
        if (p.active) n++;
      }
    }
    this.count = n;
  }

  clear() {
    for (const p of this.pool) p.active = false;
    this.count = 0;
  }
}

/** Отрисовщик частиц: один Custom-узел на всю систему. */
export function drawParticles(ctx, system) {
  let currentBlend = null;
  for (let i = 0; i < system.capacity; i++) {
    const p = system.pool[i];
    if (!p.active || !p.frame) continue;

    const t = 1 - p.life / p.maxLife;
    const size = p.size + (p.sizeEnd - p.size) * t;
    const alpha = p.alpha + (p.alphaEnd - p.alpha) * t;
    if (alpha <= 0.002) continue;

    if (p.blend !== currentBlend) {
      ctx.globalCompositeOperation = p.blend || "source-over";
      currentBlend = p.blend;
    }

    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.rotation) ctx.rotate(p.rotation);
    ctx.drawImage(p.frame.image, p.frame.x, p.frame.y, p.frame.w, p.frame.h,
      -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

/* ─────────────────────── готовые «рецепты» ──────────────────────── */

export const Bursts = {
  /** Искры при появлении выигрышного символа. */
  winSpark(sys, frame, x, y, scale = 1) {
    sys.emit({
      frame, x, y, count: 14,
      speed: [90 * scale, 260 * scale],
      life: [0.35, 0.75],
      size: [14 * scale, 34 * scale],
      sizeEnd: 0.2,
      gravity: 120,
      drag: 0.94,
      blend: "lighter"
    });
  },

  /** Фонтан монет для крупного выигрыша. */
  coinFountain(sys, frame, x, y, count = 30) {
    sys.emit({
      frame, x, y, count,
      spread: [220, 20],
      angle: [-Math.PI * 0.85, -Math.PI * 0.15],
      speed: [520, 1000],
      life: [1.1, 1.9],
      size: [34, 62],
      sizeEnd: 0.9,
      gravity: 1500,
      drag: 0.995,
      spin: [-7, 7],
      alphaEnd: 0.85
    });
  },

  /** Пыль золота, оседающая после остановки барабана. */
  reelDust(sys, frame, x, y) {
    sys.emit({
      frame, x, y, count: 6,
      spread: [90, 6],
      angle: [-Math.PI * 0.75, -Math.PI * 0.25],
      speed: [60, 170],
      life: [0.3, 0.6],
      size: [10, 22],
      sizeEnd: 0.1,
      gravity: 420,
      blend: "lighter"
    });
  },

  /** Звёздный вихрь при запуске фриспинов. */
  starSwirl(sys, frame, x, y, count = 40) {
    sys.emit({
      frame, x, y, count,
      spread: [40, 40],
      speed: [220, 620],
      life: [0.9, 1.6],
      size: [22, 52],
      sizeEnd: 0.15,
      gravity: -60,
      drag: 0.97,
      spin: [-5, 5],
      blend: "lighter"
    });
  }
};
