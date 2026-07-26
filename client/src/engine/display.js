// Граф сцены. Узлы хранят локальное преобразование, рендер обходит дерево
// и складывает матрицы. Аллокаций в кадре нет: матрицы переиспользуются.

import { Signal } from "./core.js";

let UID = 0;

/* ───────────────────────────── матрица 2×3 ──────────────────────── */

export class Matrix {
  constructor() {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.tx = 0; this.ty = 0;
  }

  identity() {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.tx = 0; this.ty = 0;
    return this;
  }

  copyFrom(m) {
    this.a = m.a; this.b = m.b; this.c = m.c; this.d = m.d; this.tx = m.tx; this.ty = m.ty;
    return this;
  }

  /** this = parent × local, где local задан компонентами узла. */
  setFromTransform(parent, x, y, pivotX, pivotY, scaleX, scaleY, rotation, skewX = 0, skewY = 0) {
    let a, b, c, d;
    if (rotation === 0 && skewX === 0 && skewY === 0) {
      a = scaleX; b = 0; c = 0; d = scaleY;
    } else {
      const sr = Math.sin(rotation);
      const cr = Math.cos(rotation);
      a = cr * scaleX;
      b = sr * scaleX;
      c = -sr * scaleY;
      d = cr * scaleY;
      if (skewX || skewY) {
        const sx = Math.tan(skewX);
        const sy = Math.tan(skewY);
        const a2 = a + c * sy;
        const b2 = b + d * sy;
        c = a * sx + c;
        d = b * sx + d;
        a = a2; b = b2;
      }
    }

    const tx = x - (pivotX * a + pivotY * c);
    const ty = y - (pivotX * b + pivotY * d);

    if (parent) {
      this.a = a * parent.a + b * parent.c;
      this.b = a * parent.b + b * parent.d;
      this.c = c * parent.a + d * parent.c;
      this.d = c * parent.b + d * parent.d;
      this.tx = tx * parent.a + ty * parent.c + parent.tx;
      this.ty = tx * parent.b + ty * parent.d + parent.ty;
    } else {
      this.a = a; this.b = b; this.c = c; this.d = d; this.tx = tx; this.ty = ty;
    }
    return this;
  }

  /** Прямое преобразование точки: локальные координаты → сцена. */
  apply(px, py, out = { x: 0, y: 0 }) {
    out.x = this.a * px + this.c * py + this.tx;
    out.y = this.b * px + this.d * py + this.ty;
    return out;
  }

  /** Обратное преобразование точки — нужно для попадания указателя. */
  applyInverse(px, py, out = { x: 0, y: 0 }) {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) {
      out.x = 0; out.y = 0;
      return out;
    }
    const id = 1 / det;
    const dx = px - this.tx;
    const dy = py - this.ty;
    out.x = (this.d * dx - this.c * dy) * id;
    out.y = (this.a * dy - this.b * dx) * id;
    return out;
  }
}

/* ──────────────────────────────── узел ──────────────────────────── */

export class Node {
  constructor() {
    this.id = ++UID;
    this.x = 0;
    this.y = 0;
    this.scaleX = 1;
    this.scaleY = 1;
    this.rotation = 0;
    this.pivotX = 0;
    this.pivotY = 0;
    this.skewX = 0;
    this.skewY = 0;

    this.alpha = 1;
    this.visible = true;
    this.blendMode = null;      // 'lighter', 'multiply', …
    this.interactive = false;
    this.parent = null;

    this.worldMatrix = new Matrix();
    this.worldAlpha = 1;

    // Заполняется рендером; используется отсечением и попаданием указателя.
    this._bounds = { x: 0, y: 0, w: 0, h: 0 };
  }

  set scale(v) {
    this.scaleX = v;
    this.scaleY = v;
  }

