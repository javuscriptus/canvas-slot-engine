// Показ выигрыша: линии, поочерёдная демонстрация комбинаций, всплывающая
// сумма, искры и передача слова сцене крупного выигрыша.
//
// Способ показа выбирает механика: линии перебираются по одной, каскад
// проигрывается шагами. Всё остальное — подсветка ячеек, частицы, баннер —
// у них общее, поэтому и живёт в одном месте.

import { Container, Text } from "../../engine/display.js";
import { Easing } from "../../engine/core.js";
import { ParticleSystem } from "../../engine/particles.js";
import { textStyle } from "../theme/styles.js";
import { PaylinesView } from "./paylines.js";
import { BigWin } from "./bigWin.js";

/* ─────────────────────── всплывающая сумма ──────────────────────── */

class WinPopup extends Container {
  constructor(theme) {
    super();
    this.label = new Text("", textStyle(theme, "winPopup"));
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
  constructor({ store, audio, i18n, theme, money, tweens, timeline,
                grid, paylines, reels, mechanic, onShake = () => {} }) {
    super();
    this.store = store;
    this.audio = audio;
    this.i18n = i18n;
    this.theme = theme;
    this.money = money;
    this.tweens = tweens;
    this.timeline = timeline;
    this.grid = grid;
    this.reels = reels;
    this.mechanic = mechanic;
    this.timings = theme.timings;

    this.lines = new PaylinesView(grid, paylines, {
      drawTime: theme.timings.paylineDraw,
      color: theme.palette.line,
      backing: theme.palette.lineBacking
    });
    this.particles = new ParticleSystem(360);
    this.popup = new WinPopup(theme);

    this.bigWin = new BigWin({
      store, audio, i18n, theme, tweens, timeline, money, onShake,
      particles: this.particles
    });

    // Затемнение крупного выигрыша лежит НИЖЕ частиц: монеты обязаны
    // сыпаться поверх него, иначе фонтан гаснет вместе со сценой.
    this.add(this.lines, this.bigWin.dim, this.particles, this.popup, this.bigWin);

    this._cycleToken = 0;
  }

  applyLayout(layout, grid) {
    this.grid = grid;
    this.lines.applyGrid(grid);
    this.particles.setSize(layout.width, layout.height);
    this.bigWin.applyLayout(layout, grid);
  }

  update(dt) {
    this.lines.update(dt);
    this.particles.update(dt);
  }

  clear() {
    this._cycleToken++;
    this.lines.clear();
    this.popup.visible = false;
    this.bigWin.cancel();
    this.reels.clearHighlight();
  }

  /**
   * Показывает выигрыш целиком, а затем — способом, который выбрала
   * механика. Перебор идёт бесконечно, пока не придёт следующий спин:
   * игрок должен иметь возможность рассмотреть каждую комбинацию.
   */
  async present(wins, { bet, totalWin, skipCycle = false, cascades = null } = {}) {
    this.clear();
    if (!wins.length) return;

    const token = ++this._cycleToken;

    // Сводка: все линии и все выигравшие ячейки сразу.
    this.reels.showWinningCells(wins.flatMap((w) => w.positions), { dim: false });
    this.lines.show(wins.filter((w) => w.type === "line").map((w) => w.line));

    const spark = this.store.frame(this.theme.atlas.particleSpark);
    for (const w of wins) {
      const p = w.positions[Math.floor(w.positions.length / 2)];
      const c = this.grid.cellCenter(p.reel, p.row);
      this.theme.effects.winSpark(this.particles, spark, c.x, c.y, this.grid.cell / 200);
    }

    const tier = this.bigWin.tierFor(totalWin, bet);
    if (tier) {
      await this.bigWin.play(tier, totalWin);
      if (token !== this._cycleToken) return;
    }

    if (skipCycle) return;

    if (this.mechanic.presentation === "cascade" && cascades?.length) {
      await this._cascade(cascades, token);
      return;
    }
    if (wins.length <= 1) return;

    // Перебор комбинаций живёт своей жизнью: игра не должна ждать,
    // пока игрок насмотрится, — следующий спин прерывает цикл сменой токена.
    this._cycle(wins, token);
  }

  /** Перебор комбинаций по одной. */
  async _cycle(wins, token) {
    await this.timeline.wait(this.timings.winCycleFirst);
    let i = 0;
    while (token === this._cycleToken) {
      const w = wins[i % wins.length];
      this.reels.showWinningCells(w.positions, { dim: true });
      this.lines.show(w.type === "line" ? [w.line] : []);
      this._popupFor(w);

      await this.timeline.wait(this.timings.winCycleStep);
      if (token !== this._cycleToken) return;
      this.popup.fade(this.tweens);
      i++;
    }
  }

  /**
   * Каскад: шаги приходят с сервера вместе с результатом. Считать их
   * самостоятельно клиент не вправе — он показал бы не тот экран,
   * за который заплачено.
   */
  async _cascade(cascades, token) {
    for (const step of cascades) {
      if (token !== this._cycleToken) return;
      this.reels.setVisibleScreen(step.screen);
      this.reels.showWinningCells((step.wins || []).flatMap((w) => w.positions), { dim: true });
      for (const w of step.wins || []) this._popupFor(w);
      this.audio.play(this.theme.sounds.winSmall);
      await this.timeline.wait(this.timings.cascadeStep);
      this.popup.fade(this.tweens);
    }
  }

  _popupFor(win) {
    const p = win.positions[Math.floor(win.positions.length / 2)];
    const c = this.grid.cellCenter(p.reel, p.row);
    // На ячейке символ валюты не пишем: место тесное, а валюта
    // и так подписана на счётчиках панели.
    const text = win.multiplier > 1
      ? `${this.money.plain(win.amount)} ×${win.multiplier}`
      : this.money.plain(win.amount);
    this.popup.popup(text, c.x, c.y - this.grid.cell * 0.6, this.tweens);
  }

  /* ─────────── сцены крупного выигрыша: слово передаётся дальше ─────── */

  playBigWin(tier, totalWin) {
    return this.bigWin.play(tier, totalWin);
  }

  announceFreeSpins(count) {
    this._cycleToken++;
    return this.bigWin.freeSpins(count);
  }

  announceBonusTotal(total) {
    this._cycleToken++;
    return this.bigWin.bonusTotal(total);
  }
}
