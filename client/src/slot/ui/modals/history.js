// История раундов и разбор одного раунда.
//
// Разбор — не украшение. Регулятор требует, чтобы игрок мог увидеть по
// номеру раунда всё: экран каждого спина, каждую сработавшую линию и её
// вклад. Тот же экран закрывает половину обращений в поддержку вида
// «у меня не засчитался выигрыш».
//
// И список, и разбор собраны из узлов. Раньше оба рисовались колбэками
// на ctx, и заодно в них второй раз оказалась зашита сетка 5×3 — размер
// поля брался константами прямо в отрисовке разбора.

import { Container, Sprite, Text, Rect, NineSlice } from "../../../engine/display.js";
import { textStyle } from "../../theme/styles.js";
import { Modal } from "./modal.js";

const ROW_H = 54;
const MAX_ROWS = 18;
const MAX_WIN_ROWS = 9;

export class HistoryModal extends Modal {
  constructor(opts) {
    super({ ...opts, title: opts.i18n.t("history") });
    this.config = opts.config;
    this.onOpenRound = opts.onOpenRound || null;   // async (id) => detail

    this.rounds = [];
    this.detail = null;
    this.spinIndex = 0;

    this._buildList();
    this._buildDetail();

    this.backButton = this._plate(this.i18n.t("roundBack"), 220, () => this.showList());
    this.prevButton = this._plate("‹", 76, () => this._step(-1));
    this.nextButton = this._plate("›", 76, () => this._step(1));
    for (const b of [this.backButton, this.prevButton, this.nextButton]) {
      b.visible = false;
      this.content.add(b);
    }
    this.showList();
  }

  /* ──────────────────────────── список ─────────────────────────── */

  _buildList() {
    const { theme } = this;

    this.list = new Container();
    // Список ловит нажатия целиком: строка — это не узел, а место в нём,
    // и попадание считается обратной матрицей.
    this.list.interactive = true;
    this.list.getLocalSize = () => ({ width: this.list.width || 0, height: this.list.height || 0 });
    this.list.onTap = (node, sx, sy) => this._tapList(sx, sy);
    this.content.add(this.list);

    this.listHint = new Text(this.i18n.t("roundTapHint"), textStyle(theme, "historyHint"));
    this.listHint.setAnchor(0, 0.5);
    this.listHint.setPosition(12, ROW_H / 2);
    this.list.add(this.listHint);

    this.listEmpty = new Text("—", textStyle(theme, "historyEmpty"));
    this.listEmpty.setAnchor(0.5, 0.5);
    this.list.add(this.listEmpty);

    // Столбцы строки различаются только цветом: время приглушено, ставка
    // нейтральна, выигрыш подсвечен — так строка читается без заголовков.
    const cell = (fill) => new Text("", { ...textStyle(theme, "historyCell"), fill });

    this.listRows = Array.from({ length: MAX_ROWS }, () => {
      const row = new Container();
      const stripe = new Rect(0, ROW_H, theme.palette.rowStripe);
      const time = cell(theme.palette.textSoft);
      const bet = cell(theme.palette.textDim);
      const win = cell(theme.palette.positive);
      const chevron = new Text("›", { ...textStyle(theme, "historyCell"), fill: theme.palette.textFaint });
      for (const t of [time, bet, win, chevron]) t.setAnchor(0, 0.5);
      row.add(stripe, time, bet, win, chevron);
      row.visible = false;
      this.list.add(row);
      return { row, stripe, time, bet, win, chevron };
    });
  }

  /* ──────────────────────────── разбор ─────────────────────────── */

  _buildDetail() {
    const { theme, config } = this;
    // Роль задаёт кегль и гарнитуру, цвет уточняется на месте: у разбора
    // раунда полтора десятка надписей одного размера и семи разных смыслов.
    const label = (role, fill) => {
      const t = new Text("", fill
        ? { ...textStyle(theme, role), fill }
        : textStyle(theme, role));
      t.setAnchor(0, 0.5);
      return t;
    };

    this.detailView = new Container();
    this.detailView.visible = false;
    this.content.add(this.detailView);

    this.d = {
      idLabel: label("detailSmall"),
      idValue: label("detailMono"),
      atLabel: label("detailSmall"),
      atValue: label("detailSmall", theme.palette.textDim),
      rngLabel: label("detailSmall"),
      rngValue: label("detailSmall", theme.palette.textDim),
      bet: label("detailAmount"),
      win: label("detailAmount", theme.palette.positive),
      capped: label("detailSmall", theme.palette.warn),
      kind: label("detailKind"),
      noWin: label("detailSmall")
    };
    this.detailView.add(...Object.values(this.d));

    // Экран спина: ячеек ровно столько, сколько в игре, — размер сетки
    // приходит с сервера и здесь больше не выдумывается.
    this.screenCells = [];
    for (let row = 0; row < config.rows; row++) {
      for (let reel = 0; reel < config.reels; reel++) {
        const box = new Rect(0, 0, theme.palette.rowStripe);
        // Кадр подставится при показе; сейчас нужен любой, чтобы у спрайта
        // была картинка вообще.
        const icon = new Sprite(this.store.frame(config.symbolKeys[0]), 1);
        icon.visible = false;
        this.detailView.add(box, icon);
        this.screenCells.push({ reel, row, box, icon });
      }
    }

    this.winRows = Array.from({ length: MAX_WIN_ROWS + 1 }, () => {
      const line = label("detailSmall", theme.palette.textSoft);
      const symbol = label("detailSmall", theme.palette.text);
      const amount = label("detailSmall", theme.palette.positive);
      this.detailView.add(line, symbol, amount);
      return { line, symbol, amount };
    });
  }

