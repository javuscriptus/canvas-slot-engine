// Барабаны: физика прокрутки, размытие в движении, последовательная
// остановка, антисипация и подсветка выигравших ячеек.
//
// Логика вращения намеренно НЕ знает про сервер: ей отдают три итоговых
// символа на барабан, а как красиво до них доехать — её забота.

import { Container, Custom, Sprite } from "../engine/display.js";
import { Easing, clamp, randInt, lerp } from "../engine/core.js";
import { prescale } from "../engine/texture.js";

const VISIBLE_ROWS = 3;
const BUFFER = 2;                 // одна ячейка сверху и одна снизу для плавности
const CELLS = VISIBLE_ROWS + BUFFER;

/** Скорость вращения в символах в секунду. */
const SPEED = { normal: 26, turbo: 40 };

/** Длительность возврата из проскока — визуальный хвост остановки. */
const SETTLE_TIME = 0.2;

/** «Замах»: барабан подаётся вверх перед стартом, как механический. */
const KICK_TIME = 0.18;
const KICK_AMP = 0.16;

/** Удар при приземлении: символы сжимаются по вертикали и отыгрывают назад. */
const LAND_TIME = 0.34;
const LAND_AMP = 0.13;

/** Вспышка выигравшего символа. */
const POP_TIME = 0.42;

/**
 * Барабаны обязаны крутиться заметное время, даже если сервер ответил
 * мгновенно. Без этого на локальном сервере (ответ за миллисекунды)
 * первый барабан начинал тормозить, не успев разогнаться, — со стороны
 * это выглядит как дёрганье, а не как вращение.
 */
const MIN_SPIN_TIME = { normal: 0.85, turbo: 0.34 };

/* ─────────────────────── текстуры символов ──────────────────────── */

/**
 * Готовит для каждого символа обычную и «смазанную» копии ровно того
 * размера, каким символ окажется на экране.
 *
 * Почему не рисовать прямо из атласа. Символ в атласе — 512×512, а ячейка
 * барабана на типичном экране — около 300 пикселей. Canvas2D не умеет
 * мип-мапы, поэтому такое сжатие пересчитывается заново в каждом кадре
 * пятнадцать раз подряд: и дорого, и мылко — фильтр берёт слишком мало
 * отсчётов. Подготовленная копия решает обе проблемы сразу.
 *
 * Размытие тоже считается заранее: ctx.filter — самая дорогая операция
 * Canvas2D, в кадре её быть не должно. Если браузер filter не поддерживает,
 * смаз подменяется вертикальным растягиванием при отрисовке.
 */
export class SymbolTextures {
  constructor(store, symbolIds, cellDesign) {
    this.store = store;
    this.ids = symbolIds;
    this.normal = new Map();
    this.blurred = new Map();

    const probe = document.createElement("canvas").getContext("2d");
    probe.filter = "blur(2px)";
    this.supportsFilter = probe.filter === "blur(2px)";

    this.cellDesign = cellDesign;
    this.pixelScale = 0;
    this.rebuild(1, cellDesign);
  }

  /**
   * @param {number} pixelScale во сколько раз дизайнерский пиксель крупнее
   *                            на холсте (scale × devicePixelRatio)
   * @param {number} cellDesign размер ячейки в дизайнерских пикселях
   */
  rebuild(pixelScale, cellDesign = this.cellDesign) {
    // Небольшие изменения игнорируем: пересборка двух десятков текстур
    // на каждый пиксель перетаскивания границы окна — заметный рывок.
    if (
      Math.abs(pixelScale - this.pixelScale) < 0.06 &&
      cellDesign === this.cellDesign &&
      this.normal.size > 0
    ) return false;

    this.pixelScale = pixelScale;
    this.cellDesign = cellDesign;

    // 1.10 — запас на пульсацию выигравшего символа, чтобы при увеличении
    // он не начинал мылить.
    const target = Math.max(48, Math.round(cellDesign * 0.94 * 1.1 * pixelScale));

    this.normal.clear();
    this.blurred.clear();

    for (const id of this.ids) {
      const frame = this.store.symbolFrame(id);
      const scaled = prescale(frame, target, target);
      this.normal.set(id, scaled);
      this.blurred.set(id, this.supportsFilter ? this._blur(scaled, target) : scaled);
    }
    return true;
  }

