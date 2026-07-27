// Доказуемая честность (provably fair): commit-reveal поверх HMAC-DRBG.
//
// Криптостойкий ГПСЧ игрока не убеждает: снаружи честная последовательность
// и подтасованная выглядят одинаково, а проверить нечего — сервер отдаёт
// только результат. Поэтому исход раунда выводится детерминированно из двух
// семян: серверного (его хеш публикуется ДО спина) и клиентского (его
// задаёт игрок). После закрытия раунда серверное семя раскрывается, и игрок
// сам пересчитывает каждый экран. Подменить исход постфактум нельзя:
// изменённое семя не сойдётся с опубликованным хешем.
//
// Математика при этом не меняется ни на йоту. Слова потока берутся из
// HMAC-SHA256 — равномерны по построению — и проходят ту же отбраковку по
// модулю, что и crypto.randomBytes в rng.js. Движок спина вообще не знает,
// откуда пришло число: он получает ту же функцию nextInt(max).
//
// Формула потока (её и реализует сторонний проверяющий):
//
//   block(i)  = HMAC_SHA256(key = serverSeedHex, msg = `${clientSeed}:${nonce}:${i}`)
//   word(j)   = block(⌊j/8⌋) прочитанное как uint32 BE со смещения (j mod 8)*4
//   nextInt(max): берём слова подряд, отбрасывая всё, что ≥ ⌊2³²/max⌋·max,
//                 возвращаем первое подошедшее по модулю max.

"use strict";

const crypto = require("node:crypto");

const round = require("./game/round");

const WORDS_PER_BLOCK = 8;      // SHA-256 даёт 32 байта = 8 слов по 32 бита
// Клиентское семя участвует в строке сообщения через разделитель ':',
// поэтому сам разделитель в нём недопустим: иначе две разные пары
// (clientSeed, nonce) дали бы одно сообщение и один и тот же поток.
const CLIENT_SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Детерминированный источник случайности раунда.
 *
 * Состояние — единственное число `cursor` (сколько слов потока израсходовано),
 * поэтому раунд переживает и перезапуск процесса, и паузу между фриспинами:
 * достаточно сохранить курсор в БД и продолжить с него.
 */
class FairRandom {
  constructor({ serverSeed, clientSeed, nonce = 0, cursor = 0 }) {
    if (!serverSeed || !clientSeed) {
      throw new Error("FairRandom: нужны serverSeed и clientSeed");
    }
    this.serverSeed = serverSeed;
    this.clientSeed = clientSeed;
    this.nonce = nonce;
    this.cursor = cursor;
    this.drawn = 0;              // принятых значений — то, что уходит в аудит раунда
    this._blockIndex = -1;
    this._block = null;
  }

  _word() {
    const index = this.cursor++;
    const blockIndex = Math.floor(index / WORDS_PER_BLOCK);
    // Блок кешируется: одно обращение к nextInt почти всегда попадает
    // в уже посчитанный HMAC, и спин обходится единицами хеширований.
    if (blockIndex !== this._blockIndex) {
      this._block = crypto
        .createHmac("sha256", this.serverSeed)
        .update(`${this.clientSeed}:${this.nonce}:${blockIndex}`)
        .digest();
      this._blockIndex = blockIndex;
    }
    return this._block.readUInt32BE((index % WORDS_PER_BLOCK) * 4);
  }

  /**
   * Равномерное целое из [0, max).
   *
   * Отбраковка та же, что в rng.js: `word % max` смещает распределение
   * в пользу младших значений, когда 2³² не делится на max нацело.
   */
  nextInt(max) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError(`nextInt: некорректная граница ${max}`);
    }
    if (max === 1) return 0;

    const limit = Math.floor(0x100000000 / max) * max;
    for (let attempt = 0; attempt < 64; attempt++) {
      const v = this._word();
      if (v < limit) {
        this.drawn++;
        return v % max;
      }
    }
    // Вероятность 64 промахов подряд меньше 2⁻⁶⁴; если это случилось,
    // сломан не поток, а код вокруг него.
    throw new Error("FairRandom: не удалось получить несмещённое значение");
  }

  nextFloat() {
    return this._word() / 0x100000000;
  }
}

/* ───────────────────────────── семена ───────────────────────────── */

/** Серверное семя. 32 байта — столько же энтропии, сколько у ключа HMAC. */
function newServerSeed() {
  return crypto.randomBytes(32).toString("hex");
}

/** Клиентское семя по умолчанию: игрок вправе заменить его своим. */
function newClientSeed() {
  return crypto.randomBytes(8).toString("hex");
}

function hashSeed(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest("hex");
}

/**
 * Приводит присланное игроком семя к допустимому виду.
 * @returns {string|null} null, если семя не годится
 */
function normalizeClientSeed(raw) {
  if (raw === undefined || raw === null || raw === "") return newClientSeed();
  const s = String(raw);
  return CLIENT_SEED_RE.test(s) ? s : null;
}

/* ────────────────────────── воспроизведение ─────────────────────── */

/**
 * Пересчитывает раунд целиком из раскрытых семян.
 *
 * Это и есть проверка: результат обязан совпасть с тем, что лежит в БД
 * и что игрок видел на экране. Фриспины доигрываются до конца — их число
 * тоже определяется потоком, а не решением сервера.
 */
function replayRound({ serverSeed, clientSeed, nonce = 0, bet }) {
  const rng = new FairRandom({ serverSeed, clientSeed, nonce });
  const r = round.startRound(rng, bet);
  while (r.state === round.STATE.FREE) round.playFreeSpin(rng, r);
  return { round: r, draws: rng.drawn, cursor: rng.cursor };
}

/**
 * Сверяет сохранённый раунд с пересчитанным.
 *
 * Сравниваются экраны и суммы каждого сыгранного спина: недоигранный раунд
 * проверяется по тем спинам, которые уже состоялись.
 */
function verifyRound({ stored, serverSeed, clientSeed, nonce = 0 }) {
  if (hashSeed(serverSeed) !== stored.serverSeedHash) {
    return { valid: false, reason: "SEED_HASH_MISMATCH" };
  }

  let replayed;
  try {
    replayed = replayRound({ serverSeed, clientSeed, nonce, bet: stored.bet });
  } catch (err) {
    return { valid: false, reason: "REPLAY_FAILED", message: err.message };
  }

  const expected = replayed.round.spins;
  const actual = stored.spins || [];
  if (actual.length > expected.length) {
    return { valid: false, reason: "SPIN_COUNT_MISMATCH" };
  }

  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const b = expected[i];
    if (JSON.stringify(a.screen) !== JSON.stringify(b.screen)) {
      return { valid: false, reason: "SCREEN_MISMATCH", spin: i };
    }
    if (a.win !== b.win) {
      return { valid: false, reason: "WIN_MISMATCH", spin: i };
    }
  }

  const complete = actual.length === expected.length;
  return {
    valid: true,
    complete,
    // Итог сходится только у доигранного раунда: у недоигранного впереди
    // ещё фриспины, и сумма законно меньше.
    totalWin: replayed.round.totalWin,
    spins: expected.map((s) => ({ index: s.index, type: s.type, stops: s.stops, screen: s.screen, win: s.win }))
  };
}

module.exports = {
  FairRandom,
  newServerSeed,
  newClientSeed,
  hashSeed,
  normalizeClientSeed,
  replayRound,
  verifyRound,
  CLIENT_SEED_RE
};
