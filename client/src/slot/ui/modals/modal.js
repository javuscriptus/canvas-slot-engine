// Основание модального окна: затемнение, рамка, заголовок, крестик.

import { Container, Text, Rect, NineSlice } from "../../../engine/display.js";
import { textStyle } from "../../theme/styles.js";
import { Button } from "../button.js";

export class Modal extends Container {
  constructor({ store, audio, i18n, theme, tweens, layout, title, money }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    this.theme = theme;
    this.tweens = tweens;
    this.money = money;
    this.visible = false;
    this.alpha = 0;

    const art = theme.atlas;

    // Затемнение обязано ПЕРЕХВАТЫВАТЬ нажатия, а не пропускать их.
    // Пока оно было прозрачным для указателя, тап мимо окна доходил до
    // кнопки «Крутить» под ним: игрок закрывал таблицу выплат и обнаруживал,
    // что случайно поставил. Заодно закрываем окно — привычное поведение.
    this.backdrop = new Rect(layout.width, layout.height, theme.palette.backdrop);
    this.backdrop.interactive = true;
    this.backdrop.onTap = () => this.hide();

    // Само окно тоже перехватывает нажатия — иначе тап по пустому месту
    // внутри него провалился бы на затемнение и закрыл окно.
    const panelFrame = store.frame(art.panel);
    this.panel = new NineSlice(panelFrame, panelFrame.slice || [26, 26, 26, 26], 2);
    this.panel.interactive = true;
    this.panel.onTap = () => {};

    this.titleText = new Text(title, textStyle(theme, "modalTitle"));
    this.titleText.setAnchor(0.5);

    this.closeButton = new Button(store.frame(art.btnClose), {
      audio, sound: theme.sounds.click, onTap: () => this.hide()
    });

    this.content = new Container();

    this.add(this.backdrop, this.panel, this.titleText, this.content, this.closeButton);
    this.onHidden = null;
  }

  applyLayout(layout) {
    this.layout = layout;
    this.backdrop.width = layout.width;
    this.backdrop.height = layout.height;

    const pad = layout.name === "portrait" ? 40 : 160;
    const w = layout.width - pad * 2;
    const h = layout.height * (layout.name === "portrait" ? 0.76 : 0.82);
    const x = pad;
    const y = (layout.height - h) / 2;

    this.panel.setSize(w, h);
    this.panel.setPosition(x, y);
    this.titleText.setPosition(layout.width / 2, y + 62);
    this.closeButton.setPosition(x + w - 56, y + 56);
    this.content.setPosition(x + 48, y + 130);
    this.contentSize = { width: w - 96, height: h - 190 };
  }

  show() {
    this.visible = true;
    this.alpha = 0;
    this._fade(1);
  }

  hide() {
    this._fade(0, () => {
      this.visible = false;
      if (this.onHidden) this.onHidden();
    });
  }

  /**
   * Проявление идёт твином, а не собственным requestAnimationFrame:
   * своя петля не знает про паузу от лобби и доигрывает поверх
   * остановленной игры.
   */
  _fade(to, done) {
    this.tweens.cancelTarget(this);
    this.tweens.to(this, { alpha: to },
      { duration: this.theme.timings.modalFade, onComplete: done });
  }

  update(dt) {
    this.closeButton.update(dt);
  }
}
