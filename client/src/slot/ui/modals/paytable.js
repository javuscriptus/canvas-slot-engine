// Таблица выплат: сколько платит каждый символ и правила игры.
//
// Сетка собрана из узлов — картинка символа, его название и строка выплат.
// Раньше она рисовалась одним колбэком на ctx: пятнадцать drawImage и
// тридцать fillText каждый кадр, пока окно открыто, и полная невозможность
// показать то же самое на другом бэкенде.

import { Container, Sprite, Text } from "../../../engine/display.js";
import { textStyle, applyTextStyle } from "../../theme/styles.js";
import { Modal } from "./modal.js";

export class PaytableModal extends Modal {
  constructor(opts) {
    super({ ...opts, title: opts.i18n.t("paytable") });
    this.config = opts.config;
    this.rtp = opts.rtp;
    this.columns = 3;
    this._build();
  }

  _build() {
    const { i18n, config, store, theme } = this;

    this.grid = new Container();
    this.content.add(this.grid);

    // По записи на символ. Состав не меняется за сессию, поэтому узлы
    // создаются один раз, а раскладка только двигает их.
    this.entries = config.symbolKeys.map((key, id) => {
      const cellNode = new Container();

      const icon = new Sprite(store.frame(key), 1);
      const name = new Text(i18n.symbol(key), textStyle(theme, "paytableName"));
      const pays = new Text(payLine(config, id), {
        ...textStyle(theme, "paytablePays"),
        fill: payColor(config, id, theme)
      });
      name.setAnchor(0, 0.5);
      pays.setAnchor(0, 0.5);

      cellNode.add(icon, name, pays);
      this.grid.add(cellNode);
      return { key, id, node: cellNode, icon, name, pays };
    });

    this.notes = new Text("", textStyle(theme, "paytableNotes"));
    this.content.add(this.notes);
  }

  applyLayout(layout) {
    super.applyLayout(layout);
    const portrait = layout.name === "portrait";
    const W = this.contentSize.width;
    const H = this.contentSize.height * 0.62;

    this.columns = portrait ? 2 : 3;
    const cols = this.columns;
    const rows = Math.ceil(this.entries.length / cols);
    const cw = W / cols;
    const ch = H / rows;
    const iconSize = Math.min(cw * 0.3, ch * 0.72);

    this.entries.forEach((e, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      e.node.setPosition(col * cw, row * ch);
      e.icon.setSize(iconSize, iconSize);
      e.icon.setPosition(6, (ch - iconSize) / 2);
      e.name.setPosition(iconSize + 20, ch * 0.3);
      e.pays.setPosition(iconSize + 20, ch * 0.62);
    });

    this.notes.setPosition(0, this.contentSize.height * 0.66);
    // В портрете строка правил заметно длиннее по высоте экрана и короче
    // по ширине — там текст крупнее, иначе он теряется.
    applyTextStyle(this.notes, this.theme, "paytableNotes", portrait ? 1.08 : 1);
    this.notes.text = this._notes();
  }

  /**
   * Возврат игроку показывается только тогда, когда он пришёл с сервера.
   * Круглое «96.0», вписанное в клиент, врёт: сертифицированная модель
   * даёт 96.008, и расхождение в правилах — это претензия регулятора.
   */
  _notes() {
    const t = (key, ...args) => this.i18n.t(key, ...args);
    const lines = [
      t("wildNote"), t("scatterNote"), t("wildMultNote"), t("linesNote")
    ];
    if (this.rtp) lines.push(t("rtpNote", this.rtp));
    lines.push(t("maxWinNote", this.config.maxWinMultiplier), t("malfunctionNote"));
    return lines.join("\n");
  }
}

/** Строка выплат символа: «5× 500   4× 100   3× 25». */
function payLine(config, id) {
  const pays = config.paytable[id];
  if (pays) {
    return Object.keys(pays).sort((a, b) => b - a).map((n) => `${n}× ${pays[n]}`).join("   ");
  }
  if (id === config.scatter) {
    return Object.keys(config.scatterPays).sort((a, b) => b - a)
      .map((n) => `${n}× ${config.scatterPays[n]}`).join("   ");
  }
  return "WILD";
}

function payColor(config, id, theme) {
  if (config.paytable[id]) return theme.palette.winGlow;
  if (id === config.scatter) return theme.palette.positive;
  return theme.palette.wild;
}
