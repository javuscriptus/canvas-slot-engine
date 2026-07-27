// Фасад рендера: размер холста, координаты, обход графа, выбор бэкенда.
//
// Здесь нет ни одного вызова ctx. Фасад решает ЧТО рисовать и в каком
// порядке, бэкенд — ЧЕМ. Граница проходит ровно по методу draw(): всё,
// что выше, одинаково для Canvas2D и WebGL2.
//
// ── Контракт бэкенда ────────────────────────────────────────────────
//
//   static id                       ключ реализации в реестре drawables
//   static isSupported(canvas)      можно ли поднять его на этом холсте
//   new Backend(canvas, opts)       opts: {transparent, backgroundColor}
//   get surface                     первый аргумент отрисовщиков
//   resize(pxW, pxH, resolution)    холст уже нужного размера; resolution —
//                                   итоговый масштаб дизайнерского пикселя
//   begin()                         очистка кадра, сброс drawCalls
//   end()                           отправка накопленного (flush батча)
//   pushState(node) → bool          blend и маска отсечения узла
//   popState(pushed)                возврат состояния
//   draw(node, drawable)            ставит матрицу с альфой и зовёт
//                                   drawable[backend.id](surface, node, backend)
//   textures                        кеш подготовленных текстур
//   drawCalls                       счётчик вызовов отрисовки за кадр
//   destroy()
//
// Ничего, кроме этого, фасад о бэкенде не знает — и игровой слой тоже.

import { Matrix, Container } from "../display.js";
import { Signal } from "../core.js";
import { drawableFor } from "./drawables.js";
import { Canvas2DBackend } from "./backend-canvas2d.js";

/** Доступные бэкенды в порядке предпочтения. */
const BACKENDS = [Canvas2DBackend];

const CULL = { x: 0, y: 0, w: 0, h: 0 };

export class Renderer {
  constructor(canvas, {
    designWidth,
    designHeight,
    maxDPR = 2,
    backgroundColor = null,
    transparent = false,
    backend = "auto"
  } = {}) {
    this.canvas = canvas;
    this.transparent = transparent;
    this.designWidth = designWidth;
    this.designHeight = designHeight;
    this.maxDPR = maxDPR;
    this.backgroundColor = backgroundColor;

    this.backend = createBackend(backend, canvas, { transparent, backgroundColor });

    this.stage = new Container();
    this.onResize = new Signal();

    // Итоговый масштаб «дизайнерский пиксель → пиксель холста».
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dpr = 1;
    this.viewWidth = 0;
    this.viewHeight = 0;

    this._rootMatrix = new Matrix();
    this.culled = 0;
  }

  /** Кеш подготовленных текстур принадлежит бэкенду. */
  get textures() {
    return this.backend.textures;
  }

  get drawCalls() {
    return this.backend.drawCalls;
  }

  /**
   * Подгоняет холст под контейнер.
   * mode 'fit'  — вписать целиком (возможны поля);
   * mode 'fill' — заполнить, обрезая края (для фонов).
   */
  resize(cssWidth, cssHeight, mode = "fit") {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDPR);
    const w = Math.round(cssWidth * dpr);
    const h = Math.round(cssHeight * dpr);

    // Присваивание canvas.width ОЧИЩАЕТ холст. Если событие resize
    // приходит каждый кадр (а браузер шлёт его щедро — при появлении
    // полосы прокрутки, смене масштаба, показе панелей), картинка гаснет
    // между кадрами: это и выглядит как мигание, и ломает попадание по
    // кнопкам, потому что геометрия пересчитывается посреди клика.
    // Поэтому холст переинициализируется только при реальном изменении.
    const unchanged =
      w === this.canvas.width &&
      h === this.canvas.height &&
      dpr === this.dpr &&
      cssWidth === this.viewWidth &&
      cssHeight === this.viewHeight &&
      mode === this._mode &&
      this.designWidth === this._lastDesignWidth &&
      this.designHeight === this._lastDesignHeight;
    if (unchanged) return;

    this.dpr = dpr;
    this._mode = mode;
    this._lastDesignWidth = this.designWidth;
    this._lastDesignHeight = this.designHeight;

    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    const sx = cssWidth / this.designWidth;
    const sy = cssHeight / this.designHeight;
    this.scale = mode === "fill" ? Math.max(sx, sy) : Math.min(sx, sy);

    this.offsetX = (cssWidth - this.designWidth * this.scale) / 2;
    this.offsetY = (cssHeight - this.designHeight * this.scale) / 2;
    this.viewWidth = cssWidth;
    this.viewHeight = cssHeight;

    const s = this.scale * this.dpr;
    this._rootMatrix.a = s;
    this._rootMatrix.b = 0;
    this._rootMatrix.c = 0;
    this._rootMatrix.d = s;
    this._rootMatrix.tx = this.offsetX * this.dpr;
    this._rootMatrix.ty = this.offsetY * this.dpr;