  get scale() {
    return this.scaleX;
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  setPivot(x, y) {
    this.pivotX = x;
    this.pivotY = y;
    return this;
  }

  updateTransform(parentMatrix, parentAlpha) {
    this.worldMatrix.setFromTransform(
      parentMatrix, this.x, this.y, this.pivotX, this.pivotY,
      this.scaleX, this.scaleY, this.rotation, this.skewX, this.skewY
    );
    this.worldAlpha = parentAlpha * this.alpha;
  }

  /** Локальный размер узла — переопределяется наследниками. */
  getLocalSize() {
    return { width: 0, height: 0 };
  }

  containsPoint(globalX, globalY) {
    const p = this.worldMatrix.applyInverse(globalX, globalY, TMP_POINT);
    const { width, height } = this.getLocalSize();
    return p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
  }

  destroy() {
    if (this.parent) this.parent.remove(this);
  }
}

const TMP_POINT = { x: 0, y: 0 };

/* ─────────────────────────────── контейнер ──────────────────────── */

export class Container extends Node {
  constructor() {
    super();
    this.children = [];
    this.sortableChildren = false;
    this.zIndex = 0;
    // Маска отсечения в локальных координатах — используется барабанами.
    this.clip = null;   // {x, y, width, height}
  }

  add(...nodes) {
    for (const n of nodes) {
      if (n.parent) n.parent.remove(n);
      n.parent = this;
      this.children.push(n);
    }
    return nodes[0];
  }

  addAt(node, index) {
    if (node.parent) node.parent.remove(node);
    node.parent = this;
    this.children.splice(index, 0, node);
    return node;
  }

  remove(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) {
      this.children.splice(i, 1);
      node.parent = null;
    }
    return node;
  }

  removeAll() {
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
  }

  getLocalSize() {
    if (this.clip) return { width: this.clip.width, height: this.clip.height };
    return { width: 0, height: 0 };
  }
}

/* ─────────────────────────────── спрайт ─────────────────────────── */

/**
 * Кадр: { image, x, y, w, h } — координаты внутри атласа.
 * `scaleFactor` учитывает, что атлас нарисован крупнее дизайнерских пикселей.
 */
export class Sprite extends Node {
  constructor(frame = null, scaleFactor = 1) {
    super();
    this.frame = frame;
    this.scaleFactor = scaleFactor;
    this.anchorX = 0;
    this.anchorY = 0;
    this.width = frame ? frame.w / scaleFactor : 0;
    this.height = frame ? frame.h / scaleFactor : 0;
    this.tint = null;      // '#rrggbb' — применяется через кеш подкрашенных копий
  }

  setFrame(frame, scaleFactor = this.scaleFactor) {
    this.frame = frame;
    this.scaleFactor = scaleFactor;
    this.width = frame.w / scaleFactor;
    this.height = frame.h / scaleFactor;
    return this;
  }

  setAnchor(x, y = x) {
    this.anchorX = x;
    this.anchorY = y;
    return this;
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    return this;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }

  containsPoint(gx, gy) {
    const p = this.worldMatrix.applyInverse(gx, gy, TMP_POINT);
    const ox = -this.anchorX * this.width;
    const oy = -this.anchorY * this.height;
    return p.x >= ox && p.x <= ox + this.width && p.y >= oy && p.y <= oy + this.height;
  }
}

/* ──────────────────────────── nine-slice ────────────────────────── */

/** Растягиваемая рамка: углы не деформируются, края тянутся. */
export class NineSlice extends Node {
  constructor(frame, slice, scaleFactor = 1) {
    super();
    this.frame = frame;
    this.slice = slice;              // [left, top, right, bottom] в пикселях атласа
    this.scaleFactor = scaleFactor;
    this.width = frame.w / scaleFactor;
    this.height = frame.h / scaleFactor;
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    return this;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }
}

/* ─────────────────────────────── текст ──────────────────────────── */

/**
 * Текст рисуется в собственный offscreen-canvas и дальше выводится как
 * картинка. Перерисовка только при смене содержимого — fillText каждый кадр
 * для 15 надписей на слабом Android стоит дороже, чем весь остальной рендер.
 */
