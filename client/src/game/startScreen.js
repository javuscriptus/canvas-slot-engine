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

import { Container, Sprite, Text, Rect, Custom, NineSlice } from "../engine/display.js";
import { Easing } from "../engine/core.js";
import { Button } from "./ui.js";

const GOLD = [[0, "#FFF3C4"], [0.5, "#F7C948"], [1, "#E09E1A"]];
const SKIP_KEY = "sochi.skipIntro";

export class StartScreen extends Container {
  constructor({ store, audio, i18n, layout, config, rtp, money, onPlay }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    this.config = config;
    this.rtp = rtp;
    this.money = money;
    this.onPlay = onPlay;
    this.visible = true;

    // Затемнение перехватывает нажатия: пока экран открыт, до игры
    // под ним не должно доходить ничего.
    // Почти непрозрачно. Полупрозрачная заставка просвечивала барабаны
    // и панель: логотип накладывался на логотип, а строки со статистикой
    // ложились поверх счётчиков. Заставка — отдельный экран, а не вуаль.
    this.backdrop = new Rect(layout.width, layout.height, "rgba(8,3,18,0.955)");
    this.backdrop.interactive = true;
    this.backdrop.onTap = () => {};

    this.glow = new Custom((ctx) => this._drawGlow(ctx), layout.width, layout.height);
    this.glow.interactive = false;

    this.logo = new Sprite(store.frame("logo"), 1);
    this.logo.setAnchor(0.5);

    this.playButton = new Button(store.frame("btn_spin"), {
      audio, sound: "button", onTap: () => this._play()
    });

    this.playLabel = new Text(i18n.t("introPlay"), {
      font: "700 46px Poppins, Lora, sans-serif",
      gradient: GOLD,
      stroke: "#3A1F00",
      strokeWidth: 3,
      align: "center",
      letterSpacing: 4
    });
    this.playLabel.setAnchor(0.5);

    // Сводка по игре — то, ради чего экран и нужен.
    this.factsPlate = new NineSlice(store.frame("panel"), store.frame("panel").slice || [26, 26, 26, 26], 2);
    this.facts = new Custom((ctx) => this._drawFacts(ctx), 900, 260);
    this.facts.interactive = false;

    /* ── галочка «не показывать снова» ─────────────────────────── */
    this.skip = new Container();
    this.skip.interactive = true;
    this.skip.getLocalSize = () => ({ width: 620, height: 84 });
    this.skip.onTap = () => {
      this.skipChecked = !this.skipChecked;
      this.audio.play("click");
    };
    this.skipBox = new Custom((ctx) => this._drawCheckbox(ctx), 620, 84);
    this.skip.add(this.skipBox);
    this.skipChecked = false;

    this.add(this.backdrop, this.glow, this.logo, this.playButton,
             this.playLabel, this.factsPlate, this.facts, this.skip);

    this._t = 0;
    this.applyLayout(layout);
  }

  /** Показывать ли заставку. Решение игрока живёт между сессиями. */
  static shouldShow() {
    try {
      return localStorage.getItem(SKIP_KEY) !== "1";
    } catch {
      return true;   // приватный режим — не повод ломать запуск
    }
  }

  _play() {
    try {
      localStorage.setItem(SKIP_KEY, this.skipChecked ? "1" : "0");
    } catch { /* хранилище недоступно — не беда */ }

    this._closing = true;
    this.onPlay?.();
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

    // Единица масштаба — короткая сторона: так композиция одинаково
    // держится и на узком телефоне, и на широком мониторе.
    const k = portrait ? W / 1080 : H / 1080;

    const yLogo = H * (portrait ? 0.215 : 0.22);
    const yPlay = H * (portrait ? 0.455 : 0.48);
    const yFacts = H * (portrait ? 0.635 : 0.68);
    const ySkip = H * (portrait ? 0.878 : 0.89);

    this.logo.scaleX = this.logo.scaleY = (portrait ? W * 0.80 : H * 0.62) / 1800;
    this.logo.setPosition(W / 2, yLogo);

    const btnScale = k * 1.3;
    this.playButton.setBaseScale(btnScale);
    this.playButton.scaleX = this.playButton.scaleY = btnScale;
    this.playButton.setPosition(W / 2, yPlay);

    this.playLabel.setPosition(W / 2, yPlay + 132 * btnScale);
    this.playLabel.setStyle({ font: `700 ${Math.round(46 * k)}px Poppins, Lora, sans-serif` });

    const fw = Math.min(W * 0.88, 960 * k);
    const fh = 250 * k;
    this.facts.width = fw;
    this.facts.height = fh;
    this.facts.setPosition((W - fw) / 2, yFacts);
    this.factsPlate.setSize(fw + 36 * k, fh + 28 * k);
    this.factsPlate.setPosition((W - fw) / 2 - 18 * k, yFacts - 14 * k);

    // Галочка живёт в своей системе координат 620×84 и целиком
    // масштабируется — так область нажатия растёт вместе с надписью.
    this.skipBox.width = 620;
    this.skipBox.height = 84;
    this.skip.scaleX = this.skip.scaleY = k;
    this.skip.setPosition((W - 620 * k) / 2, ySkip);
  }

