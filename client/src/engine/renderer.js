// Рендер Canvas2D + управление размером холста.
//
// Принципы, от которых зависит производительность:
//   • никаких ctx.shadowBlur в кадре — свечение делается готовыми спрайтами;
//   • save/restore только там, где реально меняется состояние (клип, blend);
//   • текст кешируется в offscreen-canvas и выводится как картинка;
//   • узлы за пределами вьюпорта отбрасываются до вызова drawImage.

import { Container, Sprite, NineSlice, Text, Rect, Custom, Matrix } from "./display.js";
import { Signal, clamp } from "./core.js";
import { TextureCache } from "./texture.js";

export class Renderer {
  constructor(canvas, { designWidth, designHeight, maxDPR = 2, backgroundColor = "#000", transparent = false } = {}) {
    this.canvas = canvas;
    this.transparent = transparent;
    // desynchronized намеренно не включён: он снижает задержку, но на части
    // конфигураций даёт разрывы кадра и заметное мерцание.
    this.ctx = canvas.getContext("2d", { alpha: transparent });
    this.designWidth = designWidth;
    this.designHeight = designHeight;
    this.maxDPR = maxDPR;
    this.backgroundColor = backgroundColor;

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
    this._tintCache = new Map();

    // Кеш текстур, подготовленных под фактический размер на экране.
    // Без него каждый спрайт пересэмплируется в каждом кадре.
    this.textures = new TextureCache(160);
    this.drawCalls = 0;

    // Сигнал для тех, кто держит собственные текстуры (барабаны):
    // при смене размера их нужно пересобрать.
    this.onTexturesInvalidated = new Signal();
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

    // Размер на экране изменился — подготовленные копии больше не подходят.
    this.textures.clear();

    const s = this.scale * this.dpr;
    this._rootMatrix.a = s;
    this._rootMatrix.b = 0;
    this._rootMatrix.c = 0;
    this._rootMatrix.d = s;
    this._rootMatrix.tx = this.offsetX * this.dpr;
    this._rootMatrix.ty = this.offsetY * this.dpr;

    this.onResize.emit(cssWidth, cssHeight, this.scale);
    this.onTexturesInvalidated.emit(this.scale * this.dpr);
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

  /** Обратное преобразование — для отладки и позиционирования DOM-подсказок. */
  toClient(stageX, stageY) {
    const rect = this.canvas.getBoundingClientRect();
    const kx = this.canvas.width / rect.width;
    const ky = this.canvas.height / rect.height;
    return { x: rect.left + stageX / kx, y: rect.top + stageY / ky };
  }

  render() {
    const ctx = this.ctx;
    this.drawCalls = 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.transparent) {
      // Фон живёт на отдельном холсте снизу — здесь только очищаем.
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Текстуры уже подготовлены под нужный размер, поэтому дорогая
    // высококачественная фильтрация в кадре не нужна.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";

    this.stage.updateTransform(this._rootMatrix, 1);
    this._renderNode(this.stage, ctx);
  }

  _renderNode(node, ctx) {
    if (!node.visible || node.worldAlpha <= 0.001) return;

    const needsState = node.blendMode || (node instanceof Container && node.clip);
    if (needsState) ctx.save();

    if (node.blendMode) ctx.globalCompositeOperation = node.blendMode;

    if (node instanceof Container) {
      if (node.clip) {
        const m = node.worldMatrix;
        ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
        ctx.beginPath();
        ctx.rect(node.clip.x, node.clip.y, node.clip.width, node.clip.height);
        ctx.clip();
      }

      if (node.sortableChildren) {
        node.children.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
      }

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        child.updateTransform(node.worldMatrix, node.worldAlpha);
        this._renderNode(child, ctx);
      }
    } else {
      this._draw(node, ctx);
    }

    if (needsState) ctx.restore();
  }

  _draw(node, ctx) {
    const m = node.worldMatrix;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    ctx.globalAlpha = node.worldAlpha;

    if (node instanceof Sprite) {
      const f = node.frame;
      if (!f || !f.image) return;
      const ox = -node.anchorX * node.width;
      const oy = -node.anchorY * node.height;

      if (node.tint) {
        const image = this._tinted(f, node.tint);
        ctx.drawImage(image, 0, 0, f.w, f.h, ox, oy, node.width, node.height);
        this.drawCalls++;
        return;
      }

      // Фактический размер на холсте с учётом всех родительских масштабов.
      const dw = node.width * Math.hypot(m.a, m.b);
      const dh = node.height * Math.hypot(m.c, m.d);
      const tex = this.textures.get(f, dw, dh);

      ctx.drawImage(tex.image, tex.x, tex.y, tex.w, tex.h, ox, oy, node.width, node.height);
      this.drawCalls++;
      return;
    }

    if (node instanceof NineSlice) {
      this._drawNineSlice(node, ctx);
      return;
    }

    if (node instanceof Text) {
      // Разрешение подложки текста определяется итоговым масштабом на
      // холсте, а не только devicePixelRatio: при вписывании раскладки
      // в окно (scale < 1) текст иначе рисуется крупнее нужного и потом
      // сжимается, а при scale > 1 — наоборот, мылится.
      const res = clamp(this.scale * this.dpr, 1, 3);
      if (node._dirty || Math.abs(node._dpr - res) > 0.02) node.redraw(res);
      if (!node._canvas || node._canvas.width === 0) return;
      const ox = -node.anchorX * node.width;
      const oy = -node.anchorY * node.height;
      ctx.drawImage(node._canvas, 0, 0, node._canvas.width, node._canvas.height,
        ox, oy, node.width, node.height);
      this.drawCalls++;
      return;
    }

    if (node instanceof Rect) {
      ctx.beginPath();
      if (node.radius > 0) {
        this._roundRect(ctx, 0, 0, node.width, node.height, node.radius);
      } else {
        ctx.rect(0, 0, node.width, node.height);
      }
      if (node.fill) {
        ctx.fillStyle = node.fill;
        ctx.fill();
      }
      if (node.stroke && node.strokeWidth > 0) {
        ctx.strokeStyle = node.stroke;
        ctx.lineWidth = node.strokeWidth;
        ctx.stroke();
      }
      this.drawCalls++;
      return;
    }

    if (node instanceof Custom) {
      node.drawFn(ctx, node);
      this.drawCalls++;
    }
  }

  _drawNineSlice(node, ctx) {
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
    this.drawCalls += 9;
  }

  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /**
   * Подкрашенная копия кадра. Результат кешируется — построение
   * каждый кадр убило бы производительность.
   */
  _tinted(frame, color) {
    const key = `${frame.image.__id || (frame.image.__id = ++TINT_IMG_ID)}:${frame.x},${frame.y},${frame.w},${frame.h}:${color}`;
    let c = this._tintCache.get(key);
    if (c) return c;

    c = document.createElement("canvas");
    c.width = frame.w;
    c.height = frame.h;
    const cx = c.getContext("2d");
    cx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
    cx.globalCompositeOperation = "source-atop";
    cx.fillStyle = color;
    cx.fillRect(0, 0, frame.w, frame.h);

    this._tintCache.set(key, c);
    return c;
  }
}

let TINT_IMG_ID = 0;

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
