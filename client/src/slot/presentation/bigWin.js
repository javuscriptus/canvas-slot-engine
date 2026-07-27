// Крупный выигрыш, объявление фриспинов и итог бонуса.
//
// Все три сцены устроены одинаково: затемнение, баннер, докрутка суммы,
// частицы — поэтому и живут вместе. Порог «крупного» считается в СТАВКАХ,
// а не в деньгах: 50 рублей при ставке 1 — событие, при ставке 100 —
// обычный спин.

import { Container, Rect, Sprite, Text } from "../../engine/display.js";
import { Easing } from "../../engine/core.js";
import { textStyle } from "../theme/styles.js";

/** Какому уровню соответствует выигрыш; null — обычный. */
export function winTier(win, bet, tiers) {
  if (bet <= 0) return null;
  const x = win / bet;
  let tier = null;
  for (const t of tiers) if (x >= t.threshold) tier = t;
  return tier;
}

export class BigWin extends Container {
  /**
   * @param opts.theme тема целиком: уровни выигрыша, кадры, темп, палитра
   */
  constructor({ store, audio, i18n, theme, tweens, timeline, particles,
                money, onShake = () => {} }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    this.tweens = tweens;
    this.timeline = timeline;
    this.effects = theme.effects;
    this.particles = particles;
    this.tiers = theme.winTiers;
    this.art = theme.atlas;
    this.sounds = theme.sounds;
    this.timings = theme.timings;
    this.money = money;
    this.onShake = onShake;

    // Затемнение — обычный прямоугольник с анимируемой прозрачностью.
    // Раньше здесь был колбэк на ctx, который каждый кадр заливал экран
    // цветом с подставленной альфой: ровно та же заливка, только мимо
    // графа сцены и мимо любого бэкенда, кроме Canvas2D.
    this.dim = new Rect(0, 0, theme.palette.bannerDim);
    this.dim.visible = false;
    this.dim.alpha = 0;

    this.banner = new Sprite(store.frame(this.tiers[0].banner), 2);
    this.banner.setAnchor(0.5);
    this.banner.visible = false;

    this.amount = new Text("", textStyle(theme, "bannerAmount"));
    this.amount.setAnchor(0.5);
    this.amount.visible = false;

    this.add(this.dim, this.banner, this.amount);
    this._token = 0;
  }

  applyLayout(layout, grid) {
    this.layout = layout;
    this.grid = grid;
    this.dim.width = layout.width;
    this.dim.height = layout.height;
    this.banner.setPosition(grid.centerX, grid.centerY - grid.cell * 0.35);
    this.amount.setPosition(grid.centerX, grid.centerY + grid.cell * 0.55);
  }

  /** Уровень выигрыша по таблице темы. */
  tierFor(win, bet) {
    return winTier(win, bet, this.tiers);
  }

  /** Обрывает сцену: следующий спин не обязан ждать, пока доиграет этот. */
  cancel() {
    this._token++;
    this.banner.visible = false;
    this.amount.visible = false;
    this.dim.visible = false;
    this.dim.alpha = 0;
  }

  /* ────────────────────────── сцены ───────────────────────────── */

