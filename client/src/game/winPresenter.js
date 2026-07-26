// Показ выигрыша: линии, поочерёдная демонстрация комбинаций,
// счётчик, баннеры BIG/MEGA/EPIC WIN и частицы.
//
// Порог «крупного» выигрыша считается в ставках, а не в деньгах: 50 рублей
// при ставке 1 — событие, при ставке 100 — обычный спин.

import { Container, Custom, Sprite, Text } from "../engine/display.js";
import { Easing, formatMoney, wait } from "../engine/core.js";
import { ParticleSystem, drawParticles, Bursts } from "../engine/particles.js";
import { cellCenter } from "./layout.js";

/** Время прорисовки линии от первого барабана до последнего. */
const DRAW_TIME = 0.34;

const TIERS = [
  { key: "big", threshold: 15, banner: "banner_big", sound: "win_big", duration: 3.2 },
  { key: "mega", threshold: 50, banner: "banner_mega", sound: "fanfare", duration: 4.2 },
  { key: "epic", threshold: 150, banner: "banner_epic", sound: "fanfare", duration: 5.2 }
];

/** Какому уровню соответствует выигрыш; null — обычный. */
export function winTier(win, bet) {
  if (bet <= 0) return null;
  const x = win / bet;
  let tier = null;
  for (const t of TIERS) if (x >= t.threshold) tier = t;
  return tier;
}

/* ─────────────────────────── линии выплат ───────────────────────── */

export class PaylineLayer extends Custom {
  constructor(metrics, paylines) {
    super((ctx) => this._draw(ctx), metrics.width, metrics.height);
    this.metrics = metrics;
    this.paylines = paylines;
    this.x = metrics.x;
    this.y = metrics.y;
    this.active = [];        // [{line, color, alpha}]
    this.time = 0;
    this.progress = 1;
  }

  show(lineIndexes, { color = "#FFE082", animate = true } = {}) {
    this.active = lineIndexes.map((i) => ({ line: i, color, alpha: 1 }));
    this.time = 0;
    // Линия прорисовывается слева направо — в ту же сторону,
    // в какую считается комбинация. Игрок видит не просто подсветку,
    // а как выигрыш «собрался».
    this.progress = animate ? 0 : 1;
  }

  clear() {
    this.active = [];
    this.progress = 1;
  }

  update(dt) {
    this.time += dt;
    if (this.progress < 1) this.progress = Math.min(1, this.progress + dt / DRAW_TIME);
  }

