// Панель управления: кнопки, счётчики, индикатор фриспинов.

import { Container, Sprite, Text, Rect, NineSlice, Custom } from "../engine/display.js";
import { formatMoney, Easing, clamp } from "../engine/core.js";

const GOLD_GRADIENT = [
  [0, "#FFF3C4"], [0.35, "#F7C948"], [0.6, "#FFF3C4"], [1, "#E09E1A"]
];

/* ──────────────────────────── кнопка ────────────────────────────── */

export class Button extends Sprite {
  constructor(frame, { scaleFactor = 2, onTap = null, sound = "click", audio = null } = {}) {
    super(frame, scaleFactor);
    this.setAnchor(0.5);
    this.interactive = true;
    this.enabled = true;
    this._baseScale = 1;
    this._tapHandler = onTap;
    this._sound = sound;
    this._audio = audio;
    this._targetScale = 1;

    this.onDown = () => {
      if (!this.enabled) return;
      this._targetScale = 0.92;
    };
    this.onUp = () => {
      this._targetScale = this._isHover ? 1.05 : 1;
    };
    this.onOver = () => {
      if (!this.enabled) return;
      this._targetScale = 1.05;
    };
    this.onOut = () => {
      this._targetScale = 1;
    };
    this.onTap = () => {
      if (!this.enabled) return;
      if (this._audio && this._sound) this._audio.play(this._sound);
      if (this._tapHandler) this._tapHandler(this);
    };
  }

  setBaseScale(v) {
    this._baseScale = v;
    return this;
  }

  setEnabled(v) {
    this.enabled = v;
    this.alpha = v ? 1 : 0.42;
    this.interactive = v;
    if (!v) this._targetScale = 1;
    return this;
  }

  /** Плавная реакция на наведение и нажатие — без твинов, каждый кадр. */
  update(dt) {
    const target = this._targetScale * this._baseScale;
    const k = 1 - Math.exp(-22 * dt);
    this.scaleX += (target - this.scaleX) * k;
    this.scaleY = this.scaleX;
  }
}

/* ──────────────────────────── счётчик ───────────────────────────── */

/**
 * Показатель «подпись + значение». Значение умеет плавно докручиваться —
 * баланс, изменившийся скачком, читается как ошибка, а не как выигрыш.
 */
