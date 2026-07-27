// Автоигра: сколько спинов и два обязательных ограничителя.

import { Container, Text, NineSlice } from "../../../engine/display.js";
import { textStyle, applyTextStyle } from "../../theme/styles.js";
import { Modal } from "./modal.js";
import { Button } from "../button.js";

const CHIP_W = 150;
const CHIP_H = 66;

export class AutoplayModal extends Modal {
  /**
   * Три ряда фишек: сколько спинов, предел потерь и порог одиночного
   * выигрыша. Два последних — не опция, а требование регуляторов
   * (UKGC, MGA, Spelinspektionen): автоигру без предела потерь
   * в этих юрисдикциях не сертифицируют.
   *
   * Суммы лимитов зависят от ставки, поэтому задаются множителями к ней,
   * а не абсолютными числами: «100 ставок» понятно и на 0.2, и на 100.
   */
  constructor(opts) {
    super({ ...opts, title: opts.i18n.t("autoplayTitle") });
    this.onStart = opts.onStart;
    this.getBet = opts.getBet || (() => 1);

    this.rows = [
      { key: "spins", label: "autoplaySpins", options: [10, 25, 50, 100, 250, 500], selected: 25 },
      { key: "loss", label: "autoplayLossLimit", options: [0, 20, 50, 100, 250, 500], selected: 0, money: true },
      { key: "win", label: "autoplayWinLimit", options: [0, 20, 50, 100, 250, 500], selected: 0, money: true }
    ];
    this._build();
  }

  _build() {
    for (const row of this.rows) {
      row.title = new Text(this.i18n.t(row.label), textStyle(this.theme, "chipTitle"));
      row.title.setAnchor(0.5, 0);
      this.content.add(row.title);

      // Фишки — отдельные узлы, а не рисунок на холсте: попадание по
      // холсту пришлось бы считать вручную, и это лишний источник ошибок.
      row.chips = row.options.map((value) => {
        const chip = new Container();
        chip.value = value;
        const frame = this.store.frame(this.theme.atlas.panelDark);
        const plate = new NineSlice(frame, frame.slice || [22, 22, 22, 22], 2);
        plate.setSize(CHIP_W, CHIP_H);
        const text = new Text("", textStyle(this.theme, "chipValue"));
        text.setAnchor(0.5);
        text.setPosition(CHIP_W / 2, CHIP_H / 2);
        chip.add(plate, text);
        chip.interactive = true;
        chip.getLocalSize = () => ({ width: CHIP_W, height: CHIP_H });
        chip.onTap = () => {
          row.selected = value;
          this.audio.play(this.theme.sounds.click);
          this._refreshChips();
        };
        chip.plate = plate;
        chip.text = text;
        this.content.add(chip);
        return chip;
      });
    }

    this.note = new Text(this.i18n.t("autoplayLimitsNote"), textStyle(this.theme, "autoplayNote"));
    this.note.setAnchor(0.5, 0);
    this.content.add(this.note);

    this.startButton = new Button(this.store.frame(this.theme.atlas.btnSpin), {
      audio: this.audio,
      sound: this.theme.sounds.button,
      onTap: () => {
        const bet = this.getBet() || 1;
        this.onStart(this._row("spins").selected, {
          lossLimit: this._row("loss").selected * bet,
          winLimit: this._row("win").selected * bet
        });
        this.hide();
      }
    });
    this.startButton.setBaseScale(0.62);
    this.content.add(this.startButton);

    this._refreshChips();
  }

  _row(key) {
    return this.rows.find((r) => r.key === key);
  }

  /** Показывает суммы лимитов в деньгах — множители игроку ни о чём не говорят. */
  _refreshChips() {
    const bet = this.getBet() || 1;
    for (const row of this.rows) {
      for (const chip of row.chips) {
        const on = chip.value === row.selected;
        chip.plate.alpha = on ? 1 : 0.4;
        chip.scaleX = chip.scaleY = on ? 1.06 : 1;
        chip.text.text = !row.money
          ? String(chip.value)
          : chip.value === 0
            ? this.i18n.t("autoplayNoLimit")
            : this.money.format(chip.value * bet, { decimals: 0 });
        // «БЕЗ ЛИМИТА» — слово, а не число, и в ту же фишку оно влезает
        // только заметно мельче.
        applyTextStyle(chip.text, this.theme, "chipValue",
          row.money && chip.value === 0 ? 0.61 : 0.93);
      }
    }
  }

  show() {
    // Ставку могли поменять между открытиями окна — суммы обязаны совпадать
    // с тем, что игрок видит на панели.
    this._refreshChips();
    super.show();
  }

  applyLayout(layout) {
    super.applyLayout(layout);
    const w = this.contentSize.width;
    const cols = layout.name === "portrait" ? 3 : 6;
    const gap = layout.name === "portrait" ? 14 : 18;
    const totalW = cols * CHIP_W + (cols - 1) * gap;
    const startX = (w - totalW) / 2;

    let y = 0;
    for (const row of this.rows) {
      row.title.setPosition(w / 2, y);
      y += 34;
      row.chips.forEach((chip, i) => {
        const col = i % cols;
        const line = Math.floor(i / cols);
        chip.setPosition(startX + col * (CHIP_W + gap) + CHIP_W / 2,
          y + line * (CHIP_H + gap) + CHIP_H / 2);
        chip.setPivot(CHIP_W / 2, CHIP_H / 2);
      });
      y += Math.ceil(row.options.length / cols) * (CHIP_H + gap) + 12;
    }

    this.note.setPosition(w / 2, y);
    this.startButton.setPosition(w / 2, y + 70);
  }

  update(dt) {
    super.update(dt);
    this.startButton.update(dt);
  }
}
