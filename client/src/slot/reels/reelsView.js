// Набор барабанов: расписание остановок, антисипация, подсветка выигравших
// ячеек и сборка кадра.
//
// Отрисовки здесь нет — есть УЗЛЫ. Всё поле складывается в один SpriteBatch:
// игровой слой кладёт в него числа (кадр, центр, размер, прозрачность,
// поворот, режим наложения), а чем их рисовать, решает бэкенд. Раньше на
// этом месте был Custom с колбэком на ctx: двадцать пять drawImage прямо
// из игрового кода — и, как следствие, слот, приколоченный к Canvas2D.
//
// Логика вращения намеренно НЕ знает про сервер: ей отдают итоговую колонку
// символов на барабан, а как красиво до неё доехать — забота strip.js.

import { Container, Rect, SpriteBatch } from "../../engine/display.js";
import { Strip } from "./strip.js";

export class ReelsView extends Container {
  /**
   * @param opts.grid       геометрия поля (slot/grid.js)
   * @param opts.textures   подготовленные копии символов
   * @param opts.symbolPool из чего сыпать в холостую
   * @param opts.frames     кадры подсветки: { cellGlow, winFrame, rays }
   * @param opts.timings    темп из темы
   * @param opts.anticipationFill стопы градиента колонны антисипации
   */
  constructor({ grid, textures, symbolPool, frames, timings, anticipationFill }) {
    super();
    this.grid = grid;
    this.textures = textures;
    this.frames = frames;
    this.timings = timings;
    this.anticipationFill = anticipationFill;

    this.reels = Array.from({ length: grid.reels },
      (_, i) => new Strip(i, grid.rows, symbolPool, timings));

    // Клип по окну барабанов, иначе символы вылезают на оправу.
    this.clipper = new Container();
    this.field = new Container();
    this.clipper.add(this.field);
    this.add(this.clipper);

    // Колонна антисипации: наливается светом, пока барабан «думает».
    // Отдельными узлами, а не заливкой в общем колбэке, — иначе градиент
    // пересоздавался бы каждый кадр.
    this.anticipation = this.reels.map(() => {
      const bar = new Rect(0, 0, null);
      bar.visible = false;
      this.field.add(bar);
      return bar;
    });

    this.batch = new SpriteBatch();
    this.field.add(this.batch);

    this.spinElapsed = 0;
    this._schedule = null;
    this.turbo = false;

    this.highlight = new Set();       // «reel:row» выигравших ячеек
    this.highlightOrder = new Map();  // порядок вспышки, слева направо
    this.highlightTime = 0;
    this.highlightPulse = 0;
    this.dimOthers = false;

    this.applyGrid(grid);
  }

  /** Перестраивает геометрию под новую раскладку. */
  applyGrid(grid) {
    this.grid = grid;
    this.clipper.clip = grid.clipRect;
    this.field.setPosition(grid.x, grid.y);
    this.batch.setSize(grid.width, grid.height);

    for (let r = 0; r < this.anticipation.length; r++) {
      const bar = this.anticipation[r];
      bar.setPosition(r * grid.cell, 0);
      bar.width = grid.cell;
      bar.height = grid.height;
      // Описание градиента неизменяемо: бэкенд кеширует на нём готовый
      // объект. Меняется высота поля — значит нужен новый градиент.
      bar.fill = {
        type: "linear",
        x0: 0, y0: 0, x1: 0, y1: grid.height,
        stops: this.anticipationFill
      };
    }
    return this;
  }

  setVisibleScreen(screen) {
    for (let r = 0; r < this.reels.length; r++) {
      this.reels[r].setVisible(this.grid.column(screen, r));
    }
  }

  startSpin({ turbo = false } = {}) {
    this.clearHighlight();
    this.turbo = turbo;
    this.spinElapsed = 0;
    this._schedule = null;
    for (const reel of this.reels) reel.startSpin(turbo);
  }

