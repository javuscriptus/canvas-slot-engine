// Модальные окна: таблица выплат, правила, автоигра, история, сообщения.

import { Container, Sprite, Text, Rect, Custom, NineSlice } from "../engine/display.js";
import { Easing, formatMoney } from "../engine/core.js";
import { Button } from "./ui.js";

const GOLD = [[0, "#FFF3C4"], [0.5, "#F7C948"], [1, "#E09E1A"]];

const CHIP_W = 150;
const CHIP_H = 66;

class Modal extends Container {
  constructor({ store, audio, i18n, layout, title, money }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    // Форматтер валюты игрока. Может отсутствовать в тестовых стендах —
    // тогда падаем на нейтральное форматирование без символа.
    this.money = money || { format: formatMoney, plain: formatMoney, fromCoins: (c) => c };
    this.visible = false;

    // Затемнение обязано ПЕРЕХВАТЫВАТЬ нажатия, а не пропускать их.
    // Пока оно было прозрачным для указателя, тап мимо окна доходил до
    // кнопки «Крутить» под ним: игрок закрывал таблицу выплат и обнаруживал,
    // что случайно поставил. Заодно закрываем окно — привычное поведение.
    this.backdrop = new Rect(layout.width, layout.height, "rgba(4,1,10,0.86)");
    this.backdrop.interactive = true;
    this.backdrop.onTap = () => this.hide();

    // Само окно тоже перехватывает нажатия — иначе тап по пустому месту
    // внутри него провалился бы на затемнение и закрыл окно.
    this.panel = new NineSlice(store.frame("panel"), store.frame("panel").slice || [26, 26, 26, 26], 2);
    this.panel.interactive = true;
    this.panel.onTap = () => {};

    this.titleText = new Text(title, {
      font: "700 44px Poppins, Lora, sans-serif",
      gradient: GOLD,
      stroke: "#3A1F00",
      strokeWidth: 3,
      align: "center",
      letterSpacing: 3
    });
    this.titleText.setAnchor(0.5);

    this.closeButton = new Button(store.frame("btn_close"), {
      audio, onTap: () => this.hide()
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

  _fade(to, done) {
    const start = this.alpha;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 180);
      this.alpha = start + (to - start) * k;
      if (k < 1) requestAnimationFrame(step);
      else if (done) done();
    };
    requestAnimationFrame(step);
  }

  update(dt) {
    this.closeButton.update(dt);
  }
}

/* ────────────────────────── таблица выплат ──────────────────────── */

export class PaytableModal extends Modal {
  constructor(opts) {
    super({ ...opts, title: opts.i18n.t("paytable") });
    this.config = opts.config;
    this.rtp = opts.rtp;
    this.page = 0;
    this._build();
  }

  _build() {
    const { i18n, config, store } = this;
    this.grid = new Custom((ctx) => this._drawGrid(ctx), 100, 100);
    this.content.add(this.grid);

    this.notes = new Text("", {
      font: "500 24px Poppins, Lora, sans-serif",
      fill: "#D9CCF0",
      align: "left",
      lineHeight: 36
    });
    this.content.add(this.notes);
  }

  applyLayout(layout) {
    super.applyLayout(layout);
    this.grid.width = this.contentSize.width;
    this.grid.height = this.contentSize.height * 0.62;
    this.notes.setPosition(0, this.contentSize.height * 0.66);
    this.notes.setStyle({
      font: layout.name === "portrait" ? "500 26px Poppins, Lora, sans-serif" : "500 24px Poppins, Lora, sans-serif"
    });
    this.notes.text = [
      this.i18n.t("wildNote"),
      this.i18n.t("scatterNote"),
      this.i18n.t("wildMultNote"),
      this.i18n.t("linesNote"),
      this.i18n.t("rtpNote", this.rtp),
      this.i18n.t("maxWinNote", this.config.maxWinMultiplier),
      this.i18n.t("malfunctionNote")
    ].join("\n");
    this.columns = layout.name === "portrait" ? 2 : 3;
  }