  _draw(ctx) {
    if (!this.active.length) return;
    const cell = this.metrics.cell;
    const dash = (this.time * 60) % 24;

    for (const item of this.active) {
      const pattern = this.paylines[item.line];
      if (!pattern) continue;

      // Сколько барабанов уже «пройдено» анимацией
      const reach = this.progress * (pattern.length - 1);
      ctx.beginPath();
      ctx.moveTo(cell * 0.5, cell * (pattern[0] + 0.5));
      for (let r = 1; r < pattern.length; r++) {
        const seg = Math.min(1, Math.max(0, reach - (r - 1)));
        if (seg <= 0) break;
        const px = cell * (r - 0.5);
        const py = cell * (pattern[r - 1] + 0.5);
        const nx = cell * (r + 0.5);
        const ny = cell * (pattern[r] + 0.5);
        ctx.lineTo(px + (nx - px) * seg, py + (ny - py) * seg);
      }

      // Тёмная подложка — линия обязана читаться поверх любого символа.
      ctx.lineWidth = 12;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      ctx.globalAlpha = item.alpha * 0.9;
      ctx.stroke();

      ctx.lineWidth = 6;
      ctx.strokeStyle = item.color;
      ctx.setLineDash([16, 8]);
      ctx.lineDashOffset = -dash;
      ctx.globalAlpha = item.alpha;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
}

/* ─────────────────────── всплывающая сумма ──────────────────────── */

class WinPopup extends Container {
  constructor() {
    super();
    this.label = new Text("", {
      font: "700 54px Poppins, Lora, sans-serif",
      gradient: [[0, "#FFF3C4"], [0.5, "#F7C948"], [1, "#E09E1A"]],
      stroke: "#3A1F00",
      strokeWidth: 4,
      align: "center",
      shadow: { color: "rgba(0,0,0,.7)", blur: 10, x: 0, y: 3 }
    });
    this.label.setAnchor(0.5);
    this.add(this.label);
    this.visible = false;
  }

  popup(text, x, y, tweens) {
    this.visible = true;
    this.label.text = text;
    this.setPosition(x, y);
    this.alpha = 0;
    this.scaleX = this.scaleY = 0.6;
    tweens.cancelTarget(this);
    tweens.to(this, { alpha: 1, scaleX: 1, scaleY: 1 }, { duration: 0.26, ease: Easing.backOut });
  }

  fade(tweens) {
    tweens.to(this, { alpha: 0 }, {
      duration: 0.2,
      onComplete: () => { this.visible = false; }
    });
  }
}

/* ───────────────────────── презентация выигрыша ─────────────────── */

export class WinPresenter extends Container {
  constructor({ store, audio, i18n, money, tweens, metrics, paylines, reelSet, layout, onShake = () => {} }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    this.moneyFmt = money || null;
    this.tweens = tweens;
    this.metrics = metrics;
    this.reelSet = reelSet;
    this.layout = layout;
    this.onShake = onShake;

    this.lines = new PaylineLayer(metrics, paylines);
    this.particles = new ParticleSystem(360);
    this.particleView = new Custom((ctx) => drawParticles(ctx, this.particles),
      layout.width, layout.height);
    this.popup = new WinPopup();

    this.banner = new Sprite(store.frame("banner_big"), 2);
    this.banner.setAnchor(0.5);
    this.banner.visible = false;

    this.bannerAmount = new Text("", {
      font: "700 92px Poppins, Lora, sans-serif",
      gradient: [[0, "#FFFFFF"], [0.5, "#FFE082"], [1, "#F5A623"]],
      stroke: "#3A1F00",
      strokeWidth: 6,
      align: "center",
      shadow: { color: "rgba(0,0,0,.75)", blur: 14, x: 0, y: 4 }
    });
    this.bannerAmount.setAnchor(0.5);
    this.bannerAmount.visible = false;

    this.dim = new Custom((ctx) => {
      ctx.fillStyle = `rgba(4,1,10,${this.dimAlpha})`;
      ctx.fillRect(0, 0, layout.width, layout.height);
    }, layout.width, layout.height);
    this.dimAlpha = 0;
    this.dim.visible = false;

    this.add(this.lines, this.dim, this.particleView, this.popup, this.banner, this.bannerAmount);

    this._cycleToken = 0;
  }

  applyLayout(layout, metrics) {
    this.layout = layout;
    this.metrics = metrics;
    this.lines.metrics = metrics;
    this.lines.x = metrics.x;
    this.lines.y = metrics.y;
    this.lines.width = metrics.width;
    this.lines.height = metrics.height;
    this.particleView.width = layout.width;
    this.particleView.height = layout.height;
    this.dim.width = layout.width;
    this.dim.height = layout.height;
    this.banner.setPosition(metrics.centerX, metrics.centerY - metrics.cell * 0.35);
    this.bannerAmount.setPosition(metrics.centerX, metrics.centerY + metrics.cell * 0.55);
  }

  update(dt) {
    this.lines.update(dt);
    this.particles.update(dt);
  }

  clear() {
    this._cycleToken++;
    this.lines.clear();
    this.popup.visible = false;
    this.banner.visible = false;
    this.bannerAmount.visible = false;
    this.dim.visible = false;
    this.dimAlpha = 0;
    this.reelSet.clearHighlight();
  }

  /**
   * Показывает все выигрыши разом, затем прокручивает их по очереди.
   * Перебор идёт бесконечно, пока не придёт следующий спин: игрок должен
   * иметь возможность рассмотреть каждую линию.
   */
  async present(wins, { bet, totalWin, skipCycle = false } = {}) {
    this.clear();
    if (!wins.length) return;

    const token = ++this._cycleToken;

    // Сводка: все линии и все выигравшие ячейки сразу.
    const allPositions = wins.flatMap((w) => w.positions);
    this.reelSet.showWinningCells(allPositions, { dim: false });
    this.lines.show(wins.filter((w) => w.type === "line").map((w) => w.line));

    for (const w of wins) {
      const p = w.positions[Math.floor(w.positions.length / 2)];
      const c = cellCenter(this.metrics, p.reel, p.row);
      Bursts.winSpark(this.particles, this.store.frame("p_spark"), c.x, c.y, this.metrics.cell / 200);
    }

    const tier = winTier(totalWin, bet);
    if (tier) {
      await this.playBigWin(tier, totalWin, bet);
      if (token !== this._cycleToken) return;
    }

    if (skipCycle || wins.length <= 1) return;

    // Перебор комбинаций живёт своей жизнью: игра не должна ждать,
    // пока игрок насмотрится, — следующий спин прерывает цикл сменой токена.
    this._cycle(wins, token);
  }

  async _cycle(wins, token) {
    await this._sleep(1.1);
    let i = 0;
    while (token === this._cycleToken) {
      const w = wins[i % wins.length];
      this.reelSet.showWinningCells(w.positions, { dim: true });
      this.lines.show(w.type === "line" ? [w.line] : []);

      const p = w.positions[Math.floor(w.positions.length / 2)];
      const c = cellCenter(this.metrics, p.reel, p.row);
      // На ячейке символ валюты не пишем: место тесное, а валюта
      // и так подписана на счётчиках панели.
      const text = w.multiplier > 1
        ? `${this._money(w.amount)} ×${w.multiplier}`
        : this._money(w.amount);
      this.popup.popup(text, c.x, c.y - this.metrics.cell * 0.6, this.tweens);

      await this._sleep(1.5);
      if (token !== this._cycleToken) return;
      this.popup.fade(this.tweens);
      i++;
    }
  }

  /** Баннер крупного выигрыша с докруткой суммы и фонтаном монет. */
  async playBigWin(tier, totalWin, bet) {
    const token = this._cycleToken;

    this.audio.play(tier.sound);
    this.onShake(tier.key === "epic" ? 14 : tier.key === "mega" ? 10 : 7, 0.6);
    this.dim.visible = true;
    this.tweens.to(this, { dimAlpha: 0.72 }, { duration: 0.4 });

    this.banner.setFrame(this.store.frame(tier.banner), 2);
    this.banner.visible = true;
    this.banner.alpha = 0;
    this.banner.scaleX = this.banner.scaleY = 0.5;
    this.tweens.to(this.banner, { alpha: 1, scaleX: 1, scaleY: 1 },
      { duration: 0.45, ease: Easing.backOut });

    this.bannerAmount.visible = true;
    this.bannerAmount.alpha = 1;

    // Докрутка суммы: длительность зависит от уровня, а не от величины,
    // иначе эпический выигрыш считался бы бесконечно.
    const counter = { v: 0 };
    const countDuration = tier.duration * 0.62;
    let lastTick = 0;

    this.tweens.to(counter, { v: totalWin }, {
      duration: countDuration,
      ease: Easing.quadOut,
      onUpdate: (k) => {
        this.bannerAmount.text = this._money(counter.v, true);
        // Тик каждые ~90 мс, а не каждый кадр: иначе получается шум.
        if (k - lastTick > 0.03) {
          lastTick = k;
          this.audio.play("tick", { volume: 0.35, rate: 0.9 + k * 0.6 });
        }
      }
    });

    const coinFrame = this.store.frame("p_coin");
    const starFrame = this.store.frame("p_star");
    const cx = this.metrics.centerX;
    const cy = this.metrics.centerY;

    const bursts = Math.round(tier.duration * 2.2);
    for (let i = 0; i < bursts; i++) {
      if (token !== this._cycleToken) return;
      Bursts.coinFountain(this.particles, coinFrame, cx, cy + this.metrics.height * 0.45, 18);
      if (i % 3 === 0) {
        Bursts.starSwirl(this.particles, starFrame, cx, cy, 14);
        this.audio.play("coins", { volume: 0.5 });
      }
      await this._sleep(0.42);
    }

    await this._sleep(0.6);
    if (token !== this._cycleToken) return;

    this.tweens.to(this, { dimAlpha: 0 }, { duration: 0.45 });
    this.tweens.to(this.banner, { alpha: 0, scaleY: 0.8 }, {
      duration: 0.35,
      onComplete: () => { this.banner.visible = false; this.dim.visible = false; }
    });
    this.tweens.to(this.bannerAmount, { alpha: 0 }, {
      duration: 0.35,
      onComplete: () => { this.bannerAmount.visible = false; }
    });
    await this._sleep(0.4);
  }

  /** Плашка «вы выиграли N фриспинов». */
  async announceFreeSpins(count) {
    const token = ++this._cycleToken;
    this.audio.play("freespins");
    this.onShake(9, 0.5);

    this.dim.visible = true;
    this.tweens.to(this, { dimAlpha: 0.75 }, { duration: 0.35 });

    this.banner.setFrame(this.store.frame("banner_free"), 2);
    this.banner.visible = true;
    this.banner.alpha = 0;
    this.banner.scaleX = this.banner.scaleY = 0.5;
    this.tweens.to(this.banner, { alpha: 1, scaleX: 1, scaleY: 1 },
      { duration: 0.5, ease: Easing.backOut });

    this.bannerAmount.visible = true;
    this.bannerAmount.alpha = 1;
    this.bannerAmount.text = this.i18n.t("freeSpinsCount", count);

    Bursts.starSwirl(this.particles, this.store.frame("p_star"),
      this.metrics.centerX, this.metrics.centerY, 46);

    await this._sleep(2.4);
    if (token !== this._cycleToken) return;

    this.tweens.to(this, { dimAlpha: 0 }, { duration: 0.4 });
    this.tweens.to(this.banner, { alpha: 0 }, {
      duration: 0.35,
      onComplete: () => { this.banner.visible = false; this.dim.visible = false; }
    });
    this.tweens.to(this.bannerAmount, { alpha: 0 }, {
      duration: 0.35,
      onComplete: () => { this.bannerAmount.visible = false; }
    });
    await this._sleep(0.45);
  }

  /** Итог бонусного раунда. */
  async announceBonusTotal(total) {
    const token = ++this._cycleToken;
    this.audio.play("fanfare");

    this.dim.visible = true;
    this.tweens.to(this, { dimAlpha: 0.75 }, { duration: 0.35 });

    this.banner.setFrame(this.store.frame("banner_free"), 2);
    this.banner.visible = true;
    this.banner.alpha = 1;
    this.banner.scaleX = this.banner.scaleY = 1;

    this.bannerAmount.visible = true;
    this.bannerAmount.alpha = 1;

    const counter = { v: 0 };
    this.tweens.to(counter, { v: total }, {
      duration: 1.6,
      ease: Easing.quadOut,
      onUpdate: () => { this.bannerAmount.text = this._money(counter.v, true); }
    });

    Bursts.coinFountain(this.particles, this.store.frame("p_coin"),
      this.metrics.centerX, this.metrics.centerY + this.metrics.height * 0.4, 40);

    await this._sleep(3.0);
    if (token !== this._cycleToken) return;

    this.tweens.to(this, { dimAlpha: 0 }, { duration: 0.4 });
    this.tweens.to(this.banner, { alpha: 0 }, {
      duration: 0.35,
      onComplete: () => { this.banner.visible = false; this.dim.visible = false; }
    });
    this.tweens.to(this.bannerAmount, { alpha: 0 }, {
      duration: 0.35,
      onComplete: () => { this.bannerAmount.visible = false; }
    });
    await this._sleep(0.4);
  }

  /**
   * @param withSymbol на баннере крупного выигрыша валюта нужна —
   *   именно эту цифру игрок запоминает и потом ищет в истории.
   */
  _money(value, withSymbol = false) {
    if (!this.moneyFmt) return formatMoney(value);
    return withSymbol ? this.moneyFmt.format(value) : this.moneyFmt.plain(value);
  }

  _sleep(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}
