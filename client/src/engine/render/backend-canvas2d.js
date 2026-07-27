// Бэкенд Canvas2D: единственное место в движке, где вызывается ctx.
//
// Он реализует контракт, описанный в renderer.js, и регистрирует
// отрисовщики всех базовых типов узлов. WebGL2 встанет рядом тем же
// набором методов и своим набором register(): ни граф сцены, ни игровой
// слой о смене бэкенда не узнают.
//
// Принципы, от которых зависит производительность:
//   • ctx.shadowBlur — никогда: свечение приходит готовым спрайтом;
//   • save/restore только там, где реально меняется состояние (клип, blend);
//   • текст кешируется в offscreen-canvas и выводится как картинка;
//   • текстуры готовятся под фактический размер на экране заранее.

import { NodeType, register } from "./drawables.js";
import { TextureCache } from "../texture.js";
import { clamp } from "../core.js";
import { drawParticles } from "../particles.js";

export class Canvas2DBackend {
  static id = "canvas2d";

  static isSupported(canvas) {
    return !!(canvas && canvas.getContext && canvas.getContext("2d"));
  }

  constructor(canvas, { transparent = false, backgroundColor = null, textureBudget } = {}) {
    this.id = Canvas2DBackend.id;
    this.canvas = canvas;
    this.transparent = transparent;
    this.backgroundColor = backgroundColor;
    // desynchronized намеренно не включён: он снижает задержку, но на части
    // конфигураций даёт разрывы кадра и заметное мерцание.
    this.ctx = canvas.getContext("2d", { alpha: transparent });

    // Кеш текстур, подготовленных под фактический размер на экране.
    // Без него каждый спрайт пересэмплируется в каждом кадре.
    this.textures = new TextureCache(textureBudget ? { maxBytes: textureBudget } : {});
    this.drawCalls = 0;

    // Разрешение, в котором имеет смысл готовить растр текста.
    this.resolution = 1;

    this._tint = new Map();
  }

  /** Первый аргумент отрисовщиков: то, чем этот бэкенд рисует. */
  get surface() {
    return this.ctx;
  }

  /** @param resolution итоговый масштаб «дизайнерский пиксель → пиксель холста». */
  resize(_pixelWidth, _pixelHeight, resolution = 1) {
    this.resolution = resolution;
    // Размер на экране изменился — подготовленные копии больше не подходят.
    this.textures.clear();
    this._tint.clear();
  }

  begin() {
    const ctx = this.ctx;
    this.drawCalls = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.transparent || !this.backgroundColor) {
      // Фон живёт на отдельном холсте снизу либо его рисует сама сцена —
      // здесь только очищаем. Своего цвета у движка нет: цвет подложки
      // это оформление, и приходит он из темы.
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    // Текстуры уже подготовлены под нужный размер, поэтому дорогая
    // высококачественная фильтрация в кадре не нужна.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
  }

  /** Canvas2D рисует немедленно; у WebGL2 здесь уходит батч. */
  end() {}

  /**
   * Состояние узла: режим наложения и маска отсечения.
   * @returns true, если состояние сохранялось и его нужно вернуть.
   */
  pushState(node) {
    const clip = node.isContainer ? node.clip : null;
    if (!node.blendMode && !clip) return false;

    const ctx = this.ctx;
    ctx.save();
    if (node.blendMode) ctx.globalCompositeOperation = node.blendMode;
    if (clip) {
      const m = node.worldMatrix;
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width, clip.height);
      ctx.clip();
    }
    return true;
  }

  popState(pushed) {
    if (pushed) this.ctx.restore();
  }

  /** Ставит матрицу и альфу узла и передаёт управление отрисовщику типа. */
  draw(node, drawable) {
    const fn = drawable[this.id];
    if (!fn) return;
    const m = node.worldMatrix;
    const ctx = this.ctx;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    ctx.globalAlpha = node.worldAlpha;
    fn(ctx, node, this);
  }

  /**
   * Подкрашенная копия кадра. Результат кешируется — построение
   * каждый кадр убило бы производительность.
   *
   * На WebGL2 этого метода не будет вовсе: там тинт — множитель в шейдере.
   */
  tinted(frame, color) {
    const key = `${frame.image.__tintId || (frame.image.__tintId = ++TINT_IMG_ID)}:${frame.x},${frame.y},${frame.w},${frame.h}:${color}`;
    let c = this._tint.get(key);
    if (c) return c;

    c = document.createElement("canvas");
    c.width = frame.w;
    c.height = frame.h;
    const cx = c.getContext("2d");
    cx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
    cx.globalCompositeOperation = "source-atop";
    cx.fillStyle = color;
    cx.fillRect(0, 0, frame.w, frame.h);

    this._tint.set(key, c);
    return c;
  }

  destroy() {
    this.textures.clear();
    this._tint.clear();
  }
}

