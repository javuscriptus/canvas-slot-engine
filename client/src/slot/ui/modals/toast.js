// Всплывающее сообщение поверх всего: связь, лимиты, напоминания оператора.

import { Container, Text, NineSlice } from "../../../engine/display.js";
import { textStyle } from "../../theme/styles.js";

export class Toast extends Container {
  constructor({ store, theme, layout }) {
    super();
    const frame = store.frame(theme.atlas.panel);
    this.plate = new NineSlice(frame, frame.slice || [26, 26, 26, 26], 2);
    this.text = new Text("", textStyle(theme, "toast"));
    this.text.setAnchor(0.5);
    this.add(this.plate, this.text);
    this.visible = false;
    this._timer = 0;
    this.layout = layout;
    this.fadeTime = theme.timings.toastFade;
  }

  applyLayout(layout) {
    this.layout = layout;
  }

  show(message, seconds = 3) {
    this.text.text = message;
    const w = Math.max(360, this.text.width + 80);
    const h = 96;
    this.plate.setSize(w, h);
    this.plate.setPosition(-w / 2, -h / 2);
    this.setPosition(this.layout.width / 2, this.layout.height * 0.18);
    this.visible = true;
    this.alpha = 1;
    this._timer = seconds;
  }

  update(dt) {
    if (!this.visible) return;
    this._timer -= dt;
    if (this._timer < this.fadeTime) this.alpha = Math.max(0, this._timer / this.fadeTime);
    if (this._timer <= 0) this.visible = false;
  }
}