  _blur(frame, size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    // Радиус пропорционален размеру: на маленьком экране шесть пикселей
    // размыли бы символ до неузнаваемости.
    ctx.filter = `blur(${Math.max(2, size * 0.022).toFixed(1)}px)`;
    ctx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h, 0, 0, size, size);
    return { image: c, x: 0, y: 0, w: size, h: size };
  }

  get(id, blurred) {
    return (blurred ? this.blurred : this.normal).get(id) || this.normal.get(id);
  }
}

/* ──────────────────────────── барабан ───────────────────────────── */

class Reel {
  constructor(index, symbolPool) {
    this.index = index;
    this.symbolPool = symbolPool;

    // cells[0] — над окном, [1..3] — видимые ряды, [4] — под окном
    this.cells = Array.from({ length: CELLS }, () => this._random());
    this.position = 0;        // дробная часть прокрутки, [0, 1)
    this.total = 0;           // сколько символов прокручено с начала спина
    this.velocity = 0;
    this.state = "idle";      // idle | accel | spin | stopping | settle

    // Чисто визуальные величины: в бухгалтерию ленты не входят,
    // поэтому не могут сбить выпавшие символы.
    this.visualOffset = 0;    // «замах» перед стартом, в долях ячейки
    this.kickTime = KICK_TIME;
    this.landTime = LAND_TIME;

    this.feed = [];           // символы, которые обязаны выпасть при остановке
    this.shiftsLeft = 0;
    this.stopTween = null;
    this.anticipating = false;
    this.anticipationPulse = 0;
    this.onStopped = null;
  }

  _random() {
    return this.symbolPool[randInt(0, this.symbolPool.length - 1)];
  }

  get visible() {
    return [this.cells[1], this.cells[2], this.cells[3]];
  }

  /** Мгновенно выставляет видимые символы — для восстановления сессии. */
  setVisible(symbols) {
    this.cells[0] = this._random();
    this.cells[1] = symbols[0];
    this.cells[2] = symbols[1];
    this.cells[3] = symbols[2];
    this.cells[4] = this._random();
    this.position = 0;
    this.state = "idle";
  }

  startSpin(turbo) {
    this.state = "accel";
    this.velocity = 0;
    this.targetSpeed = turbo ? SPEED.turbo : SPEED.normal;
    this.total = 0;
    this.feed = [];
    this.shiftsLeft = 0;
    this.anticipating = false;
    this.kickTime = 0;
    this.landTime = LAND_TIME;
  }