let TINT_IMG_ID = 0;

/* ───────────────────────── отрисовщики узлов ────────────────────── */

function drawSprite(ctx, node, backend) {
  const f = node.frame;
  if (!f || !f.image) return;
  const ox = -node.anchorX * node.width;
  const oy = -node.anchorY * node.height;

  if (node.tint) {
    const image = backend.tinted(f, node.tint);
    ctx.drawImage(image, 0, 0, f.w, f.h, ox, oy, node.width, node.height);
    backend.drawCalls++;
    return;
  }

  // Фактический размер на холсте с учётом всех родительских масштабов.
  const m = node.worldMatrix;
  const dw = node.width * Math.hypot(m.a, m.b);
  const dh = node.height * Math.hypot(m.c, m.d);
  const tex = backend.textures.get(f, dw, dh);

  ctx.drawImage(tex.image, tex.x, tex.y, tex.w, tex.h, ox, oy, node.width, node.height);
  backend.drawCalls++;
}

function drawNineSlice(ctx, node, backend) {
  const f = node.frame;
  if (!f || !f.image) return;
  const [l, t, r, b] = node.slice;
  const k = node.scaleFactor;

  const dl = l / k;
  const dt = t / k;
  const dr = r / k;
  const db = b / k;

  const W = node.width;
  const H = node.height;

  // Если рамка не влезает в заданный размер, сжимаем углы пропорционально —
  // иначе края наезжают друг на друга и картинка «ломается».
  const kx = Math.min(1, W / (dl + dr));
  const ky = Math.min(1, H / (dt + db));
  const L = dl * kx, R = dr * kx, T = dt * ky, B = db * ky;

  const srcMidW = f.w - l - r;
  const srcMidH = f.h - t - b;
  const dstMidW = Math.max(0, W - L - R);
  const dstMidH = Math.max(0, H - T - B);

  const img = f.image;
  const sx = f.x, sy = f.y;

  // углы
  ctx.drawImage(img, sx, sy, l, t, 0, 0, L, T);
  ctx.drawImage(img, sx + f.w - r, sy, r, t, W - R, 0, R, T);
  ctx.drawImage(img, sx, sy + f.h - b, l, b, 0, H - B, L, B);
  ctx.drawImage(img, sx + f.w - r, sy + f.h - b, r, b, W - R, H - B, R, B);

  // края
  if (dstMidW > 0) {
    ctx.drawImage(img, sx + l, sy, srcMidW, t, L, 0, dstMidW, T);
    ctx.drawImage(img, sx + l, sy + f.h - b, srcMidW, b, L, H - B, dstMidW, B);
  }
  if (dstMidH > 0) {
    ctx.drawImage(img, sx, sy + t, l, srcMidH, 0, T, L, dstMidH);
    ctx.drawImage(img, sx + f.w - r, sy + t, r, srcMidH, W - R, T, R, dstMidH);
  }
  // центр
  if (dstMidW > 0 && dstMidH > 0) {
    ctx.drawImage(img, sx + l, sy + t, srcMidW, srcMidH, L, T, dstMidW, dstMidH);
  }
  backend.drawCalls += 9;
}

function drawText(ctx, node, backend) {
  // Разрешение подложки текста определяется итоговым масштабом на
  // холсте, а не только devicePixelRatio: при вписывании раскладки
  // в окно (scale < 1) текст иначе рисуется крупнее нужного и потом
  // сжимается, а при scale > 1 — наоборот, мылится.
  const res = clamp(backend.resolution, 1, 3);
  if (node._dirty || Math.abs(node._dpr - res) > 0.02) node.redraw(res);
  if (!node.ready) return;

  const ox = -node.anchorX * node.width;
  const oy = -node.anchorY * node.height;
  // Буфер обычно больше занятой части — берём ровно занятую.
  ctx.drawImage(node._canvas, 0, 0, node._srcW, node._srcH, ox, oy, node.width, node.height);
  backend.drawCalls++;
}