  /**
   * Останавливает барабаны слева направо.
   *
   * Расписание ведётся по игровому времени, а не через setTimeout:
   * таймеры браузера не привязаны к кадрам, дрожат под нагрузкой и
   * душатся в фоновой вкладке — из-за этого интервалы между остановками
   * получались неровными.
   *
   * anticipationReels — барабаны, которые нужно «потомить»: это момент,
   * когда на уже остановившихся лежат почти все скаттеры и следующий
   * барабан решает судьбу бонуса.
   */
  async stopAll(screen, { turbo = false, anticipationReels = [], onReelStop = null } = {}) {
    const t = this.timings;
    const baseDelay = turbo ? t.reelStopGapTurbo : t.reelStopGap;
    // Барабаны обязаны крутиться заметное время, даже если сервер ответил
    // мгновенно. Без этого на локальном сервере (ответ за миллисекунды)
    // первый барабан начинал тормозить, не успев разогнаться, — со стороны
    // это выглядит как дёрганье, а не как вращение.
    const minSpin = turbo ? t.reelMinSpinTurbo : t.reelMinSpin;

    // Первый барабан не тормозит раньше минимального времени вращения,
    // даже если сервер ответил мгновенно.
    const firstStopAt = Math.max(this.spinElapsed, minSpin);

    this._schedule = [];
    const stops = this.reels.map((reel, i) => new Promise((resolve) => {
      const anticipate = anticipationReels.includes(i);
      if (anticipate) {
        reel.anticipating = true;
        reel.anticipationPulse = 0;
      }
      this._schedule.push({
        reel,
        index: i,
        at: firstStopAt + i * baseDelay + (anticipate ? t.anticipationHold : 0),
        anticipate,
        fired: false,
        fire: (fast) => {
          reel.anticipating = false;
          reel.onStopped = () => {
            if (onReelStop) onReelStop(i, reel);
            resolve();
          };
          reel.requestStop(this.grid.column(screen, i), {
            extraSpins: fast ? 0 : (anticipate ? 6 : 0),
            minRunwayTime: fast ? 0.18 : (turbo ? 0.26 : 0.42)
          });
        }
      });
    }));

    await Promise.all(stops);
    this._schedule = null;
  }

  /**
   * Немедленная остановка по кнопке «Стоп»: гасит запланированные
   * задержки и тормозит всё, что ещё крутится, включая барабан,
   * который тянул антисипацию.
   */
  hurry() {
    if (!this._schedule) return;
    for (const item of this._schedule) {
      if (item.fired) continue;
      item.fired = true;
      item.fire(true);
    }
  }

  /** Подсветка выигравших ячеек; остальные приглушаются. */
  showWinningCells(positions, { dim = true } = {}) {
    this.highlight.clear();
    this.highlightOrder.clear();
    // Сортировка по барабану даёт волну слева направо — в ту же сторону,
    // в какую читается сама комбинация.
    [...positions]
      .sort((a, b) => a.reel - b.reel || a.row - b.row)
      .forEach((p, i) => {
        this.highlight.add(`${p.reel}:${p.row}`);
        this.highlightOrder.set(`${p.reel}:${p.row}`, i);
      });
    this.dimOthers = dim && this.highlight.size > 0;
    this.highlightPulse = 0;
    this.highlightTime = 0;
  }

  clearHighlight() {
    this.highlight.clear();
    this.highlightOrder.clear();
    this.dimOthers = false;
  }

  get isSpinning() {
    return this.reels.some((r) => r.isMoving);
  }

  update(dt) {
    if (this.isSpinning) this.spinElapsed += dt;

    if (this._schedule) {
      for (const item of this._schedule) {
        if (!item.fired && this.spinElapsed >= item.at) {
          item.fired = true;
          item.fire(false);
        }
      }
    }

    for (const reel of this.reels) reel.update(dt);
    this.highlightPulse += dt;
    this.highlightTime += dt;

    this._build();
  }

