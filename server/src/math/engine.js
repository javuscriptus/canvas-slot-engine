// Расчёт результата спина. Чистые функции без состояния —
// одну и ту же логику использует и боевой сервер, и симулятор RTP.

"use strict";

const C = require("./gameConfig");

/* ──────────────────────── видимое поле ──────────────────────────── */

/**
 * Разворачивает позиции остановки в матрицу [ряд][барабан].
 * Лента замкнута в кольцо, поэтому индекс берётся по модулю.
 */
function buildScreen(strips, stops) {
  const screen = [];
  for (let row = 0; row < C.ROWS; row++) {
    const line = [];
    for (let reel = 0; reel < C.REELS; reel++) {
      const strip = strips[reel];
      line.push(strip[(stops[reel] + row) % strip.length]);
    }
    screen.push(line);
  }
  return screen;
}

/* ───────────────────────── выигрыш по линии ─────────────────────── */

/**
 * Оценивает одну линию слева направо.
 *
 * Перебираются все платящие символы: для каждого считается длина префикса
 * из этого символа и диких. Такой перебор автоматически решает две неочевидные
 * ситуации — линия, начинающаяся с диких (она платит по лучшему из возможных
 * символов), и случай, когда «дикий + низкий символ» выгоднее, чем короткая
 * комбинация премиального.
 *
 * @returns {{symbol:number, count:number, payout:number, wilds:number}|null}
 */
function evaluateLine(lineSymbols) {
  let best = null;

  for (const sym of C.WILD_SUBSTITUTES) {
    let count = 0;
    let wilds = 0;
    for (let i = 0; i < C.REELS; i++) {
      const s = lineSymbols[i];
      if (s === sym) {
        count++;
      } else if (s === C.SYM.WILD) {
        count++;
        wilds++;
      } else {
        break;
      }
    }
    if (count < 3) continue;

    const payout = C.PAYTABLE[sym]?.[count] || 0;
    if (payout <= 0) continue;

    if (!best || payout > best.payout) {
      best = { symbol: sym, count, payout, wilds };
    }
  }
  return best;
}

/* ────────────────────────────── спин ────────────────────────────── */

/**
 * Считает все выигрыши на видимом поле.
 *
 * @param {number[][]} screen  матрица [ряд][барабан]
 * @param {number} totalBet    полная ставка за спин
 * @param {object} opts        { freeSpin, multiplierRoll } —
 *                             multiplierRoll(i) возвращает множитель i-го дикого
 */
function evaluateScreen(screen, totalBet, opts = {}) {
  const lineBet = totalBet / C.PAYLINES.length;
  const wins = [];
  let total = 0;

  // ── линии ───────────────────────────────────────────────────────
  for (let li = 0; li < C.PAYLINES.length; li++) {
    const pattern = C.PAYLINES[li];
    const lineSymbols = new Array(C.REELS);
    for (let r = 0; r < C.REELS; r++) lineSymbols[r] = screen[pattern[r]][r];

    const res = evaluateLine(lineSymbols);
    if (!res) continue;

    let multiplier = 1;
    const multipliers = [];
    if (opts.freeSpin && res.wilds > 0 && opts.multiplierRoll) {
      for (let w = 0; w < res.wilds; w++) {
        const m = opts.multiplierRoll(w);
        multipliers.push(m);
        multiplier *= m;
      }
    }

    const amount = round2(lineBet * res.payout * multiplier);
    total += amount;

    const positions = [];
    for (let r = 0; r < res.count; r++) positions.push({ reel: r, row: pattern[r] });

    wins.push({
      type: "line",
      line: li,
      symbol: res.symbol,
      count: res.count,
      payout: res.payout,
      multiplier,
      multipliers,
      amount,
      positions
    });
  }

  // ── скаттеры ────────────────────────────────────────────────────
  const scatterPositions = [];
  for (let row = 0; row < C.ROWS; row++) {
    for (let reel = 0; reel < C.REELS; reel++) {
      if (screen[row][reel] === C.SYM.SCATTER) scatterPositions.push({ reel, row });
    }
  }
  const scatterCount = scatterPositions.length;

  if (scatterCount >= 3) {
    const pay = C.SCATTER_PAYS[Math.min(scatterCount, C.REELS)] || 0;
    if (pay > 0) {
      const amount = round2(totalBet * pay);
      total += amount;
      wins.push({
        type: "scatter",
        symbol: C.SYM.SCATTER,
        count: scatterCount,
        payout: pay,
        multiplier: 1,
        amount,
        positions: scatterPositions
      });
    }
  }

  return {
    wins,
    totalWin: round2(total),
    scatterCount,
    scatterPositions
  };
}

/** Округление денег до копеек. Работает на всём диапазоне ставок. */
function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Один спин целиком: остановки → поле → выигрыши.
 * @param {function} nextInt  nextInt(max) — источник случайности [0, max)
 */
function spin(nextInt, totalBet, { freeSpin = false } = {}) {
  const strips = freeSpin ? C.FREE_STRIPS : C.BASE_STRIPS;

  const stops = new Array(C.REELS);
  for (let r = 0; r < C.REELS; r++) stops[r] = nextInt(strips[r].length);

  const screen = buildScreen(strips, stops);

  const multiplierRoll = freeSpin
    ? () => C.FREESPINS.wildMultipliers[nextInt(C.FREESPINS.wildMultipliers.length)]
    : null;

  const result = evaluateScreen(screen, totalBet, { freeSpin, multiplierRoll });

  return { stops, screen, ...result };
}

/** Сколько фриспинов даёт указанное число скаттеров. */
function freeSpinsAwarded(scatterCount) {
  if (scatterCount < C.FREESPINS.triggerScatters) return 0;
  return C.FREESPINS.awarded[Math.min(scatterCount, C.REELS)] || 0;
}

module.exports = {
  buildScreen,
  evaluateLine,
  evaluateScreen,
  spin,
  freeSpinsAwarded,
  round2
};
