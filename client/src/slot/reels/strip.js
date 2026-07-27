// Физика одного барабана. Ни отрисовки, ни знания о размере сетки:
// барабану говорят, сколько у него видимых рядов и на каких символах
// встать, — как красиво до них доехать, он решает сам.
//
// Прокрутка сделана «как в железе»: замах, разгон, постоянная скорость,
// торможение с точной посадкой на границу символа, осознанный проскок
// и мягкий возврат. Ни одна из этих величин не подобрана на глаз —
// см. комментарий к requestStop.

import { Easing, clamp, randInt, lerp } from "../../engine/core.js";

/**
 * Амплитуды замаха и удара при приземлении — доли ячейки.
 *
 * В отличие от длительностей, они не темп, а форма движения: барабан,
 * подающийся на четверть ячейки вверх, выглядит сломанным при любом темпе.
 * Поэтому длительности приходят из темы, а амплитуды остаются физикой.
 */
const KICK_AMP = 0.16;
const LAND_AMP = 0.13;

/**
 * Один барабан.
 *
 * Лента хранится как rows + 2 ячейки: одна над окном и одна под ним нужны,
 * чтобы символ въезжал и выезжал плавно, а не появлялся на границе.
 */
export class Strip {
  /**
   * @param {number} index      номер барабана слева направо
   * @param {number} rows       видимых рядов
   * @param {number[]} symbolPool из чего сыпать в холостую
   * @param {object} timings    темп из темы: скорости и длительности
   */
  constructor(index, rows, symbolPool, timings) {
    this.index = index;
    this.rows = rows;
    this.symbolPool = symbolPool;
    this.timings = timings;

    // cells[0] — над окном, [1 … rows] — видимые ряды, [rows + 1] — под окном
    this.cellCount = rows + 2;
    this.cells = Array.from({ length: this.cellCount }, () => this._random());

    this.position = 0;        // дробная часть прокрутки, [0, 1)
    this.total = 0;           // сколько символов прокручено с начала спина
    this.velocity = 0;
    this.state = "idle";      // idle | accel | spin | stopping | settle

    // Чисто визуальные величины: в бухгалтерию ленты не входят,
    // поэтому не могут сбить выпавшие символы.
    this.visualOffset = 0;    // «замах» перед стартом, в долях ячейки
    this.kickTime = timings.reelKick;
    this.landTime = timings.reelLand;

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
    return this.cells.slice(1, this.rows + 1);
  }

  /** Мгновенно выставляет видимые символы — для восстановления сессии. */
  setVisible(symbols) {
    this.cells[0] = this._random();
    for (let row = 0; row < this.rows; row++) this.cells[row + 1] = symbols[row];
    this.cells[this.rows + 1] = this._random();
    this.position = 0;
    this.state = "idle";
  }

  startSpin(turbo) {
    this.state = "accel";
    this.velocity = 0;
    this.targetSpeed = turbo ? this.timings.reelSpeedTurbo : this.timings.reelSpeed;
    this.total = 0;
    this.feed = [];
    this.shiftsLeft = 0;
    this.anticipating = false;
    this.kickTime = 0;
    this.landTime = this.timings.reelLand;
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

    // Ленте нужно rows + 1 сдвигов, чтобы все результатные символы встали
    // в видимое окно, а последним ушёл наполнитель в ячейку над окном.
    // Меньше — и часть результата просто не успевает доехать: на экране
    // остаются символы от предыдущего спина.
    //
    // Так и ловилась редкая ошибка по кнопке «Стоп»: при коротком разбеге
    // (minRunwayTime 0.18) и почти целом this.total выходило на один сдвиг
    // меньше, и барабан вставал на чужих символах. Промах был не визуальный —
    // игрок видел не тот экран, который прислал сервер.
    const minShifts = this.rows + 1;
    if (target - Math.floor(start) < minShifts) {
      target = Math.floor(start) + minShifts;
    }

    const distance = target + overshoot - start;
    const shifts = target - Math.floor(start);

    // Лента набивается ровно под число сдвигов: длиннее — хвост не успеет
    // сойти, короче — на его место встанут случайные символы. Результат
    // едет с конца, потому что сдвиг вставляет символы сверху.
    this.feed = [];
    for (let i = 0; i < shifts - minShifts; i++) this.feed.push(this._random());
    for (let row = this.rows - 1; row >= 0; row--) this.feed.push(symbols[row]);
    this.feed.push(this._random());
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
        const k = Math.min(1, this.settleTime / this.timings.reelSettle);
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
    const kickTotal = this.timings.reelKick;
    if (this.kickTime < kickTotal) {
      this.kickTime += dt;
      const k = Math.min(1, this.kickTime / kickTotal);
      this.visualOffset = -KICK_AMP * Math.sin(Math.PI * k) * (1 - k * 0.35);
    } else if (this.visualOffset !== 0) {
      this.visualOffset = 0;
    }

    if (this.landTime < this.timings.reelLand) this.landTime += dt;

    if (this.anticipating) this.anticipationPulse += dt * 6;
  }

  /** Вертикальное сжатие символов от удара при приземлении. */
  get landSquash() {
    if (this.landTime >= this.timings.reelLand) return 1;
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
