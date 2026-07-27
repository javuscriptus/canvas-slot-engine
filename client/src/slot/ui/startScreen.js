// Стартовый экран.
//
// Так открывается почти любой слот у крупных провайдеров, и не из
// любви к заставкам. Экран решает три задачи сразу.
//
// Первая — юридическая и продуктовая: игрок обязан увидеть RTP,
// максимальный выигрыш и волатильность ДО первой ставки. В ряде
// юрисдикций это прямое требование, в остальных — хороший тон.
//
// Вторая — техническая. Браузер не даёт запустить звук без жеста
// пользователя. Нажатие «Играть» и есть тот самый жест: без него
// первый спин прошёл бы в тишине, а игрок решил бы, что звука нет.
//
// Третья — восприятие. Игра, которая начинается сразу с барабанов,
// выглядит как страница. Пауза на секунду с логотипом превращает её
// в заведение, куда ты вошёл.
//
// Галочка «не показывать снова» обязательна: заставка, которую нельзя
// отключить, из приветствия превращается в препятствие.

import { Container, Sprite, Text, Rect, Shape, NineSlice } from "../../engine/display.js";
import { textStyle, applyTextStyle } from "../theme/styles.js";
import { Button } from "./button.js";

/**
 * Ключ хранилища именуется по теме: на одном домене оператора может стоять
 * несколько игр, и «показывать заставку» — решение про эту, а не про все.
 */
export const skipKey = (themeId) => `${themeId}.skipIntro`;

export class StartScreen extends Container {
  constructor({ store, audio, i18n, theme, layout, config, rtp, onPlay }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    this.theme = theme;
    this.config = config;
    this.rtp = rtp;
    this.onPlay = onPlay;
    this.visible = true;

    // Затемнение перехватывает нажатия: пока экран открыт, до игры
    // под ним не должно доходить ничего.
    // Почти непрозрачно. Полупрозрачная заставка просвечивала барабаны
    // и панель: логотип накладывался на логотип, а строки со статистикой
    // ложились поверх счётчиков. Заставка — отдельный экран, а не вуаль.
    this.backdrop = new Rect(layout.width, layout.height, theme.palette.introBackdrop);
    this.backdrop.interactive = true;
    this.backdrop.onTap = () => {};

    // Тёплый ореол за логотипом: радиальный градиент как ЗАЛИВКА узла,
    // а не как вызов createRadialGradient в кадре.
    this.glow = new Rect(layout.width, layout.height, null);

    this.logo = new Sprite(store.frame(theme.atlas.logo), 1);
    this.logo.setAnchor(0.5);

    this.playButton = new Button(store.frame(theme.atlas.btnSpin), {
      audio, sound: theme.sounds.button, onTap: () => this._play()
    });

    this.playLabel = new Text(i18n.t("introPlay"), textStyle(theme, "introPlay"));
    this.playLabel.setAnchor(0.5);

    // Сводка по игре — то, ради чего экран и нужен.
    const panelFrame = store.frame(theme.atlas.panel);
    this.factsPlate = new NineSlice(panelFrame, panelFrame.slice || [26, 26, 26, 26], 2);
    this.facts = new Container();
    this.factRows = [];
    for (let i = 0; i < 3; i++) {
      const label = new Text("", textStyle(theme, "introFactLabel"));
      const value = new Text("", textStyle(theme, "introFactValue"));
      const rule = new Rect(0, 1, theme.palette.rule);
      label.setAnchor(0, 0.5);
      value.setAnchor(1, 0.5);
      this.facts.add(label, value, rule);
      this.factRows.push({ label, value, rule });
    }
    // Волатильность — молниями, потому что «σ = 7.1» игроку не говорит
    // ничего, а пять делений — говорят.
    this.bolts = new Shape([]);
    this.facts.add(this.bolts);

    /* ── галочка «не показывать снова» ─────────────────────────── */
    this.skip = new Container();
    this.skip.interactive = true;
    this.skip.getLocalSize = () => ({ width: 620, height: 84 });
    this.skip.onTap = () => {
      this.skipChecked = !this.skipChecked;
      this.audio.play(theme.sounds.click);
      this._refreshSkip();
    };
    this.skipBox = new Rect(46, 46, null);
    this.skipBox.radius = 8;
    this.skipBox.strokeWidth = 3;
    this.skipBox.setPosition(60, 19);
    this.skipMark = new Shape([{
      points: [70, 41, 80, 51, 96, 31],
      stroke: theme.palette.winGlow,
      strokeWidth: 5,
      cap: "round",
      join: "round"
    }]);
    this.skipLabel = new Text(i18n.t("introSkip"), textStyle(theme, "introSkip"));
    this.skipLabel.setAnchor(0, 0.5);
    this.skipLabel.setPosition(128, 42);
    this.skip.add(this.skipBox, this.skipMark, this.skipLabel);
    this.skipChecked = false;
    this._refreshSkip();

    this.add(this.backdrop, this.glow, this.logo, this.playButton,
             this.playLabel, this.factsPlate, this.facts, this.skip);

    this._t = 0;
    this.applyLayout(layout);
  }

  /** Показывать ли заставку. Решение игрока живёт между сессиями. */
  static shouldShow(themeId) {
    try {
      return localStorage.getItem(skipKey(themeId)) !== "1";
    } catch {
      return true;   // приватный режим — не повод ломать запуск
    }
  }

  _play() {
    try {
      localStorage.setItem(skipKey(this.theme.id), this.skipChecked ? "1" : "0");
    } catch { /* хранилище недоступно — не беда */ }

    this._closing = true;
    this.onPlay?.();
  }