  /* ─────────────────────────── отрисовка ───────────────────────── */

  _drawGlow(ctx) {
    const W = this.glow.width;
    const H = this.glow.height;
    const cx = W / 2;
    const cy = H * (this.layout.name === "portrait" ? 0.42 : 0.44);
    const r = Math.max(W, H) * 0.55;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,176,90,0.30)");
    g.addColorStop(0.45, "rgba(214,84,120,0.14)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * Три факта об игре: возврат, максимальный выигрыш и волатильность.
   * Волатильность — молниями, потому что число «7.1 сигмы» игроку
   * не говорит ничего, а пять делений — говорят.
   */
  _drawFacts(ctx) {
    const W = this.facts.width;
    const k = W / 900;
    const i18n = this.i18n;

    const rows = [
      [i18n.t("introRtp"), `${this.rtp} %`],
      [i18n.t("introMaxWin"), `${this.config.maxWinMultiplier}×`]
    ];

    ctx.textBaseline = "middle";
    let y = 34 * k;

    for (const [label, value] of rows) {
      ctx.font = `600 ${Math.round(28 * k)}px Poppins, Lora, sans-serif`;
      ctx.fillStyle = "#B9A8DA";
      ctx.textAlign = "left";
      ctx.fillText(label, 40 * k, y);

      ctx.font = `700 ${Math.round(34 * k)}px Poppins, Lora, sans-serif`;
      ctx.fillStyle = "#FFD86A";
      ctx.textAlign = "right";
      ctx.fillText(value, W - 40 * k, y);

      ctx.strokeStyle = "rgba(255,255,255,0.09)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40 * k, y + 32 * k);
      ctx.lineTo(W - 40 * k, y + 32 * k);
      ctx.stroke();

      y += 74 * k;
    }

    // Волатильность
    ctx.font = `600 ${Math.round(28 * k)}px Poppins, Lora, sans-serif`;
    ctx.fillStyle = "#B9A8DA";
    ctx.textAlign = "left";
    ctx.fillText(i18n.t("introVolatility"), 40 * k, y);

    const level = 4;                 // из пяти: σ = 7.1 — высокая
    const bw = 22 * k;
    const gap = 9 * k;
    const total = 5 * bw + 4 * gap;
    let x = W - 40 * k - total;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < level ? "#FFC24F" : "rgba(255,255,255,0.16)";
      this._bolt(ctx, x + i * (bw + gap), y - 20 * k, bw, 40 * k);
    }
  }

  _bolt(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.62, y);
    ctx.lineTo(x + w * 0.12, y + h * 0.56);
    ctx.lineTo(x + w * 0.46, y + h * 0.56);
    ctx.lineTo(x + w * 0.36, y + h);
    ctx.lineTo(x + w * 0.9, y + h * 0.4);
    ctx.lineTo(x + w * 0.54, y + h * 0.4);
    ctx.closePath();
    ctx.fill();
  }

  _drawCheckbox(ctx) {
    const box = 46;
    const y = 19;

    ctx.strokeStyle = this.skipChecked ? "#FFC24F" : "rgba(255,255,255,0.42)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(60, y, box, box, 8);
    ctx.stroke();

    if (this.skipChecked) {
      ctx.strokeStyle = "#FFC24F";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(70, y + 22);
      ctx.lineTo(80, y + 32);
      ctx.lineTo(96, y + 12);
      ctx.stroke();
    }

    ctx.fillStyle = "#C9B6E8";
    ctx.font = "600 30px Poppins, Lora, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(this.i18n.t("introSkip"), 60 + box + 22, y + box / 2);
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
      this.alpha = Math.max(0, this.alpha - dt * 3.2);
      if (this.alpha <= 0) {
        this.visible = false;
        this._closing = false;
      }
    }
  }
}
