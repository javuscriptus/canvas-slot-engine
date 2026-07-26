// Фон сцены, собранный заранее.
//
// Фон статичен, но занимает весь экран. Если рисовать его в общем потоке,
// каждый кадр уходит на масштабирование картинки 1920×1080 в 3072×1728 —
// на HiDPI это в одиночку съедало больше трети бюджета кадра.
//
// Здесь он собирается в offscreen-холст ровно по размеру игрового и
// перерисовывается только когда действительно меняется: при смене размера
// окна и во время перехода в режим фриспинов. В кадре остаётся одно
// копирование один к одному.
//
// Второй DOM-холст под игрой сознательно не используется: он добавляет
// браузеру ещё один слой композиции, и на слабой графике это съедает
// выигрыш целиком.

export class BackgroundLayer {
  constructor(store) {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.store = store;

    this.baseName = null;
    this.freeName = null;
    this._freeAlpha = 0;
    this._dirty = true;
    this._width = 0;
    this._height = 0;
  }

  /** Доля «бонусного» фона: 0 — базовая игра, 1 — фриспины. */
  set freeAlpha(v) {
    const next = Math.max(0, Math.min(1, v));
    if (Math.abs(next - this._freeAlpha) < 0.004) return;
    this._freeAlpha = next;
    this._dirty = true;
  }

  get freeAlpha() {
    return this._freeAlpha;
  }

  setThemes(baseName, freeName) {
    if (this.baseName === baseName && this.freeName === freeName) return;
    this.baseName = baseName;
    this.freeName = freeName;
    this._dirty = true;
  }

  /** @param {number} w,h размер игрового холста в его собственных пикселях */
  resize(w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this._width && h === this._height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this._width = w;
    this._height = h;
    this._dirty = true;
  }

  /** Выводит готовый фон один к одному, без масштабирования. */
  blit(ctx) {
    if (!this._width) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.canvas, 0, 0);
  }

  /** Вызывается каждый кадр, но реально рисует только при изменениях. */
  update() {
    if (!this._dirty || !this.baseName) return;
    this._dirty = false;

    const ctx = this.ctx;
    const w = this._width;
    const h = this._height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#07020F";
    ctx.fillRect(0, 0, w, h);

    this._drawCover(this.store.frame(this.baseName), w, h, 1);
    if (this._freeAlpha > 0.004) {
      this._drawCover(this.store.frame(this.freeName), w, h, this._freeAlpha);
    }
  }

  /**
   * Вписывает картинку «по большей стороне» с обрезкой краёв.
   * Фон единственный элемент, который обязан заполнять экран целиком —
   * поля по краям сцены выглядят как брак вёрстки.
   */
  _drawCover(frame, w, h, alpha) {
    const scale = Math.max(w / frame.w, h / frame.h);
    const dw = frame.w * scale;
    const dh = frame.h * scale;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(
      frame.image, frame.x, frame.y, frame.w, frame.h,
      (w - dw) / 2, (h - dh) / 2, dw, dh
    );
    this.ctx.globalAlpha = 1;
  }
}
