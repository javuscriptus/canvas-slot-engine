// Панель управления: кнопки, счётчики, полоса под ними.

import { Container, Text, NineSlice } from "../../engine/display.js";
import { textStyle } from "../theme/styles.js";
import { Button } from "./button.js";
import { Meter } from "./meter.js";

export class ControlPanel extends Container {
  constructor({ store, audio, i18n, theme, money, callbacks }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    this.theme = theme;
    this.money = money;
    this.cb = callbacks;

    const art = theme.atlas;
    const f = (n) => store.frame(n);

    // Панель — не просто затемнение: золотая планка сверху и стеклянная
    // толща под ней визуально закрывают композицию снизу.
    const barFrame = f(art.panelBar);
    this.background = new NineSlice(barFrame, barFrame.slice || [8, 56, 8, 40], 2);
    this.add(this.background);

    // Утопленные табло под счётчиками
    const plateFrame = f(art.meterPlate);
    this.balancePlate = new NineSlice(plateFrame, plateFrame.slice || [30, 30, 30, 30], 2);
    this.betPlate = new NineSlice(plateFrame, plateFrame.slice || [30, 30, 30, 30], 2);
    this.winPlate = new NineSlice(plateFrame, plateFrame.slice || [30, 30, 30, 30], 2);
    this.add(this.balancePlate, this.betPlate, this.winPlate);

    // ── счётчики ──────────────────────────────────────────────────
    this.balanceMeter = new Meter(i18n.t("balance"), theme);
    this.betMeter = new Meter(i18n.t("bet"), theme);
    this.winMeter = new Meter(i18n.t("win"), theme, { emphasis: 1.15 });
    this.add(this.balanceMeter, this.betMeter, this.winMeter);

    // Форматирование задаёт валюта игрока: число знаков после запятой
    // и символ приходят с сервера, игра их не выбирает.
    const fmt = (v) => money.format(v);
    this.balanceMeter.setFormatter(fmt);
    this.betMeter.setFormatter(fmt);
    this.winMeter.setFormatter(fmt);

    // ── основные кнопки ───────────────────────────────────────────
    const snd = theme.sounds;
    const btn = (name, onTap, sound = snd.click) => new Button(f(name), { audio, sound, onTap });

    this.spinButton = btn(art.btnSpin, () => this.cb.onSpin(), snd.button);
    this.stopButton = btn(art.btnStop, () => this.cb.onStop());
    this.stopButton.visible = false;

    this.minusButton = btn(art.btnMinus, () => this.cb.onBetChange(-1));
    this.plusButton = btn(art.btnPlus, () => this.cb.onBetChange(1));

    this.turboButton = btn(art.btnTurbo, () => this.cb.onToggleTurbo());
    this.autoButton = btn(art.btnAuto, () => this.cb.onAutoplay());

    this.add(this.spinButton, this.stopButton, this.minusButton, this.plusButton,
      this.turboButton, this.autoButton);

    // ── верхние кнопки ────────────────────────────────────────────
    this.menuButton = btn(art.btnMenu, () => this.cb.onMenu());
    this.soundButton = btn(art.btnSoundOn, () => this.cb.onToggleSound());
    this.infoButton = btn(art.btnInfo, () => this.cb.onInfo());
    this.historyButton = btn(art.btnHistory, () => this.cb.onHistory());
    this.fullButton = btn(art.btnFull, () => this.cb.onToggleFullscreen());
    this.add(this.menuButton, this.soundButton, this.fullButton, this.infoButton, this.historyButton);

    // Счётчик автоигры поверх кнопки авто
    this.autoCounter = new Text("", textStyle(theme, "autoCounter"));
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
    const art = this.theme.atlas;
    this.fullButton.setFrame(this.store.frame(on ? art.btnFullExit : art.btnFull), 2);
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
    this.turboButton.tint = on ? this.theme.palette.winGlow : null;
    this.turboButton.alpha = on ? 1 : 0.85;
  }

  setSoundOn(on) {
    const art = this.theme.atlas;
    this.soundButton.setFrame(this.store.frame(on ? art.btnSoundOn : art.btnSoundOff), 2);
  }

  setAutoplay(count) {
    if (count > 0) {
      this.autoCounter.visible = true;
      this.autoCounter.text = String(count);
      this.autoButton.tint = this.theme.palette.winGlow;
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
