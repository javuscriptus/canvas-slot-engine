// Система частиц с пулом. Всё летающее золото, искры и конфетти —
// отсюда. Частицы рисуются ОДНИМ узлом сцены: триста отдельных спрайтов
// в графе стоили бы дороже, чем сам их рендер.
//
// Здесь нет ни одного игрового рецепта: движок умеет испускать частицы,
// а что именно должно сыпаться при крупном выигрыше — знает тема.

import { Node } from "./display.js";
import { NodeType } from "./render/drawables.js";
import { randRange } from "./core.js";

class Particle {
  constructor() {
    this.active = false;
    this.slot = -1;      // место в плотном списке активных: удаление за O(1)
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

/**
 * Пул фиксированной ёмкости с двумя списками: свободные и активные.
 *
 * Раньше и выдача слота, и обновление, и отрисовка шли перебором всей
 * ёмкости. При пуле в 360 частиц и десятке живых это тысяча с лишним
 * холостых проверок за кадр — и ровно в тот момент, когда на экране
 * баннер крупного выигрыша и запас производительности уже потрачен.
 */
export class ParticleSystem extends Node {
  constructor(capacity = 400) {
    super();
    this.nodeType = NodeType.PARTICLES;
    this.capacity = capacity;
    this.pool = Array.from({ length: capacity }, () => new Particle());
    this.free = this.pool.slice();
    this.active = [];
    this.width = 0;
    this.height = 0;
  }

  get count() {
    return this.active.length;
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    return this;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
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
   *   alpha, alphaEnd
   *   spin         [min, max] рад/с
   *   spread       [x, y] разброс точки испускания
   *   blend        режим наложения
   */
  emit(o) {
    const count = o.count ?? 10;
    for (let i = 0; i < count; i++) {
      const p = this.free.pop();
      // Пул исчерпан — молча пропускаем: ронять кадр из-за лишней искры нельзя.
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
      p.slot = this.active.length;
      this.active.push(p);
    }
  }

  update(dt) {
    const list = this.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.update(dt);
      if (p.active) continue;
      // Обмен с хвостом вместо splice: порядок частиц никого не волнует,
      // а сдвиг массива на каждой погасшей искре — волнует.
      const last = list.pop();
      if (i < list.length) {
        list[i] = last;
        last.slot = i;
      }
      p.slot = -1;
      this.free.push(p);
    }
  }

  clear() {
    for (const p of this.active) {
      p.active = false;
      p.slot = -1;
      this.free.push(p);
    }
    this.active.length = 0;
  }
}

/**
 * Отрисовка всей системы на Canvas2D.
 *
 * Матрица узла уже выставлена бэкендом, поэтому частица без поворота
 * рисуется просто по своим координатам. Повёрнутой матрица досчитывается
 * вручную и ставится через setTransform: ctx.save()/restore() на каждую
 * частицу — это до трёхсот сохранений полного состояния контекста за кадр,
 * и именно они были главной статьёй расхода, а не сам drawImage.
 */
export function drawParticles(ctx, system) {
  const list = system.active;
  if (!list.length) return;

  const m = system.worldMatrix;
  const base = system.worldAlpha;
  let blend = null;
  let transformed = false;

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const f = p.frame;
    if (!f) continue;

    const t = 1 - p.life / p.maxLife;
    const alpha = (p.alpha + (p.alphaEnd - p.alpha) * t) * base;
    if (alpha <= 0.002) continue;
    const size = p.size + (p.sizeEnd - p.size) * t;

    if (p.blend !== blend) {
      ctx.globalCompositeOperation = p.blend || "source-over";
      blend = p.blend;
    }
    ctx.globalAlpha = alpha;

    if (p.rotation) {
      const c = Math.cos(p.rotation);
      const s = Math.sin(p.rotation);
      ctx.setTransform(
        c * m.a + s * m.c,
        c * m.b + s * m.d,
        -s * m.a + c * m.c,
        -s * m.b + c * m.d,
        p.x * m.a + p.y * m.c + m.tx,
        p.x * m.b + p.y * m.d + m.ty
      );
      ctx.drawImage(f.image, f.x, f.y, f.w, f.h, -size / 2, -size / 2, size, size);
      transformed = true;
    } else {
      if (transformed) {
        ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
        transformed = false;
      }
      ctx.drawImage(f.image, f.x, f.y, f.w, f.h,
        p.x - size / 2, p.y - size / 2, size, size);
    }
  }

  if (transformed) ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}