  _drawGrid(ctx) {
    const cfg = this.config;
    const cols = this.columns || 3;
    const entries = cfg.symbolKeys.map((key, id) => ({ key, id }));
    const rows = Math.ceil(entries.length / cols);
    const cw = this.grid.width / cols;
    const ch = this.grid.height / rows;
    const icon = Math.min(cw * 0.3, ch * 0.72);

    ctx.textBaseline = "middle";

    for (let i = 0; i < entries.length; i++) {
      const { key, id } = entries[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cw;
      const y = row * ch;

      const frame = this.store.frame(key);
      ctx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h,
        x + 6, y + (ch - icon) / 2, icon, icon);

      const tx = x + icon + 20;
      ctx.fillStyle = "#E9DDFF";
      ctx.font = "600 20px Poppins, Lora, sans-serif";
      ctx.fillText(this.i18n.symbol(key), tx, y + ch * 0.3);

      ctx.font = "700 22px Poppins, Lora, sans-serif";
      const pays = cfg.paytable[id];
      if (pays) {
        const parts = Object.keys(pays).sort((a, b) => b - a)
          .map((n) => `${n}× ${pays[n]}`);
        ctx.fillStyle = "#FFD86A";
        ctx.fillText(parts.join("   "), tx, y + ch * 0.62);
      } else if (id === cfg.scatter) {
        const parts = Object.keys(cfg.scatterPays).sort((a, b) => b - a)
          .map((n) => `${n}× ${cfg.scatterPays[n]}`);
        ctx.fillStyle = "#7CFFB0";
        ctx.fillText(parts.join("   "), tx, y + ch * 0.62);
      } else {
        ctx.fillStyle = "#FF9ED6";
        ctx.fillText("WILD", tx, y + ch * 0.62);
      }
    }
  }
}

/* ──────────────────────────── автоигра ──────────────────────────── */

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
      row.title = new Text(this.i18n.t(row.label), {
        font: "600 24px Poppins, Lora, sans-serif",
        fill: "#C9B6E8",
        align: "center",
        letterSpacing: 2
      });
      row.title.setAnchor(0.5, 0);
      this.content.add(row.title);