export class Text extends Node {
  constructor(text = "", style = {}) {
    super();
    this._text = String(text);
    this.style = {
      font: "700 32px Poppins, Lora, sans-serif",
      fill: "#ffffff",
      stroke: null,
      strokeWidth: 0,
      align: "left",          // left | center | right
      baseline: "alphabetic",
      shadow: null,           // {color, blur, x, y}
      letterSpacing: 0,
      gradient: null,         // [[offset, color], …] по вертикали
      maxWidth: 0,            // если задано — текст сжимается по горизонтали
      lineHeight: 0,
      ...style
    };
    this.anchorX = 0;
    this.anchorY = 0;
    this._canvas = null;
    this._ctx = null;
    this._dirty = true;
    this._dpr = 1;
    this.width = 0;
    this.height = 0;
  }

  set text(v) {
    const s = String(v);
    if (s === this._text) return;
    this._text = s;
    this._dirty = true;
  }

  get text() {
    return this._text;
  }

  setStyle(patch) {
    Object.assign(this.style, patch);
    this._dirty = true;
    return this;
  }

  setAnchor(x, y = x) {
    this.anchorX = x;
    this.anchorY = y;
    return this;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }

  /** Перерисовывает подложку. Вызывается рендером при _dirty. */
  redraw(dpr) {
    const s = this.style;
    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
      this._ctx = this._canvas.getContext("2d");
    }
    const ctx = this._ctx;
    this._dpr = dpr;

    const lines = this._text.split("\n");
    const lineHeight = s.lineHeight || this._fontSize(s.font) * 1.22;

    ctx.font = s.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${s.letterSpacing}px`;

    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);

    const padX = (s.strokeWidth || 0) + (s.shadow ? s.shadow.blur + Math.abs(s.shadow.x || 0) : 0) + 4;
    const padY = (s.strokeWidth || 0) + (s.shadow ? s.shadow.blur + Math.abs(s.shadow.y || 0) : 0) + 4;

    const w = Math.ceil(maxW + padX * 2);
    const h = Math.ceil(lineHeight * lines.length + padY * 2);

    this._canvas.width = Math.max(1, Math.ceil(w * dpr));
    this._canvas.height = Math.max(1, Math.ceil(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.font = s.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${s.letterSpacing}px`;
    ctx.textAlign = s.align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;

    const anchorX = s.align === "center" ? w / 2 : s.align === "right" ? w - padX : padX;

    for (let i = 0; i < lines.length; i++) {
      const y = padY + lineHeight * (i + 0.5);

      if (s.shadow) {
        ctx.save();
        ctx.shadowColor = s.shadow.color;
        ctx.shadowBlur = s.shadow.blur;
        ctx.shadowOffsetX = (s.shadow.x || 0) * dpr;
        ctx.shadowOffsetY = (s.shadow.y || 0) * dpr;
        ctx.fillStyle = s.fill;
        ctx.fillText(lines[i], anchorX, y);
        ctx.restore();
      }

      // Обводка идёт первой и толще — так буква не «худеет».
      if (s.stroke && s.strokeWidth > 0) {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.strokeWidth * 2;
        ctx.strokeText(lines[i], anchorX, y);
      }

      if (s.gradient) {
        const g = ctx.createLinearGradient(0, padY + lineHeight * i, 0, padY + lineHeight * (i + 1));
        for (const [off, color] of s.gradient) g.addColorStop(off, color);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = s.fill;
      }
      ctx.fillText(lines[i], anchorX, y);
    }

    this.width = w;
    this.height = h;
    this._dirty = false;
  }

  _fontSize(font) {
    const m = font.match(/(\d+(?:\.\d+)?)px/);
    return m ? parseFloat(m[1]) : 16;
  }
}

/* ─────────────────────── простые примитивы ──────────────────────── */

/** Заливка прямоугольника — подложки, затемнения, полосы прогресса. */
export class Rect extends Node {
  constructor(width, height, fill = "#000000") {
    super();
    this.width = width;
    this.height = height;
    this.fill = fill;
    this.radius = 0;
    this.stroke = null;
    this.strokeWidth = 0;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }
}

/**
 * Узел с произвольной отрисовкой: колбэк получает готовый контекст
 * в локальной системе координат. Для линий выплат и прочей векторики.
 */
export class Custom extends Node {
  constructor(drawFn, width = 0, height = 0) {
    super();
    this.drawFn = drawFn;
    this.width = width;
    this.height = height;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }
}