  /**
   * Просит барабан остановиться на заданных символах.
   *
   * Движение строится так, чтобы скорость нигде не рвалась:
   *
   *   1. Торможение с постоянным замедлением (quadOut). Длительность
   *      считается из текущей скорости как T = 2·S/v — при таком T
   *      начальная скорость кривой в точности равна той, с которой
   *      барабан крутился. Раньше здесь стоял quintOut фиксированной
   *      длительности, и в момент начала остановки скорость скачком
   *      росла в два с половиной раза: это и был главный рывок.
   *
   *   2. Барабан осознанно проскакивает точку остановки на доли ячейки
   *      и мягко возвращается. Отскок живёт внутри той же координаты,
   *      а не подмешивается отдельным смещением, поэтому не даёт
   *      мгновенного прыжка на старте.
   *
   * Проскок меньше одной ячейки, поэтому лишних сдвигов ленты не
   * происходит и итоговые символы остаются теми, что прислал сервер.
   */
  requestStop(symbols, { extraSpins = 0, minRunwayTime = 0.42 } = {}) {
    if (this.state === "stopping" || this.state === "settle") return;

    const v = Math.max(4, this.velocity);
    const overshoot = clamp(v * 0.006, 0.05, 0.16);

    const wanted = (v * minRunwayTime) / 2 + extraSpins;
    const start = this.total;
    let target = Math.ceil(start + Math.max(2, wanted));

    // Ленте нужно ЧЕТЫРЕ сдвига, чтобы три результатных символа встали
    // в видимое окно (cells[1..3]), а четвёртым ушёл наполнитель в cells[0].
    // Меньше — и часть результата просто не успевает доехать: на экране
    // остаются символы от предыдущего спина.
    //
    // Так и ловилась редкая ошибка по кнопке «Стоп»: при коротком разбеге
    // (minRunwayTime 0.18) и почти целом this.total выходило три сдвига,
    // и барабан вставал на чужих символах. Промах был не визуальный —
    // игрок видел не тот экран, который прислал сервер.
    const MIN_SHIFTS = 4;
    if (target - Math.floor(start) < MIN_SHIFTS) {
      target = Math.floor(start) + MIN_SHIFTS;
    }

    const distance = target + overshoot - start;
    const shifts = target - Math.floor(start);

    // Лента набивается ровно под число сдвигов: длиннее — хвост не успеет
    // сойти, короче — на его место встанут случайные символы.
    this.feed = [];
    for (let i = 0; i < shifts - 4; i++) this.feed.push(this._random());
    this.feed.push(symbols[2], symbols[1], symbols[0], this._random());
    this.shiftsLeft = shifts;

    this.state = "stopping";
    this.stopTween = {
      from: start,
      to: target + overshoot,
      settleTo: target,
      time: 0,
      duration: clamp((2 * distance) / v, 0.16, 1.1)
    };
  }

  update(dt) {
    switch (this.state) {
      case "accel":
        this.velocity = Math.min(this.targetSpeed, this.velocity + this.targetSpeed * 4 * dt);
        if (this.velocity >= this.targetSpeed) this.state = "spin";
        this._setTotal(this.total + this.velocity * dt);
        break;

      case "spin":
        this._setTotal(this.total + this.velocity * dt);
        break;

      case "stopping": {
        const t = this.stopTween;
        t.time += dt;
        const k = Math.min(1, t.time / t.duration);
        const next = lerp(t.from, t.to, Easing.quadOut(k));
        // Скорость нужна для степени смаза: барабан тормозит — смаз спадает.
        this.velocity = dt > 0 ? Math.max(0, (next - this.total) / dt) : 0;
        this._setTotal(next);

        if (k >= 1) {
          this.velocity = 0;
          this.state = "settle";
          this.settleTime = 0;
          this.landTime = 0;
          // Символы уже на местах: звук и логика продолжают отсюда,
          // а возврат из проскока остаётся чисто визуальным хвостом.
          if (this.onStopped) {
            const cb = this.onStopped;
            this.onStopped = null;
            cb(this);
          }
        }
        break;
      }

      case "settle": {
        const t = this.stopTween;
        this.settleTime += dt;
        const k = Math.min(1, this.settleTime / SETTLE_TIME);
        // sineInOut начинается и заканчивается нулевой скоростью,
        // поэтому стык с торможением незаметен.
        this._setTotal(lerp(t.to, t.settleTo, Easing.sineInOut(k)));
        if (k >= 1) {
          this.position = 0;
          this.total = t.settleTo;
          this.state = "idle";
        }
        break;
      }
    }

    // Замах: короткое движение вверх в самом начале раскрутки.
    // Складывается с уже идущим разгоном вниз, поэтому читается как
    // рывок механизма, а не как отдельная анимация.
    if (this.kickTime < KICK_TIME) {
      this.kickTime += dt;
      const k = Math.min(1, this.kickTime / KICK_TIME);
      this.visualOffset = -KICK_AMP * Math.sin(Math.PI * k) * (1 - k * 0.35);
    } else if (this.visualOffset !== 0) {
      this.visualOffset = 0;
    }

    if (this.landTime < LAND_TIME) this.landTime += dt;

    if (this.anticipating) this.anticipationPulse += dt * 6;
  }

