// Фон темы «Неон».
//
// Картинки те же (арт общий), но роли у них обратные: базовая игра идёт
// на ночном кадре, а закатный проступает только в бесплатных спинах —
// на бонусе город «зажигается». Одно и то же оформление, прочитанное
// в другую сторону, и это решение принимает тема, а не слот.

import { CoverImage } from "../../engine/display.js";

export class BackgroundView extends CoverImage {
  constructor(store, layout) {
    super(store, layout.width, layout.height);
    this._freeAlpha = 0;
    this.nightName = null;
    this.duskName = null;
    this.applyLayout(layout);
  }

  set freeAlpha(v) {
    const next = v < 0 ? 0 : v > 1 ? 1 : v;
    if (next === this._freeAlpha) return;
    this._freeAlpha = next;
    this._sync();
  }

  get freeAlpha() {
    return this._freeAlpha;
  }

  applyLayout(layout) {
    this.setSize(layout.width, layout.height);
    this.nightName = layout.backgroundFree;
    this.duskName = layout.background;
    this._sync();
  }

  _sync() {
    this.setLayers([
      { name: this.nightName, alpha: 1 },
      { name: this.duskName, alpha: this._freeAlpha * 0.85 }
    ]);
  }
}
