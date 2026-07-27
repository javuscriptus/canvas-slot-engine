// Индикатор фриспинов: сколько осталось из скольких.

import { Container, Text, NineSlice } from "../../engine/display.js";
import { Easing } from "../../engine/core.js";
import { textStyle } from "../theme/styles.js";

export class FreeSpinBadge extends Container {
  constructor(store, i18n, theme) {
    super();
    this.i18n = i18n;
    this.visible = false;

    const frame = store.frame(theme.atlas.panel);
    this.plate = new NineSlice(frame, frame.slice || [26, 26, 26, 26], 2);
    this.plate.setSize(420, 96);
    this.plate.x = -210;
    this.plate.y = -48;

    this.label = new Text("", textStyle(theme, "badge"));
    this.label.setAnchor(0.5);

    this.add(this.plate, this.label);
    this._pulse = 0;
  }

  show(left, total) {
    this.visible = true;
    this.label.text = `${this.i18n.t("freeSpins")}  ${left} / ${total}`;
    this._pulse = 0.35;
  }

  hide() {
    this.visible = false;
  }

  update(dt) {
    if (!this.visible) return;
    if (this._pulse > 0) {
      this._pulse = Math.max(0, this._pulse - dt);
      const k = this._pulse / 0.35;
      this.scaleX = this.scaleY = 1 + 0.12 * Easing.quadOut(k);
    } else {
      this.scaleX = this.scaleY = 1;
    }
  }
}