  /** Вертикальное сжатие символов от удара при приземлении. */
  get landSquash() {
    if (this.landTime >= LAND_TIME) return 1;
    const t = this.landTime;
    return 1 - LAND_AMP * Math.exp(-t * 11) * Math.cos(t * 26);
  }

  /**
   * Двигает барабан в абсолютную позицию.
   *
   * Ход назад разрешён: на возврате из проскока смещение отрицательное.
   * Проскок всегда меньше ячейки, поэтому лента не «отматывается» назад
   * и порядок символов не нарушается.
   */
  _setTotal(next) {
    const delta = next - this.total;
    this.total = next;
    this.position += delta;

    while (this.position >= 1) {
      this.position -= 1;
      this._shift();
    }
  }

  _shift() {
    this.cells.pop();
    if (this.shiftsLeft > 0) {
      this.shiftsLeft--;
      this.cells.unshift(this.feed.shift() ?? this._random());
    } else {
      this.cells.unshift(this._random());
    }
  }

  get isMoving() {
    return this.state !== "idle";
  }

  get blurAmount() {
    // Смазывать имеет смысл только на реально высокой скорости.
    return clamp((this.velocity - 8) / 18, 0, 1);
  }
}

/* ────────────────────────── набор барабанов ─────────────────────── */

export class ReelSet extends Container {
  constructor({ textures, store, metrics, reels = 5, symbolPool }) {
    super();
    this.textures = textures;
    this.store = store;
    this.metrics = metrics;
    this.reelCount = reels;

    this.reels = Array.from({ length: reels }, (_, i) => new Reel(i, symbolPool));

    // Барабаны рисуются одним узлом: 15 отдельных спрайтов в графе сцены
    // дают в разы больше накладных расходов, чем один цикл drawImage.
    this.view = new Custom((ctx) => this._draw(ctx), metrics.width, metrics.height);
    this.view.x = metrics.x;
    this.view.y = metrics.y;

    // Клип по окну барабанов, иначе символы вылезают на оправу.
    this.clipper = new Container();
    this.clipper.clip = { x: metrics.x, y: metrics.y, width: metrics.width, height: metrics.height };
    this.clipper.add(this.view);
    this.add(this.clipper);

    this.spinElapsed = 0;
    this._schedule = null;
    this.turbo = false;

    this.highlight = new Set();       // «reel:row» выигравших ячеек
    this.highlightOrder = new Map();  // порядок вспышки, слева направо
    this.highlightTime = 0;
    this.dimOthers = false;
    this.highlightPulse = 0;
    this.freeMode = false;

    this.cellGlow = store.frame("cell_glow");
    this.winFrame = store.frame("win_frame");
    this.raysFrame = store.has("win_rays") ? store.frame("win_rays") : null;
  }