  /* ─────────────────── сборка кадра в пакет спрайтов ──────────────── */

  /**
   * Пакет пересобирается каждый кадр целиком: содержимое зависит от позиции
   * ленты, скорости, подсветки и пульсаций — то есть меняется всё и сразу,
   * а сравнивать это с прошлым кадром дороже, чем переписать сотню чисел
   * в уже выделенные записи.
   */
  _build() {
    const grid = this.grid;
    const cell = grid.cell;
    const pulse = 0.5 + 0.5 * Math.sin(this.highlightPulse * 5);
    const raysAngle = this.highlightPulse * 0.5;
    const batch = this.batch.clear();
    const { cellGlow, winFrame, rays } = this.frames;

    for (let r = 0; r < this.reels.length; r++) {
      const reel = this.reels[r];
      const x = r * cell;
      const blur = reel.blurAmount;
      const useBlur = blur > 0.35;
      const squash = reel.landSquash;

      const bar = this.anticipation[r];
      bar.visible = reel.anticipating;
      if (reel.anticipating) bar.alpha = 0.18 + 0.16 * Math.sin(reel.anticipationPulse);

      const offset = (reel.position + reel.visualOffset) * cell;

      for (let i = 0; i < reel.cellCount; i++) {
        const symbolId = reel.cells[i];
        const y = (i - 1) * cell + offset;
        if (y + cell < -cell || y > grid.height + cell) continue;

        const row = i - 1;
        const key = `${r}:${row}`;
        const isWinner = this.highlight.has(key);
        const still = !reel.isMoving;

        let alpha = 1;
        if (this.dimOthers && !isWinner && still) alpha = 0.3;
        if (reel.isMoving) alpha = 1 - blur * 0.15;

        // Вспышка появления выигрыша: символы «выпрыгивают» по очереди
        // слева направо — так глаз успевает прочитать комбинацию.
        let popScale = 1;
        if (isWinner && still) {
          const order = this.highlightOrder.get(key) ?? 0;
          const t = this.highlightTime - order * 0.06;
          const popTime = this.timings.winPop;
          if (t > 0 && t < popTime) {
            const k = t / popTime;
            popScale = 1 + 0.3 * Math.sin(Math.PI * k) * (1 - k * 0.4);
          }
        }

        const cx = x + cell / 2;
        const cy = y + cell / 2;

        if (isWinner && still) {
          // Вращающиеся лучи за символом
          if (rays) {
            const rs = cell * (1.5 + pulse * 0.12);
            batch.add(rays, cx, cy, rs, rs, 0.2 + pulse * 0.16, raysAngle, "lighter");
          }
          // Ореол под символом должен намекать, а не забивать: символ —
          // главное, свечение лишь подсказывает, куда смотреть.
          const gs = cell * (1.1 + pulse * 0.08);
          batch.add(cellGlow, cx, cy, gs, gs, 0.26 + pulse * 0.2);
        }

        const frame = this.textures.get(symbolId, useBlur);
        const scale = popScale * (isWinner && still ? 1 + pulse * 0.05 : 1);
        const w = cell * 0.94 * scale;

        if (useBlur && !this.textures.supportsFilter) {
          // Запасной смаз для браузеров без ctx.filter: символ вытягивается
          // по ходу движения — грубее настоящего размытия, но честнее,
          // чем резкая картинка на полной скорости.
          batch.add(frame, cx, cy, w, w * (1 + blur * 0.35), alpha);
        } else {
          // Удар при приземлении сплющивает символ по вертикали
          // и слегка раздаёт по горизонтали — так делает всё, что падает.
          batch.add(frame, cx, cy, w * (2 - squash), w * squash, alpha);
        }

        if (isWinner && still) {
          const ws = cell * (0.99 + pulse * 0.04) * popScale;
          batch.add(winFrame, cx, cy, ws, ws, 0.55 + pulse * 0.4);
        }
      }
    }
  }
}