  /** Баннер крупного выигрыша с докруткой суммы и фонтаном монет. */
  async play(tier, totalWin) {
    const token = ++this._token;

    this.audio.play(tier.sound);
    this.onShake(tier.shake ?? 7, 0.6);
    this._showBanner(tier.banner, this.timings.bannerIn);

    // Докрутка суммы: длительность зависит от уровня, а не от величины,
    // иначе эпический выигрыш считался бы бесконечно.
    const counter = { v: 0 };
    let lastTick = 0;
    this.tweens.to(counter, { v: totalWin }, {
      duration: tier.duration * 0.62,
      ease: Easing.quadOut,
      onUpdate: (k) => {
        this.amount.text = this.money.format(counter.v);
        // Тик каждые ~90 мс, а не каждый кадр: иначе получается шум.
        if (k - lastTick > 0.03) {
          lastTick = k;
          this.audio.play(this.sounds.tick, { volume: 0.35, rate: 0.9 + k * 0.6 });
        }
      }
    });

    const coin = this.store.frame(this.art.particleCoin);
    const star = this.store.frame(this.art.particleStar);
    const cx = this.grid.centerX;
    const cy = this.grid.centerY;

    const bursts = Math.round(tier.duration * 2.2);
    for (let i = 0; i < bursts; i++) {
      if (token !== this._token) return;
      this.effects.coinFountain(this.particles, coin, cx, cy + this.grid.height * 0.45, 18);
      if (i % 3 === 0) {
        this.effects.starSwirl(this.particles, star, cx, cy, 14);
        this.audio.play(this.sounds.coins, { volume: 0.5 });
      }
      await this.timeline.wait(this.timings.bannerFade);
    }

    await this.timeline.wait(this.timings.bannerHold);
    if (token !== this._token) return;
    await this._hideBanner();
  }

  /** Плашка «вы выиграли N фриспинов». */
  async freeSpins(count) {
    const token = ++this._token;
    this.audio.play(this.sounds.freeSpins);
    this.onShake(9, 0.5);

    this._showBanner(this.art.bannerFree, this.timings.bannerIn);
    this.amount.text = this.i18n.t("freeSpinsCount", count);

    this.effects.starSwirl(this.particles, this.store.frame(this.art.particleStar),
      this.grid.centerX, this.grid.centerY, 46);

    await this.timeline.wait(this.timings.freeSpinsAnnounce);
    if (token !== this._token) return;
    await this._hideBanner();
  }

  /** Итог бонусного раунда. */
  async bonusTotal(total) {
    const token = ++this._token;
    this.audio.play(this.sounds.fanfare);

    this._showBanner(this.art.bannerFree, 0);

    const counter = { v: 0 };
    this.tweens.to(counter, { v: total }, {
      duration: this.timings.bonusTotalCount,
      ease: Easing.quadOut,
      onUpdate: () => { this.amount.text = this.money.format(counter.v); }
    });

    this.effects.coinFountain(this.particles, this.store.frame(this.art.particleCoin),
      this.grid.centerX, this.grid.centerY + this.grid.height * 0.4, 40);

    await this.timeline.wait(this.timings.bonusTotalHold);
    if (token !== this._token) return;
    await this._hideBanner();
  }

  /* ───────────────────────── общая механика ───────────────────── */

  /** @param appear 0 — показать сразу, иначе длительность выезда */
  _showBanner(frameName, appear) {
    this.dim.visible = true;
    this.tweens.to(this.dim, { alpha: 0.74 }, { duration: this.timings.bannerDim });

    this.banner.setFrame(this.store.frame(frameName), 2);
    this.banner.visible = true;
    this.amount.visible = true;
    this.amount.alpha = 1;

    if (appear > 0) {
      this.banner.alpha = 0;
      this.banner.scaleX = this.banner.scaleY = 0.5;
      this.tweens.to(this.banner, { alpha: 1, scaleX: 1, scaleY: 1 },
        { duration: appear, ease: Easing.backOut });
    } else {
      this.banner.alpha = 1;
      this.banner.scaleX = this.banner.scaleY = 1;
    }
  }

  async _hideBanner() {
    const { bannerIn, bannerOut, bannerFade } = this.timings;
    this.tweens.to(this.dim, {
      alpha: 0
    }, { duration: bannerIn, onComplete: () => { this.dim.visible = false; } });
    this.tweens.to(this.banner, { alpha: 0, scaleY: 0.8 }, {
      duration: bannerOut,
      onComplete: () => { this.banner.visible = false; }
    });
    this.tweens.to(this.amount, { alpha: 0 }, {
      duration: bannerOut,
      onComplete: () => { this.amount.visible = false; }
    });
    await this.timeline.wait(bannerFade);
  }
}
