// Копии символов ровно того размера, каким они окажутся на экране.
//
// Почему не рисовать прямо из атласа. Символ в атласе — 512×512, а ячейка
// барабана на типичном экране — около 300 пикселей. Canvas2D не умеет
// мип-мапы, поэтому такое сжатие пересчитывается заново в каждом кадре
// столько раз, сколько символов на поле: и дорого, и мылко — фильтр берёт
// слишком мало отсчётов. Подготовленная копия решает обе проблемы сразу.
//
// Размытие тоже считается заранее: ctx.filter — самая дорогая операция
// Canvas2D, в кадре её быть не должно. Если браузер filter не поддерживает,
// смаз подменяется вертикальным растягиванием при отрисовке.
//
// На WebGL2 этот модуль не нужен вовсе — там мип-мапы и тинт бесплатны.

import { prescale, blur, supportsFilter } from "../../engine/texture.js";

export class SymbolTextures {
  /**
   * @param frameOf (id) => кадр атласа. Соответствие «числовой id символа →
   *   картинка» задаёт тема: ни движок, ни слот про якоря и шашлык не знают.
   */
  constructor(frameOf, symbolIds, cellDesign) {
    this.frameOf = frameOf;
    this.ids = symbolIds;
    this.normal = new Map();
    this.blurred = new Map();

    this.supportsFilter = supportsFilter();

    this.cellDesign = cellDesign;
    this.pixelScale = 0;
    this.rebuild(1, cellDesign);
  }

  /**
   * @param {number} pixelScale во сколько раз дизайнерский пиксель крупнее
   *                            на холсте (scale × devicePixelRatio)
   * @param {number} cellDesign размер ячейки в дизайнерских пикселях
   */
  rebuild(pixelScale, cellDesign = this.cellDesign) {
    // Небольшие изменения игнорируем: пересборка двух десятков текстур
    // на каждый пиксель перетаскивания границы окна — заметный рывок.
    if (
      Math.abs(pixelScale - this.pixelScale) < 0.06 &&
      cellDesign === this.cellDesign &&
      this.normal.size > 0
    ) return false;

    this.pixelScale = pixelScale;
    this.cellDesign = cellDesign;

    // 1.10 — запас на пульсацию выигравшего символа, чтобы при увеличении
    // он не начинал мылить.
    const target = Math.max(48, Math.round(cellDesign * 0.94 * 1.1 * pixelScale));

    this.normal.clear();
    this.blurred.clear();

    for (const id of this.ids) {
      const frame = this.frameOf(id);
      const scaled = prescale(frame, target, target);
      this.normal.set(id, scaled);
      this.blurred.set(id, blur(scaled, target));
    }
    return true;
  }

  get(id, blurred) {
    return (blurred ? this.blurred : this.normal).get(id) || this.normal.get(id);
  }
}