  /** Маленькая кнопка-табличка: отдельный узел, чтобы попадание считал движок. */
  _plate(text, width, onTap) {
    const node = new Container();
    const frame = this.store.frame(this.theme.atlas.panelDark);
    const plate = new NineSlice(frame, frame.slice || [22, 22, 22, 22], 2);
    plate.setSize(width, 56);
    const label = new Text(text, textStyle(this.theme, "modalButton"));
    label.setAnchor(0.5);
    label.setPosition(width / 2, 28);
    node.add(plate, label);
    node.interactive = true;
    node.getLocalSize = () => ({ width, height: 56 });
    node.onTap = () => { this.audio.play(this.theme.sounds.click); onTap(); };
    return node;
  }

  /* ─────────────────────────── состояния ───────────────────────── */

  setRounds(rounds) {
    this.rounds = rounds;
    this.showList();
  }

  showList() {
    this.detail = null;
    this.list.visible = true;
    this.detailView.visible = false;
    this.backButton.visible = false;
    this.prevButton.visible = false;
    this.nextButton.visible = false;
    this.titleText.text = this.i18n.t("history");
    this._fillList();
  }

  showDetail(detail) {
    this.detail = detail;
    this.spinIndex = 0;
    this.list.visible = false;
    this.detailView.visible = true;
    this.backButton.visible = true;
    const many = (detail.spins || []).length > 1;
    this.prevButton.visible = many;
    this.nextButton.visible = many;
    this.titleText.text = this.i18n.t("roundDetails");
    this._fillDetail();
  }

  hide() {
    super.hide();
    this.showList();
  }

  _step(delta) {
    const n = this.detail?.spins?.length || 0;
    if (!n) return;
    this.spinIndex = (this.spinIndex + delta + n) % n;
    this._fillDetail();
  }

  _tapList(stageX, stageY) {
    if (!this.onOpenRound || !this.rounds.length) return;
    const p = this.list.worldMatrix.applyInverse(stageX, stageY, { x: 0, y: 0 });
    const i = Math.floor((p.y - ROW_H) / ROW_H);   // первая строка — подсказка
    const r = this.rounds[i];
    if (!r) return;
    this.audio.play(this.theme.sounds.click);
    this.onOpenRound(r.id);
  }

  applyLayout(layout) {
    super.applyLayout(layout);
    const { width, height } = this.contentSize;
    this.list.width = width;
    this.list.height = height;
    this.detailView.width = width;
    this.detailView.height = height - 76;

    this.listEmpty.setPosition(width / 2, ROW_H * 1.5);
    this.backButton.setPosition(0, height - 56);
    this.prevButton.setPosition(width - 76 * 2 - 16, height - 56);
    this.nextButton.setPosition(width - 76, height - 56);

    this._fillList();
    if (this.detail) this._fillDetail();
  }

  /* ───────────────────────── наполнение ────────────────────────── */

  _fillList() {
    const W = this.list.width || 0;
    const max = Math.max(0, Math.min(MAX_ROWS, Math.floor((this.list.height || 0) / ROW_H) - 1));
    this.listEmpty.visible = this.rounds.length === 0;

    for (let i = 0; i < this.listRows.length; i++) {
      const r = this.listRows[i];
      const data = i < max ? this.rounds[i] : null;
      r.row.visible = !!data;
      if (!data) continue;

      const top = (i + 1) * ROW_H;
      const mid = ROW_H / 2;
      r.row.setPosition(0, top);
      // Полосой красится каждая вторая строка — читать длинный список
      // ровных строк глазами тяжело.
      r.stripe.visible = i % 2 === 0;
      r.stripe.width = W;

      r.time.text = new Date(data.at).toLocaleString();
      r.time.setPosition(12, mid);

      r.bet.text = `−${this.money.plain(data.bet)}`;
      r.bet.setPosition(W * 0.52, mid);

      r.win.text = data.win > 0 ? `+${this.money.plain(data.win)}` : "—";
      r.win.setStyle({
        fill: data.win > 0 ? this.theme.palette.positive : this.theme.palette.textMuted
      });
      r.win.setPosition(W * 0.74, mid);

      r.chevron.setPosition(W - 24, mid);
    }
  }

