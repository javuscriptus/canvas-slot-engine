// Кнопка: спрайт, который реагирует на указатель.

import { Sprite } from "../../engine/display.js";

export class Button extends Sprite {
  /**
   * @param opts.sound имя звука нажатия ИЗ ТЕМЫ. Умолчания нет намеренно:
   *   «click» в коде кнопки — это оформление, спрятанное в слоте, и вторая
   *   тема не смогла бы его сменить, не переименовав свой спрайт.
   */
  constructor(frame, { scaleFactor = 2, onTap = null, sound = null, audio = null } = {}) {
    super(frame, scaleFactor);
    this.setAnchor(0.5);
    this.interactive = true;
    this.enabled = true;
    this._baseScale = 1;
    this._tapHandler = onTap;
    this._sound = sound;
    this._audio = audio;
    this._targetScale = 1;

    this.onDown = () => {
      if (!this.enabled) return;
      this._targetScale = 0.92;
    };
    this.onUp = () => {
      this._targetScale = this._isHover ? 1.05 : 1;
    };
    this.onOver = () => {
      if (!this.enabled) return;
      this._targetScale = 1.05;
    };
    this.onOut = () => {
      this._targetScale = 1;
    };
    this.onTap = () => {
      if (!this.enabled) return;
      if (this._audio && this._sound) this._audio.play(this._sound);
      if (this._tapHandler) this._tapHandler(this);
    };
  }

  setBaseScale(v) {
    this._baseScale = v;
    return this;
  }

  setEnabled(v) {
    this.enabled = v;
    this.alpha = v ? 1 : 0.42;
    this.interactive = v;
    if (!v) this._targetScale = 1;
    return this;
  }

  /** Плавная реакция на наведение и нажатие — без твинов, каждый кадр. */
  update(dt) {
    const target = this._targetScale * this._baseScale;
    const k = 1 - Math.exp(-22 * dt);
    this.scaleX += (target - this.scaleX) * k;
    this.scaleY = this.scaleX;
  }
}