export class Meter extends Container {
  constructor(label, { width = 300, align = "center", valueSize = 40, labelSize = 20 } = {}) {
    super();
    this.labelNode = new Text(label, {
      font: `600 ${labelSize}px Poppins, Lora, sans-serif`,
      fill: "#C9B6E8",
      align: "center",
      letterSpacing: 2
    });
    this.labelNode.setAnchor(0.5, 0.5);
    this.labelNode.y = -22;

    this.valueNode = new Text("0.00", {
      font: `700 ${valueSize}px Poppins, Lora, sans-serif`,
      gradient: GOLD_GRADIENT,
      stroke: "#3A1F00",
      strokeWidth: 2,
      align: "center",
      shadow: { color: "rgba(0,0,0,.6)", blur: 6, x: 0, y: 2 }
    });
    this.valueNode.setAnchor(0.5, 0.5);
    this.valueNode.y = 16;

    this.add(this.labelNode, this.valueNode);

    this._value = 0;
    this._display = 0;
    this._formatter = (v) => formatMoney(v);
    this._rate = 0;
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

/* ───────────────────── индикатор фриспинов ─────────────────────── */

export class FreeSpinBadge extends Container {
  constructor(store, i18n) {
    super();
    this.i18n = i18n;
    this.visible = false;

    this.plate = new NineSlice(store.frame("panel"), store.frame("panel").slice || [26, 26, 26, 26], 2);
    this.plate.setSize(420, 96);
    this.plate.x = -210;
    this.plate.y = -48;

    this.label = new Text("", {
      font: "700 30px Poppins, Lora, sans-serif",
      gradient: GOLD_GRADIENT,
      stroke: "#3A1F00",
      strokeWidth: 2,
      align: "center",
      letterSpacing: 2
    });
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

/* ────────────────────────── панель управления ───────────────────── */

export class ControlPanel extends Container {
  constructor({ store, audio, i18n, config, money, callbacks }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    this.config = config;
    this.money = money || null;
    this.cb = callbacks;

    const f = (n) => store.frame(n);

    // Панель — не просто затемнение: золотая планка сверху и стеклянная
    // толща под ней визуально закрывают композицию снизу.
    const barFrame = store.frame("panel_bar");
    this.background = new NineSlice(barFrame, barFrame.slice || [8, 56, 8, 40], 2);
    this.add(this.background);

    // Утопленные табло под счётчиками
    const plateFrame = store.frame("meter_plate");
    this.balancePlate = new NineSlice(plateFrame, plateFrame.slice || [30, 30, 30, 30], 2);
    this.betPlate = new NineSlice(plateFrame, plateFrame.slice || [30, 30, 30, 30], 2);
    this.winPlate = new NineSlice(plateFrame, plateFrame.slice || [30, 30, 30, 30], 2);
    this.add(this.balancePlate, this.betPlate, this.winPlate);

    // ── счётчики ──────────────────────────────────────────────────
    this.balanceMeter = new Meter(i18n.t("balance"));
    this.betMeter = new Meter(i18n.t("bet"));
    this.winMeter = new Meter(i18n.t("win"), { valueSize: 46 });
    this.add(this.balanceMeter, this.betMeter, this.winMeter);

    // Форматирование задаёт валюта игрока: число знаков после запятой
    // и символ приходят с сервера, игра их не выбирает.
    if (money) {
      const fmt = (v) => money.format(v);
      this.balanceMeter.setFormatter(fmt);
      this.betMeter.setFormatter(fmt);
      this.winMeter.setFormatter(fmt);
    }

    // ── основные кнопки ───────────────────────────────────────────
    this.spinButton = new Button(f("btn_spin"), { audio, sound: "button", onTap: () => this.cb.onSpin() });
    this.stopButton = new Button(f("btn_stop"), { audio, sound: "click", onTap: () => this.cb.onStop() });
    this.stopButton.visible = false;

    this.minusButton = new Button(f("btn_minus"), { audio, onTap: () => this.cb.onBetChange(-1) });
    this.plusButton = new Button(f("btn_plus"), { audio, onTap: () => this.cb.onBetChange(1) });

    this.turboButton = new Button(f("btn_turbo"), { audio, onTap: () => this.cb.onToggleTurbo() });
    this.autoButton = new Button(f("btn_auto"), { audio, onTap: () => this.cb.onAutoplay() });

    this.add(this.spinButton, this.stopButton, this.minusButton, this.plusButton,
      this.turboButton, this.autoButton);

    // ── верхние кнопки ────────────────────────────────────────────
    this.menuButton = new Button(f("btn_menu"), { audio, onTap: () => this.cb.onMenu() });
    this.soundButton = new Button(f("btn_sound_on"), { audio, onTap: () => this.cb.onToggleSound() });
    this.infoButton = new Button(f("btn_info"), { audio, onTap: () => this.cb.onInfo() });
    this.historyButton = new Button(f("btn_history"), { audio, onTap: () => this.cb.onHistory() });
    this.fullButton = new Button(f("btn_full"), { audio, onTap: () => this.cb.onToggleFullscreen() });
    this.add(this.menuButton, this.soundButton, this.fullButton, this.infoButton, this.historyButton);

    // Счётчик автоигры поверх кнопки авто
    this.autoCounter = new Text("", {
      font: "700 26px Poppins, sans-serif",
      fill: "#FFFFFF",
      stroke: "#000000",
      strokeWidth: 3,
      align: "center"
    });
    this.autoCounter.setAnchor(0.5);
    this.autoCounter.visible = false;
    this.add(this.autoCounter);

    this.buttons = [
      this.spinButton, this.stopButton, this.minusButton, this.plusButton,
      this.turboButton, this.autoButton, this.menuButton, this.soundButton,
      this.fullButton, this.infoButton, this.historyButton
    ];
  }

  applyLayout(layout) {
    const p = layout.panel;
    this.background.setSize(p.width, p.height);
    this.background.setPosition(p.x, p.y);

    const m = layout.meters;
    this.balanceMeter.setPosition(m.balance.x, m.balance.y);
    this.betMeter.setPosition(m.bet.x, m.bet.y);
    this.winMeter.setPosition(m.win.x, m.win.y);

    const plate = layout.meterPlate || { width: 300, height: 104 };
    for (const [node, pos] of [
      [this.balancePlate, m.balance], [this.betPlate, m.bet], [this.winPlate, m.win]
    ]) {
      node.setSize(plate.width, plate.height);
      node.setPosition(pos.x - plate.width / 2, pos.y - plate.height / 2);
    }

    // Масштаб каждой кнопки берётся из раскладки. В портрете холст
    // мельче почти втрое, а палец у игрока тот же, поэтому там свои
    // множители — иначе кнопка выходит вдвое меньше пригодной для касания.
    const place = (btn, pos, fallback = 1) => {
      btn.setPosition(pos.x, pos.y);
      btn.setBaseScale(pos.scale ?? fallback);
    };

    place(this.spinButton, layout.spinButton);
    place(this.stopButton, layout.spinButton);
    place(this.minusButton, layout.betButtons.minus);
    place(this.plusButton, layout.betButtons.plus);
    place(this.turboButton, layout.sideButtons.turbo);
    place(this.autoButton, layout.sideButtons.auto);
    this.autoCounter.setPosition(layout.sideButtons.auto.x, layout.sideButtons.auto.y + 2);

    const t = layout.topButtons;
    place(this.menuButton, t.menu);
    place(this.soundButton, t.sound);
    place(this.infoButton, t.info);
    place(this.historyButton, t.history);
    if (t.full) place(this.fullButton, t.full);
    this.fullButton.visible = !!t.full;
  }

  setFullscreen(on) {
    this.fullButton.setFrame(this.store.frame(on ? "btn_full_exit" : "btn_full"), 2);
  }

  setSpinning(spinning, { canStop = true } = {}) {
    this.spinButton.visible = !spinning;
    this.stopButton.visible = spinning && canStop;
    this.spinButton.setEnabled(!spinning);
    this.stopButton.setEnabled(spinning && canStop);
    this.minusButton.setEnabled(!spinning);
    this.plusButton.setEnabled(!spinning);
    this.autoButton.setEnabled(true);
  }

  setBetControlsEnabled(v) {
    this.minusButton.setEnabled(v);
    this.plusButton.setEnabled(v);
  }

  setTurbo(on) {
    this.turboButton.tint = on ? "#FFD86A" : null;
    this.turboButton.alpha = on ? 1 : 0.85;
  }

  setSoundOn(on) {
    this.soundButton.setFrame(this.store.frame(on ? "btn_sound_on" : "btn_sound_off"), 2);
  }

  setAutoplay(count) {
    if (count > 0) {
      this.autoCounter.visible = true;
      this.autoCounter.text = String(count);
      this.autoButton.tint = "#FFD86A";
    } else {
      this.autoCounter.visible = false;
      this.autoButton.tint = null;
    }
  }

  update(dt) {
    for (const b of this.buttons) b.update(dt);
    this.balanceMeter.update(dt);
    this.betMeter.update(dt);
    this.winMeter.update(dt);
  }
}
