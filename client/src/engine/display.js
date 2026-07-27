// Граф сцены. Узлы хранят локальное преобразование, рендер обходит дерево
// и складывает матрицы. Аллокаций в кадре нет: матрицы переиспользуются.
//
// Узел не умеет себя рисовать и ничего не знает про Canvas2D: он объявляет
// свой nodeType, а отрисовщик под этот тип регистрирует бэкенд. Поэтому
// здесь нет ни одного обращения к ctx.

import { NodeType } from "./render/drawables.js";

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
    this.nodeType = null;       // ключ отрисовщика в реестре drawables
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
    this.zIndex = 0;            // порядок внутри контейнера с sortableChildren

    // Узлы с точной геометрией отбрасываются рендером до вызова отрисовщика.
    // Узлы, которые рисуют произвольно (Custom, частицы), по умолчанию НЕ
    // отсекаются: отсечь по объявленному размеру то, что рисует шире него, —
    // значит получить пропадающую графику вместо экономии.
    this.cullable = false;

    this.worldMatrix = new Matrix();
    this.worldAlpha = 1;
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

  /**
   * Прямоугольник для отсечения по видимости, в ЛОКАЛЬНЫХ координатах.
   * null означает «границы неизвестны» — такой узел рисуется всегда.
   */
  getCullRect() {
    return null;
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
    this.nodeType = NodeType.CONTAINER;
    this.isContainer = true;
    // Контейнер отсекается только по маске; без неё getCullRect вернёт null,
    // и поддерево обойдётся целиком.
    this.cullable = true;
    this.children = [];
    this.sortableChildren = false;
    // Маска отсечения в локальных координатах — используется барабанами.
    this.clip = null;   // {x, y, width, height}
    this._sortDirty = false;
  }

  add(...nodes) {
    for (const n of nodes) {
      if (n.parent) n.parent.remove(n);
      n.parent = this;
      this.children.push(n);
    }
    this._sortDirty = true;
    return nodes[0];
  }

  addAt(node, index) {
    if (node.parent) node.parent.remove(node);
    node.parent = this;
    this.children.splice(index, 0, node);
    this._sortDirty = true;
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

  /**
   * Пересортировка по zIndex.
   *
   * Вызывается рендером и только когда состав детей менялся: сортировка
   * полутора десятков узлов каждый кадр — это и сравнения, и аллокация
   * внутри Array#sort. Если zIndex поменяли на лету, порядок обновится
   * после setZIndex(), а не «когда-нибудь».
   */
  sortChildren() {
    if (!this._sortDirty) return;
    this._sortDirty = false;
    // Индекс добавления держит стабильность: узлы с равным zIndex
    // обязаны сохранить порядок, в котором их положили.
    const order = this.children;
    const keyed = order.map((n, i) => ({ n, i }));
    keyed.sort((a, b) => (a.n.zIndex - b.n.zIndex) || (a.i - b.i));
    for (let i = 0; i < keyed.length; i++) order[i] = keyed[i].n;
  }

  setZIndex(node, z) {
    node.zIndex = z;
    this._sortDirty = true;
    return node;
  }

  getLocalSize() {
    if (this.clip) return { width: this.clip.width, height: this.clip.height };
    return { width: 0, height: 0 };
  }

  /**
   * Контейнер отсекается только по маске: без неё его размер задают дети,
   * и посчитать его дешевле обходом, чем объединением габаритов поддерева.
   */
  getCullRect(out) {
    if (!this.clip) return null;
    out.x = this.clip.x;
    out.y = this.clip.y;
    out.w = this.clip.width;
    out.h = this.clip.height;
    return out;
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
    this.nodeType = NodeType.SPRITE;
    this.cullable = true;
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

  getCullRect(out) {
    out.x = -this.anchorX * this.width;
    out.y = -this.anchorY * this.height;
    out.w = this.width;
    out.h = this.height;
    return out;
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
    this.nodeType = NodeType.NINE_SLICE;
    this.cullable = true;
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

  getCullRect(out) {
    out.x = 0; out.y = 0; out.w = this.width; out.h = this.height;
    return out;
  }
}

/* ─────────────────────────────── текст ──────────────────────────── */

/**
 * Текст рисуется в собственный offscreen-canvas и дальше выводится как
 * картинка. Перерисовка только при смене содержимого — fillText каждый кадр
 * для полутора десятков надписей на слабом Android стоит дороже, чем весь
 * остальной рендер.
 *
 * Ключевое здесь одно: холст только РАСТЁТ и никогда не пересоздаётся.
 * Присваивание canvas.width переаллоцирует буфер целиком и обнуляет его,
 * а у счётчика крупного выигрыша содержимое меняется каждый кадр.
 *
 * Замер в headless Chromium, буфер 3160×480, одна перерисовка:
 *
 *   с пересозданием холста      2.53 мс
 *   в готовый холст             0.04 мс
 *   в готовый холст, без тени   0.04 мс
 *
 * То есть все 2.5 мс на кадр стоила именно аллокация, а не гауссова тень:
 * тень внутри кеша не измеряется вовсе, потому что она считается один раз
 * на смену текста и по площади надписи, а не по площади экрана. Правило
 * «никакого shadowBlur в кадре» относится к отрисовке сцены, где размытие
 * идёт по всему холсту каждый кадр, — там оно и стоило свои 10–20 мс.
 */
export class Text extends Node {
  constructor(text = "", style = {}) {
    super();
    this.nodeType = NodeType.TEXT;
    this.cullable = true;
    this._text = String(text);
    // Умолчаний нет намеренно. Любая подстановка вида «600 32px чего-то»
    // или «белый» — это решение об оформлении, принятое движком, и оно
    // молча переживает смену темы: надпись просто нарисуется не тем
    // шрифтом или не тем цветом, и никто этого не заметит до скриншота.
    if (!style.font) throw new Error("Text без шрифта: гарнитуру и кегль задаёт тема");
    if (!style.fill && !style.gradient) throw new Error("Text без заливки: цвет задаёт тема");
    this.style = {
      font: null,
      fill: null,
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
    // Выделено под буфер против фактически занятого: рисуем весь буфер,
    // а выводим только занятую часть.
    this._bufW = 0;
    this._bufH = 0;
    this._srcW = 0;
    this._srcH = 0;
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

  getCullRect(out) {
    out.x = -this.anchorX * this.width;
    out.y = -this.anchorY * this.height;
    out.w = this.width;
    out.h = this.height;
    return out;
  }

  /** Готова ли подложка к выводу. */
  get ready() {
    return this._srcW > 0 && this._srcH > 0;
  }

  /** Перерисовывает подложку. Вызывается отрисовщиком при _dirty. */
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

    this._applyFont(ctx);
    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);

    const blur = s.shadow ? s.shadow.blur || 0 : 0;
    const padX = (s.strokeWidth || 0) + (s.shadow ? blur + Math.abs(s.shadow.x || 0) : 0) + 4;
    const padY = (s.strokeWidth || 0) + (s.shadow ? blur + Math.abs(s.shadow.y || 0) : 0) + 4;

    const w = Math.ceil(maxW + padX * 2);
    const h = Math.ceil(lineHeight * lines.length + padY * 2);

    const needW = Math.max(1, Math.ceil(w * dpr));
    const needH = Math.max(1, Math.ceil(h * dpr));
    this._growBuffer(needW, needH);
    this._srcW = needW;
    this._srcH = needH;

    // Чистим в ПИКСЕЛЯХ буфера и с запасом в два пикселя.
    //
    // Буфер только растёт, поэтому за пределами занятой части остаётся
    // предыдущая, более длинная надпись. Выводится строго занятая часть —
    // но билинейная фильтрация на краю прихватывает соседний столбец, и
    // он проступает вертикальной чёрточкой. На заголовке окна истории
    // («ИСТОРИЯ» → «РАУНД») это выглядело как курсор после текста.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, needW + 2, needH + 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._applyFont(ctx);
    ctx.textAlign = s.align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;

    const anchorX = s.align === "center" ? w / 2 : s.align === "right" ? w - padX : padX;

    for (let i = 0; i < lines.length; i++) {
      const y = padY + lineHeight * (i + 0.5);

      // Заливка считается один раз на строку и используется обоими
      // проходами. Раньше проход тени красился отдельным цветом, и у
      // градиентной надписи это был белый по умолчанию — на краях
      // букв проступала светлая кайма.
      let paint = s.fill;
      if (s.gradient) {
        const g = ctx.createLinearGradient(0, padY + lineHeight * i, 0, padY + lineHeight * (i + 1));
        for (const [off, color] of s.gradient) g.addColorStop(off, color);
        paint = g;
      }

      if (s.shadow) {
        ctx.save();
        ctx.shadowColor = s.shadow.color;
        ctx.shadowBlur = s.shadow.blur;
        // Смещение тени задаётся в пикселях вывода и текущей матрицей
        // не преобразуется — отсюда домножение на dpr вручную.
        ctx.shadowOffsetX = (s.shadow.x || 0) * dpr;
        ctx.shadowOffsetY = (s.shadow.y || 0) * dpr;
        ctx.fillStyle = paint;
        ctx.fillText(lines[i], anchorX, y);
        ctx.restore();
      }

      // Обводка идёт первой и толще — так буква не «худеет».
      if (s.stroke && s.strokeWidth > 0) {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.strokeWidth * 2;
        ctx.strokeText(lines[i], anchorX, y);
      }

      ctx.fillStyle = paint;
      ctx.fillText(lines[i], anchorX, y);
    }

    this.width = w;
    this.height = h;
    this._dirty = false;
  }

  _applyFont(ctx) {
    ctx.font = this.style.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${this.style.letterSpacing}px`;
  }

  /**
   * Буфер растёт ступенями по 64 пикселя. Без ступени счётчик, у которого
   * за кадр прибавляется цифра, переаллоцировал бы холст почти каждый кадр —
   * то есть ровно та беда, от которой мы уходим.
   */
  _growBuffer(needW, needH) {
    if (this._bufW >= needW && this._bufH >= needH) return;
    const w = Math.max(this._bufW, Math.ceil(needW / 64) * 64);
    const h = Math.max(this._bufH, Math.ceil(needH / 64) * 64);
    this._canvas.width = w;
    this._canvas.height = h;
    this._bufW = w;
    this._bufH = h;
  }

  _fontSize(font) {
    const m = font.match(/(\d+(?:\.\d+)?)px/);
    return m ? parseFloat(m[1]) : 16;
  }
}

/* ──────────────────────── пакет спрайтов ────────────────────────── */

/**
 * Много картинок одним узлом сцены.
 *
 * Барабаны — двадцать пять символов плюс подсветка, свечение и лучи; в графе
 * сцены это под сотню узлов с матрицей, альфой и проверкой отсечения у
 * каждого. Раньше та же экономия достигалась узлом Custom с колбэком на ctx —
 * то есть игровой слой писался против Canvas2D и на другом бэкенде переставал
 * работать вовсе. Здесь игра кладёт в пакет ЧИСЛА, а чем их рисовать, решает
 * бэкенд: у Canvas2D это цикл drawImage, у WebGL2 — один батч.
 *
 * Записи переиспользуются: пакет собирается заново каждый кадр, и аллокация
 * на элемент означала бы сотню объектов в кадре.
 */
export class SpriteBatch extends Node {
  constructor(width = 0, height = 0) {
    super();
    this.nodeType = NodeType.SPRITE_BATCH;
    this.width = width;
    this.height = height;
    this.items = [];
    this.count = 0;
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    return this;
  }

  /** Начинает новый кадр пакета. Записи прошлого кадра переиспользуются. */
  clear() {
    this.count = 0;
    return this;
  }

  /**
   * Добавляет картинку по ЦЕНТРУ (cx, cy). Аргументы позиционные и все
   * обязательные: объект настроек на каждый символ — это те же аллокации
   * в кадре, от которых пакет и заводился.
   */
  add(frame, cx, cy, w, h, alpha = 1, rotation = 0, blend = null) {
    let it = this.items[this.count];
    if (!it) {
      it = { frame: null, x: 0, y: 0, w: 0, h: 0, alpha: 1, rotation: 0, blend: null };
      this.items.push(it);
    }
    it.frame = frame;
    it.x = cx;
    it.y = cy;
    it.w = w;
    it.h = h;
    it.alpha = alpha;
    it.rotation = rotation;
    it.blend = blend;
    this.count++;
    return it;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }
}

/* ──────────────────────── векторная фигура ──────────────────────── */

/**
 * Ломаные и многоугольники, заданные ДАННЫМИ.
 *
 * Нужна там, где картинки нет и быть не может: линии выплат, галочка,
 * шкала волатильности. Раньше всё это рисовалось колбэком на ctx прямо
 * из игрового слоя; здесь узел несёт только координаты и стиль, а как
 * превратить их в пиксели — забота бэкенда (на WebGL2 — разложение
 * в треугольники).
 *
 * Путь: { points: [x, y, …], closed, fill, stroke, strokeWidth,
 *         dash, dashOffset, cap, join, alpha }
 * fill и stroke — цвет строкой либо описание градиента (см. Rect#fill).
 */
export class Shape extends Node {
  constructor(paths = [], width = 0, height = 0) {
    super();
    this.nodeType = NodeType.SHAPE;
    this.paths = paths;
    this.width = width;
    this.height = height;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }
}

/* ────────────────────────── фон «по большей стороне» ───────────── */

/**
 * Полноэкранный фон из одной-двух картинок.
 *
 * Узел несёт только данные: какие кадры показать, с какой прозрачностью
 * и в каком прямоугольнике. Всё остальное — забота бэкенда, и это не
 * формальность: фон единственный элемент, который обязан заполнять экран
 * целиком, а значит масштабируется «по большей стороне» с обрезкой краёв.
 * На Canvas2D такое масштабирование картинки 1920×1080 в 3072×1728 в кадре
 * в одиночку съедало больше трети бюджета, поэтому бэкенд собирает фон
 * в offscreen ровно один раз и дальше копирует один к одному.
 *
 * Раньше этот кеш лежал в теме и рисовал сам, через Custom(ctx => …) —
 * последнее место в клиенте, прибитое к Canvas2D. Теперь темы описывают
 * фон именами кадров, а вторая тема получает его бесплатно.
 *
 * layers: [{ name: имя кадра, alpha: 0…1 }] — порядок снизу вверх.
 */
export class CoverImage extends Node {
  constructor(store, width = 0, height = 0) {
    super();
    this.nodeType = NodeType.COVER;
    this.store = store;
    this.layers = [];
    this.width = width;
    this.height = height;
    // Ключ состояния для бэкенда: пока он не менялся, пересобирать нечего.
    this.revision = 0;
  }

  /** @param layers [{ name, alpha }]; alpha ≤ 0 — слой не рисуется вовсе. */
  setLayers(layers) {
    const next = layers.filter((l) => l.name && (l.alpha === undefined || l.alpha > 0.004));
    if (sameLayers(this.layers, next)) return this;
    this.layers = next;
    this.revision++;
    return this;
  }

  setSize(width, height) {
    if (width === this.width && height === this.height) return this;
    this.width = width;
    this.height = height;
    this.revision++;
    return this;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }
}

function sameLayers(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if (Math.abs((a[i].alpha ?? 1) - (b[i].alpha ?? 1)) > 0.004) return false;
  }
  return true;
}

/* ─────────────────────── простые примитивы ──────────────────────── */

/**
 * Заливка прямоугольника — подложки, затемнения, полосы прогресса.
 *
 * `fill` — либо цвет строкой, либо НЕИЗМЕНЯЕМОЕ описание градиента:
 *   { type: "linear", x0, y0, x1, y1, stops: [[доля, цвет], …] }
 *   { type: "radial", x0, y0, r0, x1, y1, r1, stops }
 * Бэкенд кеширует построенный градиент прямо на этом объекте, поэтому
 * менять его поля нельзя: нужен другой градиент — нужен другой объект.
 * Анимировать прозрачность следует альфой узла, а не альфой в стопах.
 */
export class Rect extends Node {
  /** @param fill цвет, описание градиента или null — прямоугольник без заливки. */
  constructor(width, height, fill = null) {
    super();
    this.nodeType = NodeType.RECT;
    this.cullable = true;
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

  getCullRect(out) {
    out.x = 0; out.y = 0; out.w = this.width; out.h = this.height;
    return out;
  }
}

/**
 * Узел с произвольной отрисовкой: колбэк получает готовый контекст
 * в локальной системе координат.
 *
 * Существует как аварийный выход, а не как способ строить игру: всё, что
 * рисуется через Custom, привязано к Canvas2D и на другом бэкенде работать
 * не будет. Новую графику правильнее описывать своим типом узла.
 */
export class Custom extends Node {
  constructor(drawFn, width = 0, height = 0) {
    super();
    this.nodeType = NodeType.CUSTOM;
    this.drawFn = drawFn;
    this.width = width;
    this.height = height;
  }

  getLocalSize() {
    return { width: this.width, height: this.height };
  }

  /**
   * Отсечение доступно, но выключено: колбэк вправе рисовать за пределами
   * объявленного размера, и включать его должен тот, кто знает, что не
   * рисует. Ставится через node.cullable = true.
   */
  getCullRect(out) {
    out.x = 0; out.y = 0; out.w = this.width; out.h = this.height;
    return out;
  }
}

export { NodeType };
