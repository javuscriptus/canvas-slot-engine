// Источник случайности.
//
// Math.random() для игры на деньги неприменим: V8 использует xorshift128+,
// состояние которого восстанавливается по нескольким выданным значениям —
// то есть исходы спинов становятся предсказуемыми. Здесь используется
// crypto.randomBytes с отбраковкой по модулю (rejection sampling),
// чтобы распределение оставалось строго равномерным.

"use strict";

const crypto = require("node:crypto");

const POOL_SIZE = 8192;

class SecureRandom {
  constructor() {
    this._pool = crypto.randomBytes(POOL_SIZE);
    this._offset = 0;
    this.drawn = 0;
  }

  _bytes(n) {
    if (this._offset + n > this._pool.length) {
      this._pool = crypto.randomBytes(POOL_SIZE);
      this._offset = 0;
    }
    const out = this._pool.subarray(this._offset, this._offset + n);
    this._offset += n;
    return out;
  }

  /**
   * Равномерное целое из [0, max).
   *
   * Наивное `random % max` смещает распределение в пользу младших значений,
   * когда 2^32 не делится на max нацело. Значения из «хвоста» отбрасываются.
   */
  nextInt(max) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError(`nextInt: некорректная граница ${max}`);
    }
    if (max === 1) return 0;

    const limit = Math.floor(0x100000000 / max) * max;
    for (let attempt = 0; attempt < 64; attempt++) {
      const v = this._bytes(4).readUInt32BE(0);
      if (v < limit) {
        this.drawn++;
        return v % max;
      }
    }
    // Практически недостижимо: вероятность 64 промахов подряд < 2⁻⁶⁴.
    throw new Error("RNG: не удалось получить несмещённое значение");
  }

  nextFloat() {
    return this._bytes(4).readUInt32BE(0) / 0x100000000;
  }

  /** Идентификатор раунда/сессии. */
  static id(bytes = 16) {
    return crypto.randomBytes(bytes).toString("hex");
  }
}

/**
 * Детерминированный ГПСЧ для симуляций и воспроизведения раундов.
 * В боевом контуре не используется — только в тестах и симуляторе.
 */
class SeededRandom {
  constructor(seed = 1) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  _next() {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x;
  }

  nextInt(max) {
    const limit = Math.floor(0x100000000 / max) * max;
    let v;
    do {
      v = this._next();
    } while (v >= limit);
    return v % max;
  }

  nextFloat() {
    return this._next() / 0x100000000;
  }
}

module.exports = { SecureRandom, SeededRandom };