function drawRect(ctx, node, backend) {
  ctx.beginPath();
  if (node.radius > 0) {
    roundRect(ctx, 0, 0, node.width, node.height, node.radius);
  } else {
    ctx.rect(0, 0, node.width, node.height);
  }
  if (node.fill) {
    ctx.fillStyle = paint(ctx, node.fill);
    ctx.fill();
  }
  if (node.stroke && node.strokeWidth > 0) {
    ctx.strokeStyle = paint(ctx, node.stroke);
    ctx.lineWidth = node.strokeWidth;
    ctx.stroke();
  }
  backend.drawCalls++;
}

/**
 * Цвет или градиент.
 *
 * Построенный CanvasGradient кешируется на самом описании: createLinearGradient
 * в кадре — это аллокация на каждую заливку, а описание меняется только вместе
 * с раскладкой. Отсюда требование неизменяемости: поменяли координаты —
 * положите новый объект.
 */
function paint(ctx, value) {
  if (typeof value === "string") return value;
  if (value.__grad && value.__ctx === ctx) return value.__grad;

  const g = value.type === "radial"
    ? ctx.createRadialGradient(value.x0, value.y0, value.r0, value.x1, value.y1, value.r1)
    : ctx.createLinearGradient(value.x0, value.y0, value.x1, value.y1);
  for (const [offset, color] of value.stops) g.addColorStop(offset, color);

  value.__grad = g;
  value.__ctx = ctx;
  return g;
}

const NO_DASH = [];

function drawShape(ctx, node, backend) {
  const base = node.worldAlpha;
  for (const p of node.paths) {
    const pts = p.points;
    if (!pts || pts.length < 4) continue;

    ctx.globalAlpha = base * (p.alpha ?? 1);
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (p.closed) ctx.closePath();

    if (p.fill) {
      ctx.fillStyle = paint(ctx, p.fill);
      ctx.fill();
    }
    if (p.stroke && p.strokeWidth > 0) {
      ctx.strokeStyle = paint(ctx, p.stroke);
      ctx.lineWidth = p.strokeWidth;
      ctx.lineCap = p.cap || "butt";
      ctx.lineJoin = p.join || "miter";
      ctx.setLineDash(p.dash || NO_DASH);
      ctx.lineDashOffset = p.dashOffset || 0;
      ctx.stroke();
    }
    backend.drawCalls++;
  }
  ctx.setLineDash(NO_DASH);
  ctx.globalAlpha = base;
}

/**
 * Пакет спрайтов.
 *
 * Матрица узла уже стоит, поэтому запись без поворота рисуется прямо по своим
 * координатам. Повёрнутой матрица досчитывается вручную: ctx.save()/restore()
 * на элемент — это полное состояние контекста на каждый символ барабана.
 */