  setVisibleScreen(screen) {
    for (let r = 0; r < this.reelCount; r++) {
      this.reels[r].setVisible([screen[0][r], screen[1][r], screen[2][r]]);
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
   * когда на уже остановившихся лежат два скаттера и следующий барабан
   * решает судьбу бонуса.
   */
  async stopAll(screen, { turbo = false, anticipationReels = [], onReelStop = null } = {}) {
    const baseDelay = turbo ? 0.09 : 0.17;
    const minSpin = turbo ? MIN_SPIN_TIME.turbo : MIN_SPIN_TIME.normal;

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
        at: firstStopAt + i * baseDelay + (anticipate ? 1.15 : 0),
        anticipate,
        fired: false,
        fire: (fast) => {
          reel.anticipating = false;
          reel.onStopped = () => {
            if (onReelStop) onReelStop(i, reel);
            resolve();
          };
          reel.requestStop(
            [screen[0][i], screen[1][i], screen[2][i]],
            {
              extraSpins: fast ? 0 : (anticipate ? 6 : 0),
              minRunwayTime: fast ? 0.18 : (turbo ? 0.26 : 0.42)
            }
          );
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
  }

  get isSpinning() {
    return this.reels.some((r) => r.isMoving);
  }

  /* ───────────────────────── отрисовка ──────────────────────────── */

  _draw(ctx) {
    const cell = this.metrics.cell;
    const pulse = 0.5 + 0.5 * Math.sin(this.highlightPulse * 5);
    const raysAngle = this.highlightPulse * 0.5;

    for (let r = 0; r < this.reelCount; r++) {
      const reel = this.reels[r];
      const x = r * cell;
      const blur = reel.blurAmount;
      const useBlur = blur > 0.35;
      const squash = reel.landSquash;

      // Антисипация: колонна наливается светом, пока «думает».
      if (reel.anticipating) {
        const a = 0.18 + 0.16 * Math.sin(reel.anticipationPulse);
        const grad = ctx.createLinearGradient(x, 0, x, this.metrics.height);
        grad.addColorStop(0, `rgba(255,216,106,0)`);
        grad.addColorStop(0.5, `rgba(255,216,106,${a.toFixed(3)})`);
        grad.addColorStop(1, `rgba(255,216,106,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, cell, this.metrics.height);
      }

      const offset = (reel.position + reel.visualOffset) * cell;

      for (let i = 0; i < CELLS; i++) {
        const symbolId = reel.cells[i];
        const y = (i - 1) * cell + offset;
        if (y + cell < -cell || y > this.metrics.height + cell) continue;

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
          if (t > 0 && t < POP_TIME) {
            const k = t / POP_TIME;
            popScale = 1 + 0.3 * Math.sin(Math.PI * k) * (1 - k * 0.4);
          }
        }

        const cx = x + cell / 2;
        const cy = y + cell / 2;

        if (isWinner && still) {
          // Вращающиеся лучи за символом
          const rf = this.raysFrame;
          if (rf) {
            const rs = cell * (1.5 + pulse * 0.12);
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 0.2 + pulse * 0.16;
            ctx.translate(cx, cy);
            ctx.rotate(raysAngle);
            ctx.drawImage(rf.image, rf.x, rf.y, rf.w, rf.h, -rs / 2, -rs / 2, rs, rs);
            ctx.restore();
          }
          const g = this.cellGlow;
          const gs = cell * (1.1 + pulse * 0.08);
          // Ореол под символом должен намекать, а не забивать: символ —
          // главное, свечение лишь подсказывает, куда смотреть.
          ctx.globalAlpha = 0.26 + pulse * 0.2;
          ctx.drawImage(g.image, g.x, g.y, g.w, g.h, cx - gs / 2, cy - gs / 2, gs, gs);
        }

        const frame = this.textures.get(symbolId, useBlur);
        ctx.globalAlpha = alpha;

        const scale = popScale * (isWinner && still ? 1 + pulse * 0.05 : 1);
        const w = cell * 0.94 * scale;
        // Удар при приземлении сплющивает символ по вертикали
        // и слегка раздаёт по горизонтали — так делает всё, что падает.
        const h = w * squash;
        const wx = w * (2 - squash);

        if (useBlur && !this.textures.supportsFilter) {
          const stretch = 1 + blur * 0.35;
          ctx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h,
            cx - w / 2, cy - (w * stretch) / 2, w, w * stretch);
        } else {
          ctx.drawImage(frame.image, frame.x, frame.y, frame.w, frame.h,
            cx - wx / 2, cy - h / 2, wx, h);
        }

        if (isWinner && still) {
          const wf = this.winFrame;
          const ws = cell * (0.99 + pulse * 0.04) * popScale;
          ctx.globalAlpha = 0.55 + pulse * 0.4;
          ctx.drawImage(wf.image, wf.x, wf.y, wf.w, wf.h,
            cx - ws / 2, cy - ws / 2, ws, ws);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

}
