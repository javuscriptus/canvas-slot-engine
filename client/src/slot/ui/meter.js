// Счётчик «подпись + значение».
//
// Значение докручивается плавно: баланс, изменившийся скачком, читается
// как ошибка, а не как выигрыш.

import { Container, Text } from "../../engine/display.js";
import { textStyle } from "../theme/styles.js";

export class Meter extends Container {
  /**
   * @param opts.emphasis во сколько раз крупнее базовой роли рисовать
   *   значение. Счётчик выигрыша заметно больше остальных — он и есть
   *   то, ради чего игрок смотрит на панель.
   */
  constructor(label, theme, { emphasis = 1 } = {}) {
    super();

    this.labelNode = new Text(label, textStyle(theme, "meterLabel"));
    this.labelNode.setAnchor(0.5, 0.5);
    this.labelNode.y = -22;

    this.valueNode = new Text("0.00", textStyle(theme, "meterValue", emphasis));
    this.valueNode.setAnchor(0.5, 0.5);
    this.valueNode.y = 16;

    this.add(this.labelNode, this.valueNode);

    this._value = 0;
    this._display = 0;
    this._formatter = (v) => String(v);
  }

  setLabel(text) {
    this.labelNode.text = text;
    return this;
  }

  setFormatter(fn) {
    this._formatter = fn;
    return this;
  }

  /** @param {boolean} instant без анимации — например, при загрузке */
  setValue(v, instant = false) {
    this._value = v;
    if (instant) {
      this._display = v;
      this.valueNode.text = this._formatter(v);
    }
    return this;
  }

  update(dt) {
    if (Math.abs(this._display - this._value) < 0.005) {
      if (this._display !== this._value) {
        this._display = this._value;
        this.valueNode.text = this._formatter(this._value);
      }
      return;
    }
    // Докрутка за фиксированное время, а не с фиксированной скоростью:
    // иначе крупный выигрыш считался бы минуту.
    const k = 1 - Math.exp(-9 * dt);
    this._display += (this._value - this._display) * k;
    this.valueNode.text = this._formatter(this._display);
  }
}
