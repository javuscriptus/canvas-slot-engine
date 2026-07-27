// Фон сцены: закат в базовой игре, ночь во фриспинах.
//
// Тема здесь только НАЗЫВАЕТ картинки и говорит, насколько проявлен
// бонусный слой. Как вписать их в экран и чем рисовать — забота движка
// (узел CoverImage и его отрисовщик в бэкенде). До этого фон был
// единственным местом клиента, которое рисовало само, через Custom(ctx),
// и вторая тема унаследовала бы вместе с ним и сто пятьдесят строк
// работы с offscreen-холстом.
//
// Имена картинок приходят из раскладки, а не отсюда: в портрете и
// в ландшафте это разные файлы с разным кадрированием.

import { CoverImage } from "../../engine/display.js";

export class BackgroundView extends CoverImage {
  constructor(store, layout) {
    super(store, layout.width, layout.height);
    this._freeAlpha = 0;
    this.baseName = null;
    this.freeName = null;
    this.applyLayout(layout);
  }

  /** Доля «бонусного» фона: 0 — базовая игра, 1 — фриспины. Двигается твином. */
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
    this.baseName = layout.background;
    this.freeName = layout.backgroundFree;
    this._sync();
  }

  _sync() {
    this.setLayers([
      { name: this.baseName, alpha: 1 },
      { name: this.freeName, alpha: this._freeAlpha }
    ]);
  }
}