  _fillDetail() {
    const d = this.detail;
    if (!d) return;
    const W = this.detailView.width;
    const H = this.detailView.height;
    const t = (key, ...args) => this.i18n.t(key, ...args);
    const set = (node, text, x, y) => {
      node.text = text;
      node.setPosition(x, y);
      node.visible = true;
    };

    // ── шапка: то, по чему раунд ищется в поддержке ─────────────
    let y = 16;
    set(this.d.idLabel, `${t("roundId")}:`, 0, y);
    set(this.d.idValue, d.id, 150, y);

    y += 30;
    set(this.d.atLabel, `${t("roundAt")}:`, 0, y);
    set(this.d.atValue, new Date(d.at).toLocaleString(), 150, y);
    set(this.d.rngLabel, `${t("roundRngDraws")}:`, W * 0.6, y);
    set(this.d.rngValue, String(d.rngDraws ?? "—"), W * 0.6 + 200, y);

    y += 38;
    set(this.d.bet, `−${this.money.format(d.bet)}`, 0, y);
    set(this.d.win, d.win > 0 ? `+${this.money.format(d.win)}` : t("roundNoWin"), 220, y);
    this.d.win.setStyle({
      fill: d.win > 0 ? this.theme.palette.positive : this.theme.palette.textMuted
    });
    this.d.capped.visible = !!d.capped;
    if (d.capped) set(this.d.capped, t("roundCapped"), 420, y);

    const spins = d.spins || [];
    const spin = spins[this.spinIndex];
    this._hideScreen(!spin);
    if (!spin) return;

    y += 40;
    const kind = spin.type === "base" ? t("roundBaseSpin") : t("roundFreeSpin");
    set(this.d.kind, `${kind}  ${this.spinIndex + 1}/${spins.length}`, 0, y);

    y += 24;
    const gridTop = y;
    const gridH = Math.max(120, Math.min(H - gridTop - 20, 240));
    const cell = Math.min(gridH / this.config.rows, (W * 0.38) / this.config.reels);
    this._fillScreen(spin, 0, gridTop, cell);

    // ── список сработавших линий ─────────────────────────────────
    const listX = cell * this.config.reels + 32;
    let ly = gridTop + 14;
    const wins = spin.wins || [];

    this.d.noWin.visible = wins.length === 0;
    if (!wins.length) set(this.d.noWin, t("roundNoWin"), listX, ly);

    for (let i = 0; i < this.winRows.length; i++) {
      const r = this.winRows[i];
      const w = wins[i];
      const overflow = i === MAX_WIN_ROWS && wins.length > MAX_WIN_ROWS;
      r.line.visible = r.symbol.visible = r.amount.visible = false;
      if (overflow) {
        set(r.line, `… +${wins.length - MAX_WIN_ROWS}`, listX, ly);
        r.line.setStyle({ fill: this.theme.palette.textMuted });
        continue;
      }
      if (!w || i >= MAX_WIN_ROWS) continue;

      const label = w.type === "scatter" ? t("roundScatterWin") : t("roundLine", w.line);
      set(r.line, label, listX, ly);
      r.line.setStyle({ fill: this.theme.palette.textSoft });

      const mult = w.multiplier > 1 ? ` ×${w.multiplier}` : "";
      set(r.symbol, `${this.i18n.symbol(w.symbolKey)} ×${w.count}${mult}`, listX + 110, ly);
      set(r.amount, `+${this.money.plain(w.amount)}`, listX + 340, ly);
      ly += 28;
    }
  }

  _hideScreen(hide) {
    if (!hide) return;
    for (const c of this.screenCells) {
      c.box.visible = false;
      c.icon.visible = false;
    }
  }

  /** Экран спина с подсветкой позиций, попавших в выигрыш. */
  _fillScreen(spin, x0, y0, cell) {
    const lit = new Set();
    for (const w of spin.wins || []) {
      for (const p of w.positions || []) lit.add(`${p.reel}:${p.row}`);
    }

    for (const c of this.screenCells) {
      const on = lit.has(`${c.reel}:${c.row}`);
      const x = x0 + c.reel * cell;
      const y = y0 + c.row * cell;

      c.box.visible = true;
      c.box.setPosition(x + 2, y + 2);
      c.box.width = cell - 4;
      c.box.height = cell - 4;
      c.box.fill = on ? this.theme.palette.rowStripeLit : this.theme.palette.rowStripe;
      c.box.stroke = on ? this.theme.palette.winGlow : null;
      c.box.strokeWidth = on ? 2 : 0;

      const id = spin.screen?.[c.row]?.[c.reel];
      const key = this.config.symbolKeys?.[id];
      if (key && this.store.has(key)) {
        const pad = cell * 0.1;
        c.icon.visible = true;
        c.icon.setFrame(this.store.frame(key), 1);
        c.icon.setSize(cell - pad * 2, cell - pad * 2);
        c.icon.setPosition(x + pad, y + pad);
      } else {
        c.icon.visible = false;
      }
    }
  }
}