    this.backend.resize(w, h, s);
    this.onResize.emit(cssWidth, cssHeight, this.scale);
  }

  /**
   * Экранные координаты (CSS-пиксели) → система координат сцены.
   *
   * Важно: worldMatrix узлов включает и масштаб раскладки, и devicePixelRatio,
   * то есть отображает дизайнерские координаты в ПИКСЕЛИ ХОЛСТА. Значит и
   * точку указателя нужно приводить к пикселям холста, иначе попадание по
   * кнопке считается в другом масштабе и промахивается везде, где
   * scale × dpr ≠ 1 — а это практически любой реальный экран.
   */
  toStage(clientX, clientY, out = { x: 0, y: 0 }) {
    const rect = this.canvas.getBoundingClientRect();
    // getBoundingClientRect учитывает возможное CSS-масштабирование холста.
    const kx = rect.width > 0 ? this.canvas.width / rect.width : this.dpr;
    const ky = rect.height > 0 ? this.canvas.height / rect.height : this.dpr;
    out.x = (clientX - rect.left) * kx;
    out.y = (clientY - rect.top) * ky;
    return out;
  }

  render() {
    this.culled = 0;
    this._viewW = this.canvas.width;
    this._viewH = this.canvas.height;

    this.backend.begin();
    this.stage.updateTransform(this._rootMatrix, 1);
    this._walk(this.stage);
    this.backend.end();
  }

  _walk(node) {
    if (!node.visible || node.worldAlpha <= 0.001) return;
    if (node.cullable && this._offscreen(node)) {
      this.culled++;
      return;
    }

    const pushed = this.backend.pushState(node);

    if (node.isContainer) {
      if (node.sortableChildren) node.sortChildren();
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        child.updateTransform(node.worldMatrix, node.worldAlpha);
        this._walk(child);
      }
    } else {
      const drawable = drawableFor(node.nodeType);
      if (drawable) this.backend.draw(node, drawable);
    }

    this.backend.popState(pushed);
  }

  /**
   * Отсечение по видимости: узел за пределами холста не доходит до
   * бэкенда вообще. Считается по четырём углам локального прямоугольника,
   * потому что узел может быть повёрнут; габарит поворота через хорду
   * дал бы ложные отсечения на диагоналях.
   *
   * Контейнер с маской отсекает всё поддерево разом — на модальных окнах
   * это десятки узлов за одну проверку.
   */
  _offscreen(node) {
    const r = node.getCullRect(CULL);
    if (!r || r.w <= 0 || r.h <= 0) return false;

    const m = node.worldMatrix;
    const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;

    const ax = m.a * x0 + m.c * y0 + m.tx;
    const bx = m.a * x1 + m.c * y0 + m.tx;
    const cx = m.a * x1 + m.c * y1 + m.tx;
    const dx = m.a * x0 + m.c * y1 + m.tx;
    if (Math.min(ax, bx, cx, dx) > this._viewW) return true;
    if (Math.max(ax, bx, cx, dx) < 0) return true;

    const ay = m.b * x0 + m.d * y0 + m.ty;
    const by = m.b * x1 + m.d * y0 + m.ty;
    const cy = m.b * x1 + m.d * y1 + m.ty;
    const dy = m.b * x0 + m.d * y1 + m.ty;
    if (Math.min(ay, by, cy, dy) > this._viewH) return true;
    if (Math.max(ay, by, cy, dy) < 0) return true;

    return false;
  }

  destroy() {
    this.backend.destroy();
  }
}

/**
 * Выбор бэкенда. `?renderer=canvas2d` в адресе принудительно включает
 * запасной — им пользуются стенды и поддержка, когда нужно отделить
 * дефект игры от дефекта драйвера.
 */
function createBackend(requested, canvas, opts) {
  // Неизвестное имя — не повод не запуститься: игрок мог получить ссылку
  // с чужим параметром, и остаться без игры хуже, чем без нужного бэкенда.
  const wanted = BACKENDS.filter((B) => B.id === requested);
  const list = wanted.length ? wanted : BACKENDS;

  for (const B of list) {
    if (B.isSupported(canvas)) return new B(canvas, opts);
  }
  throw new Error("Ни один графический бэкенд не поддерживается этим браузером");
}

/* ────────────────────── подгонка под окно ───────────────────────── */

/**
 * Следит за размером окна и переключает раскладку.
 * Слот обязан жить и в ландшафте, и в портрете — это разные композиции,
 * а не одна растянутая.
 */
export class ViewportManager {
  /**
   * @param opts.build (vw, vh) => layout — раскладка под фактический экран.
   *
   * Раскладка строится на каждое изменение размера, а не выбирается из
   * двух заготовок. Иначе холст фиксированной пропорции вписывается в
   * экран по меньшей стороне, и на телефоне пятая часть высоты уходит
   * в пустые полосы сверху и снизу.
   */
  constructor(renderer, { build, container }) {
    this.renderer = renderer;
    this.build = build;
    this.container = container;
    this.orientation = null;
    this.layout = null;
    this.onOrientationChange = new Signal();

    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("orientationchange", this._onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", this._onResize);
    }
  }

  apply() {
    this._onResize();
  }

  _onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w === this._lastW && h === this._lastH) return;   // событие без изменений
    this._lastW = w;
    this._lastH = h;

    const layout = this.build(w, h);
    const orientation = layout.name;

    this.renderer.designWidth = layout.width;
    this.renderer.designHeight = layout.height;
    this.renderer.resize(w, h, layout.mode || "fit");

    // Раскладка зависит от пропорций, поэтому пересобирать сцену нужно
    // и при смене ориентации, и при заметном изменении формы окна.
    const changed = !this.layout
      || this.layout.name !== layout.name
      || this.layout.width !== layout.width
      || this.layout.height !== layout.height;

    this.layout = layout;
    this.orientation = orientation;
    if (changed) this.onOrientationChange.emit(orientation, layout);
  }

  destroy() {
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("orientationchange", this._onResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this._onResize);
    }
  }
}