      // Фишки — отдельные узлы, а не рисунок на холсте: попадание по
      // холсту пришлось бы считать вручную, и это лишний источник ошибок.
      row.chips = row.options.map((value) => {
        const chip = new Container();
        chip.value = value;
        const frame = this.store.frame("panel_dark");
        const plate = new NineSlice(frame, frame.slice || [22, 22, 22, 22], 2);
        plate.setSize(CHIP_W, CHIP_H);
        const text = new Text("", {
          font: "700 28px Poppins, sans-serif",
          gradient: GOLD,
          align: "center"
        });
        text.setAnchor(0.5);
        text.setPosition(CHIP_W / 2, CHIP_H / 2);
        chip.add(plate, text);
        chip.interactive = true;
        chip.getLocalSize = () => ({ width: CHIP_W, height: CHIP_H });
        chip.onTap = () => {
          row.selected = value;
          this.audio.play("click");
          this._refreshChips();
        };
        chip.plate = plate;
        chip.text = text;
        this.content.add(chip);
        return chip;
      });
    }

    this.note = new Text(this.i18n.t("autoplayLimitsNote"), {
      font: "500 20px Poppins, Lora, sans-serif",
      fill: "#6B5C87",
      align: "center"
    });
    this.note.setAnchor(0.5, 0);
    this.content.add(this.note);

    this.startButton = new Button(this.store.frame("btn_spin"), {
      audio: this.audio,
      sound: "button",
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
        chip.text.setStyle({
          font: row.money && chip.value === 0
            ? "700 17px Poppins, sans-serif"
            : "700 26px Poppins, sans-serif"
        });
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

/* ──────────────────────────── история ──────────────────────────── */

const ROW_H = 54;

export class HistoryModal extends Modal {
  /**
   * Два экрана в одном окне: список раундов и разбор одного раунда.
   *
   * Разбор — не украшение. Регулятор требует, чтобы игрок мог увидеть
   * по номеру раунда всё: экран каждого спина, каждую сработавшую линию
   * и её вклад. Тот же экран закрывает половину обращений в поддержку
   * вида «у меня не засчитался выигрыш».
   */
  constructor(opts) {
    super({ ...opts, title: opts.i18n.t("history") });
    this.config = opts.config;
    this.onOpenRound = opts.onOpenRound || null;   // async (id) => detail

    this.rounds = [];
    this.detail = null;
    this.spinIndex = 0;

    this.list = new Custom((ctx) => this._drawList(ctx), 100, 100);
    this.list.interactive = true;
    this.list.onTap = (node, sx, sy) => this._tapList(sx, sy);
    this.content.add(this.list);

    this.detailView = new Custom((ctx) => this._drawDetail(ctx), 100, 100);
    this.detailView.visible = false;
    this.content.add(this.detailView);

    this.backButton = this._plate(this.i18n.t("roundBack"), 220, () => this.showList());
    this.prevButton = this._plate("‹", 76, () => this._step(-1));
    this.nextButton = this._plate("›", 76, () => this._step(1));
    for (const b of [this.backButton, this.prevButton, this.nextButton]) {
      b.visible = false;
      this.content.add(b);
    }
  }

  /** Маленькая кнопка-табличка: отдельный узел, чтобы попадание считал движок. */
  _plate(label, width, onTap) {
    const node = new Container();
    const frame = this.store.frame("panel_dark");
    const plate = new NineSlice(frame, frame.slice || [22, 22, 22, 22], 2);
    plate.setSize(width, 56);
    const text = new Text(label, {
      font: "700 26px Poppins, Lora, sans-serif",
      fill: "#E9DDFF",
      align: "center"
    });
    text.setAnchor(0.5);
    text.setPosition(width / 2, 28);
    node.add(plate, text);
    node.interactive = true;
    node.getLocalSize = () => ({ width, height: 56 });
    node.onTap = () => { this.audio.play("click"); onTap(); };
    return node;
  }

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
  }

  hide() {
    super.hide();
    this.showList();
  }

  _step(delta) {
    const n = this.detail?.spins?.length || 0;
    if (!n) return;
    this.spinIndex = (this.spinIndex + delta + n) % n;
  }

  _tapList(stageX, stageY) {
    if (!this.onOpenRound || !this.rounds.length) return;
    const p = this.list.worldMatrix.applyInverse(stageX, stageY, { x: 0, y: 0 });
    const i = Math.floor((p.y - ROW_H) / ROW_H);   // первая строка — заголовок
    const r = this.rounds[i];
    if (!r) return;
    this.audio.play("click");
    this.onOpenRound(r.id);
  }

  applyLayout(layout) {
    super.applyLayout(layout);
    const { width, height } = this.contentSize;
    this.list.width = width;
    this.list.height = height;
    this.detailView.width = width;
    this.detailView.height = height - 76;

    this.backButton.setPosition(0, height - 56);
    this.prevButton.setPosition(width - 76 * 2 - 16, height - 56);
    this.nextButton.setPosition(width - 76, height - 56);
  }

  /* ───────────────────────────── список ─────────────────────────── */

  _drawList(ctx) {
    ctx.textBaseline = "middle";
    ctx.font = "600 24px Poppins, Lora, sans-serif";

    ctx.fillStyle = "#6B5C87";
    ctx.font = "600 20px Poppins, Lora, sans-serif";
    ctx.fillText(this.i18n.t("roundTapHint"), 12, ROW_H / 2);
    ctx.font = "600 24px Poppins, Lora, sans-serif";

    const max = Math.floor(this.list.height / ROW_H) - 1;
    for (let i = 0; i < Math.min(this.rounds.length, max); i++) {
      const r = this.rounds[i];
      const top = (i + 1) * ROW_H;
      const y = top + ROW_H / 2;

      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(0, top, this.list.width, ROW_H);
      }

      const d = new Date(r.at);
      ctx.fillStyle = "#9C8CBF";
      ctx.fillText(d.toLocaleString(), 12, y);

      ctx.fillStyle = "#D9CCF0";
      ctx.fillText(`−${this.money.plain(r.bet)}`, this.list.width * 0.52, y);

      ctx.fillStyle = r.win > 0 ? "#7CFFB0" : "#6B5C87";
      ctx.fillText(r.win > 0 ? `+${this.money.plain(r.win)}` : "—", this.list.width * 0.74, y);

      ctx.fillStyle = "#4E4370";
      ctx.fillText("›", this.list.width - 24, y);
    }

    if (!this.rounds.length) {
      ctx.fillStyle = "#6B5C87";
      ctx.textAlign = "center";
      ctx.fillText("—", this.list.width / 2, ROW_H * 1.5);
      ctx.textAlign = "left";
    }
  }

  /* ──────────────────────────── разбор ──────────────────────────── */

  _drawDetail(ctx) {
    const d = this.detail;
    if (!d) return;
    const W = this.detailView.width;
    const H = this.detailView.height;
    ctx.textBaseline = "middle";

    // ── шапка: то, по чему раунд ищется в поддержке ─────────────
    let y = 16;
    ctx.font = "600 20px Poppins, Lora, sans-serif";
    ctx.fillStyle = "#6B5C87";
    ctx.fillText(`${this.i18n.t("roundId")}:`, 0, y);
    ctx.fillStyle = "#C9B6E8";
    ctx.font = "500 20px ui-monospace, monospace";
    ctx.fillText(d.id, 150, y);

    y += 30;
    ctx.font = "600 20px Poppins, Lora, sans-serif";
    ctx.fillStyle = "#6B5C87";
    ctx.fillText(`${this.i18n.t("roundAt")}:`, 0, y);
    ctx.fillStyle = "#C9B6E8";
    ctx.fillText(new Date(d.at).toLocaleString(), 150, y);

    ctx.fillStyle = "#6B5C87";
    ctx.fillText(`${this.i18n.t("roundRngDraws")}:`, W * 0.6, y);
    ctx.fillStyle = "#C9B6E8";
    ctx.fillText(String(d.rngDraws ?? "—"), W * 0.6 + 200, y);

    y += 38;
    ctx.font = "700 30px Poppins, Lora, sans-serif";
    ctx.fillStyle = "#D9CCF0";
    ctx.fillText(`−${this.money.format(d.bet)}`, 0, y);
    ctx.fillStyle = d.win > 0 ? "#7CFFB0" : "#6B5C87";
    ctx.fillText(d.win > 0 ? `+${this.money.format(d.win)}` : this.i18n.t("roundNoWin"), 220, y);
    if (d.capped) {
      ctx.font = "600 20px Poppins, Lora, sans-serif";
      ctx.fillStyle = "#FFB84F";
      ctx.fillText(this.i18n.t("roundCapped"), 420, y);
    }

    const spins = d.spins || [];
    const spin = spins[this.spinIndex];
    if (!spin) return;

    y += 40;
    ctx.font = "700 24px Poppins, Lora, sans-serif";
    ctx.fillStyle = "#FFD86A";
    const kind = spin.type === "base" ? this.i18n.t("roundBaseSpin") : this.i18n.t("roundFreeSpin");
    ctx.fillText(`${kind}  ${this.spinIndex + 1}/${spins.length}`, 0, y);

    y += 24;
    const gridTop = y;
    const gridH = Math.max(120, Math.min(H - gridTop - 20, 240));
    const cell = Math.min(gridH / 3, W * 0.38 / 5);
    const gridW = cell * 5;
    this._drawScreen(ctx, spin, 0, gridTop, cell);

    // ── список сработавших линий ─────────────────────────────────
    const listX = gridW + 32;
    let ly = gridTop + 14;
    ctx.font = "600 20px Poppins, Lora, sans-serif";

    const wins = spin.wins || [];
    if (!wins.length) {
      ctx.fillStyle = "#6B5C87";
      ctx.fillText(this.i18n.t("roundNoWin"), listX, ly);
    }

    for (const w of wins.slice(0, 9)) {
      const label = w.type === "scatter"
        ? this.i18n.t("roundScatterWin")
        : this.i18n.t("roundLine", w.line);
      ctx.fillStyle = "#9C8CBF";
      ctx.fillText(label, listX, ly);

      ctx.fillStyle = "#E9DDFF";
      const mult = w.multiplier > 1 ? ` ×${w.multiplier}` : "";
      ctx.fillText(`${this.i18n.symbol(w.symbolKey)} ×${w.count}${mult}`, listX + 110, ly);

      ctx.fillStyle = "#7CFFB0";
      ctx.fillText(`+${this.money.plain(w.amount)}`, listX + 340, ly);
      ly += 28;
    }
    if (wins.length > 9) {
      ctx.fillStyle = "#6B5C87";
      ctx.fillText(`… +${wins.length - 9}`, listX, ly);
    }
  }

  /** Экран спина 5×3 с подсветкой позиций, попавших в выигрыш. */
  _drawScreen(ctx, spin, x0, y0, cell) {
    const cfg = this.config;
    const lit = new Set();
    for (const w of spin.wins || []) {
      for (const p of w.positions || []) lit.add(`${p.reel}:${p.row}`);
    }

    for (let row = 0; row < 3; row++) {
      for (let reel = 0; reel < 5; reel++) {
        const x = x0 + reel * cell;
        const y = y0 + row * cell;
        const on = lit.has(`${reel}:${row}`);

        ctx.fillStyle = on ? "rgba(255,216,106,0.16)" : "rgba(255,255,255,0.04)";
        ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);

        const id = spin.screen?.[row]?.[reel];
        const key = cfg?.symbolKeys?.[id];
        const frame = key ? this.store.frame(key) : null;
        if (frame) {
          const pad = cell * 0.1;
          ctx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h,
            x + pad, y + pad, cell - pad * 2, cell - pad * 2);
        }

        if (on) {
          ctx.strokeStyle = "#FFD86A";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
        }
      }
    }
  }

  update(dt) {
    super.update(dt);
  }
}

/* ────────────────────────── всплывающие сообщения ───────────────── */

export class Toast extends Container {
  constructor({ store, layout }) {
    super();
    this.plate = new NineSlice(store.frame("panel"), store.frame("panel").slice || [26, 26, 26, 26], 2);
    this.text = new Text("", {
      font: "600 30px Poppins, Lora, sans-serif",
      fill: "#FFE9B8",
      align: "center"
    });
    this.text.setAnchor(0.5);
    this.add(this.plate, this.text);
    this.visible = false;
    this._timer = 0;
    this.layout = layout;
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
    if (this._timer < 0.4) this.alpha = Math.max(0, this._timer / 0.4);
    if (this._timer <= 0) this.visible = false;
  }
}