  _refreshSkip() {
    this.skipBox.stroke = this.skipChecked
      ? this.theme.palette.winGlow
      : this.theme.palette.checkboxOff;
    this.skipMark.visible = this.skipChecked;
  }

  applyLayout(layout) {
    this.layout = layout;
    const portrait = layout.name === "portrait";
    const W = layout.width;
    const H = layout.height;

    this.backdrop.width = W;
    this.backdrop.height = H;
    this.glow.width = W;
    this.glow.height = H;

    const cx = W / 2;
    const cy = H * (portrait ? 0.42 : 0.44);
    const r = Math.max(W, H) * 0.55;
    // Описание градиента неизменяемо — бэкенд кеширует на нём готовый
    // объект, поэтому при смене размера нужен новый.
    this.glow.fill = {
      type: "radial",
      x0: cx, y0: cy, r0: 0, x1: cx, y1: cy, r1: r,
      stops: this.theme.palette.introGlow
    };

    // Единица масштаба — короткая сторона: так композиция одинаково
    // держится и на узком телефоне, и на широком мониторе.
    const k = portrait ? W / 1080 : H / 1080;

    const yLogo = H * (portrait ? 0.215 : 0.22);
    const yPlay = H * (portrait ? 0.455 : 0.48);
    const yFacts = H * (portrait ? 0.635 : 0.68);
    const ySkip = H * (portrait ? 0.878 : 0.89);

    this.logo.scaleX = this.logo.scaleY = (portrait ? W * 0.80 : H * 0.62) / this.logo.frame.w;
    this.logo.setPosition(W / 2, yLogo);

    const btnScale = k * 1.3;
    this.playButton.setBaseScale(btnScale);
    this.playButton.scaleX = this.playButton.scaleY = btnScale;
    this.playButton.setPosition(W / 2, yPlay);

    this.playLabel.setPosition(W / 2, yPlay + 132 * btnScale);
    applyTextStyle(this.playLabel, this.theme, "introPlay", k);

    const fw = Math.min(W * 0.88, 960 * k);
    const fh = 250 * k;
    this.facts.setPosition((W - fw) / 2, yFacts);
    this.factsPlate.setSize(fw + 36 * k, fh + 28 * k);
    this.factsPlate.setPosition((W - fw) / 2 - 18 * k, yFacts - 14 * k);
    this._layoutFacts(fw, k);

    // Галочка живёт в своей системе координат 620×84 и целиком
    // масштабируется — так область нажатия растёт вместе с надписью.
    this.skip.scaleX = this.skip.scaleY = k;
    this.skip.setPosition((W - 620 * k) / 2, ySkip);
  }

  _layoutFacts(W, kOuter) {
    const k = W / 900;
    const i18n = this.i18n;

    const rows = [];
    if (this.rtp) rows.push([i18n.t("introRtp"), `${this.rtp} %`]);
    rows.push([i18n.t("introMaxWin"), `${this.config.maxWinMultiplier}×`]);
    rows.push([i18n.t("introVolatility"), null]);

    let y = 34 * k;
    for (let i = 0; i < this.factRows.length; i++) {
      const r = this.factRows[i];
      const data = rows[i];
      r.label.visible = r.value.visible = r.rule.visible = !!data;
      if (!data) continue;

      r.label.text = data[0];
      applyTextStyle(r.label, this.theme, "introFactLabel", k);
      r.label.setPosition(40 * k, y);

      r.value.visible = data[1] !== null;
      if (data[1] !== null) {
        r.value.text = data[1];
        applyTextStyle(r.value, this.theme, "introFactValue", k);
        r.value.setPosition(W - 40 * k, y);
      }

      // Разделитель не рисуется под последней строкой: линия в воздухе
      // читается как обрыв списка.
      r.rule.visible = i < rows.length - 1;
      r.rule.setPosition(40 * k, y + 32 * k);
      r.rule.width = W - 80 * k;

      if (data[1] === null) this._layoutBolts(W, k, y);
      y += 74 * k;
    }
  }

  /** Пять делений: заполненные — уровень волатильности игры. */
  _layoutBolts(W, k, y) {
    const { level, of } = this.theme.volatility;
    const bw = 22 * k;
    const gap = 9 * k;
    const x0 = W - 40 * k - (of * bw + (of - 1) * gap);
    const h = 40 * k;
    const top = y - 20 * k;

    this.bolts.paths = Array.from({ length: of }, (_, i) => {
      const x = x0 + i * (bw + gap);
      return {
        points: [
          x + bw * 0.62, top,
          x + bw * 0.12, top + h * 0.56,
          x + bw * 0.46, top + h * 0.56,
          x + bw * 0.36, top + h,
          x + bw * 0.90, top + h * 0.40,
          x + bw * 0.54, top + h * 0.40
        ],
        closed: true,
        fill: i < level ? this.theme.palette.gaugeOn : this.theme.palette.gaugeOff
      };
    });
  }

  update(dt) {
    if (!this.visible) return;
    this._t += dt;
    this.playButton.update(dt);

    // Лёгкое дыхание кнопки: единственный движущийся объект на экране,
    // и он же — то, что нужно нажать.
    const pulse = 1 + 0.035 * Math.sin(this._t * 2.4);
    this.playButton.scaleX = this.playButton.scaleY =
      this.playButton._baseScale * pulse * (this.playButton._targetScale || 1);

    if (this._closing) {
      this.alpha = Math.max(0, this.alpha - dt / this.theme.timings.introFade);
      if (this.alpha <= 0) {
        this.visible = false;
        this._closing = false;
      }
    }
  }
}