function drawSpriteBatch(ctx, node, backend) {
  const m = node.worldMatrix;
  const base = node.worldAlpha;
  let blend = null;
  let transformed = false;

  for (let i = 0; i < node.count; i++) {
    const it = node.items[i];
    const f = it.frame;
    if (!f || !f.image) continue;
    const alpha = base * it.alpha;
    if (alpha <= 0.002) continue;

    if (it.blend !== blend) {
      ctx.globalCompositeOperation = it.blend || "source-over";
      blend = it.blend;
    }
    ctx.globalAlpha = alpha;

    if (it.rotation) {
      const c = Math.cos(it.rotation);
      const s = Math.sin(it.rotation);
      ctx.setTransform(
        c * m.a + s * m.c,
        c * m.b + s * m.d,
        -s * m.a + c * m.c,
        -s * m.b + c * m.d,
        it.x * m.a + it.y * m.c + m.tx,
        it.x * m.b + it.y * m.d + m.ty
      );
      ctx.drawImage(f.image, f.x, f.y, f.w, f.h, -it.w / 2, -it.h / 2, it.w, it.h);
      transformed = true;
    } else {
      if (transformed) {
        ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
        transformed = false;
      }
      ctx.drawImage(f.image, f.x, f.y, f.w, f.h,
        it.x - it.w / 2, it.y - it.h / 2, it.w, it.h);
    }
  }

  if (transformed) ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
  if (blend) ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = base;
  backend.drawCalls += node.count;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Фон, вписанный «по большей стороне».
 *
 * Собирается в собственный offscreen ровно по размеру, который занимает
 * на холсте, и пересобирается только когда меняется его состав, размер
 * или разрешение. В кадре остаётся одно копирование один к одному —
 * иначе каждый кадр уходил бы на масштабирование 1920×1080 в 3072×1728.
 *
 * Второй DOM-холст под игрой сознательно не используется: он добавляет
 * браузеру ещё один слой композиции, и на слабой графике это съедает
 * весь выигрыш.
 */
function drawCover(ctx, node, backend) {
  const res = clamp(backend.resolution, 0.5, 3);
  const pw = Math.max(1, Math.ceil(node.width * res));
  const ph = Math.max(1, Math.ceil(node.height * res));

  let cache = node._cover;
  if (!cache) {
    cache = node._cover = { canvas: document.createElement("canvas"), rev: -1, w: 0, h: 0 };
    cache.ctx = cache.canvas.getContext("2d", { alpha: true });
  }

  if (cache.rev !== node.revision || cache.w !== pw || cache.h !== ph) {
    // Присваивание width переаллоцирует буфер, поэтому делается только
    // при настоящей смене размера, а не на каждой пересборке состава.
    if (cache.w !== pw || cache.h !== ph) {
      cache.canvas.width = pw;
      cache.canvas.height = ph;
      cache.w = pw;
      cache.h = ph;
    }
    const c = cache.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, pw, ph);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    for (const layer of node.layers) {
      if (!node.store.has(layer.name)) continue;
      coverBlit(c, node.store.frame(layer.name), pw, ph, layer.alpha ?? 1);
    }
    cache.rev = node.revision;
  }

  // Заготовка собрана ровно в тех пикселях, которые узел занимает на холсте,
  // поэтому её кладут БЕЗ преобразования — пиксель в пиксель.
  //
  // Выигрыш здесь не в миллисекундах: замер в headless Chromium на 3072×1728
  // дал 30.1 мс против 28.9 мс, то есть разницу внутри шума. Выигрыш
  // в резкости. Через матрицу узла drawImage идёт с масштабом 1.0000…,
  // и растеризатор всё равно пересэмплирует картинку, слегка её размывая;
  // при единичной матрице этого не происходит по построению. Так же
  // рисовал и прежний фон, собиравшийся в offscreen мимо графа сцены.
  //
  // Условие проверяется, а не предполагается: повёрнутый или растянутый
  // фон уходит на обычный путь.
  const m = node.worldMatrix;
  const straight = m.b === 0 && m.c === 0
    && Math.abs(m.a * node.width - pw) < 1.5
    && Math.abs(m.d * node.height - ph) < 1.5;

  if (straight) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache.canvas, Math.round(m.tx), Math.round(m.ty));
    ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
  } else {
    ctx.drawImage(cache.canvas, 0, 0, pw, ph, 0, 0, node.width, node.height);
  }
  backend.drawCalls++;
}

/** Вписывает кадр по большей стороне с обрезкой краёв. */
function coverBlit(ctx, frame, w, h, alpha) {
  const scale = Math.max(w / frame.w, h / frame.h);
  const dw = frame.w * scale;
  const dh = frame.h * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h,
    (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

register(NodeType.COVER, { canvas2d: drawCover });
register(NodeType.SPRITE, { canvas2d: drawSprite });
// Анимированный спрайт отличается от обычного только тем, кто меняет ему
// кадр, — рисуется он тем же кодом. Отдельный тип нужен, чтобы WebGL2 мог
// класть его в другой батч, не трогая этот файл.
register(NodeType.ANIMATED_SPRITE, { canvas2d: drawSprite });
register(NodeType.SPRITE_BATCH, { canvas2d: drawSpriteBatch });
register(NodeType.NINE_SLICE, { canvas2d: drawNineSlice });
register(NodeType.TEXT, { canvas2d: drawText });
register(NodeType.RECT, { canvas2d: drawRect });
register(NodeType.SHAPE, { canvas2d: drawShape });
register(NodeType.PARTICLES, {
  canvas2d(ctx, node, backend) {
    drawParticles(ctx, node);
    backend.drawCalls += node.count;
  }
});
register(NodeType.CUSTOM, {
  canvas2d(ctx, node, backend) {
    node.drawFn(ctx, node);
    backend.drawCalls++;
  }
});
