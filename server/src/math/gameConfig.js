// Математическая модель «Сочи · Sochi Sunset».
//
// ВАЖНО: этот файл — источник истины. Клиент не содержит ни лент, ни логики
// начисления: он получает готовый результат спина. Всё, что нужно игроку для
// таблицы выплат, отдаётся отдельным эндпоинтом /api/config.

"use strict";

/* ─────────────────────────────── символы ────────────────────────── */

// Пять премиальных знаков — курортные предметы, пять младших —
// леденцы-самоцветы. Порядок задаёт старшинство выплат и обязан
// совпадать с tools/assets/symbols.mjs: индекс в ленте и есть id символа.
const SYM = {
  ANCHOR: 0,
  ICECREAM: 1,
  SHASHLIK: 2,
  HAT: 3,
  WINE: 4,
  GEM_RED: 5,
  GEM_AMBER: 6,
  GEM_GREEN: 7,
  GEM_AQUA: 8,
  GEM_PURPLE: 9,
  WILD: 10,
  SCATTER: 11
};

const SYMBOL_COUNT = 12;
const SYMBOL_KEYS = [
  "anchor", "icecream", "shashlik", "hat", "wine",
  "gem_red", "gem_amber", "gem_green", "gem_aqua", "gem_purple",
  "wild", "scatter"
];

const REELS = 5;
const ROWS = 3;

/* ───────────────────────── таблица выплат ───────────────────────── */

// Множители ставки на линию. Индекс — количество символов слева направо.
const PAYTABLE = {
  [SYM.ANCHOR]:     { 3: 50, 4: 200, 5: 1000 },
  [SYM.ICECREAM]:   { 3: 40, 4: 150, 5: 600  },
  [SYM.SHASHLIK]:   { 3: 30, 4: 120, 5: 400  },
  [SYM.HAT]:        { 3: 25, 4: 100, 5: 300  },
  [SYM.WINE]:       { 3: 20, 4: 80,  5: 250  },
  [SYM.GEM_RED]:    { 3: 15, 4: 50,  5: 150  },
  [SYM.GEM_AMBER]:  { 3: 12, 4: 40,  5: 125  },
  [SYM.GEM_GREEN]:  { 3: 10, 4: 30,  5: 100  },
  [SYM.GEM_AQUA]:   { 3: 8,  4: 25,  5: 80   },
  [SYM.GEM_PURPLE]: { 3: 8,  4: 25,  5: 80   }
};

// Скаттер платит от ОБЩЕЙ ставки, а не от линии.
const SCATTER_PAYS = { 3: 2, 4: 10, 5: 50 };

// Символы, которые может заменить дикий.
const WILD_SUBSTITUTES = [
  SYM.ANCHOR, SYM.ICECREAM, SYM.SHASHLIK, SYM.HAT, SYM.WINE,
  SYM.GEM_RED, SYM.GEM_AMBER, SYM.GEM_GREEN, SYM.GEM_AQUA, SYM.GEM_PURPLE
];

/* ──────────────────────────── линии выплат ──────────────────────── */

// Ряд для каждого из 5 барабанов: 0 — верх, 1 — центр, 2 — низ.
const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [0, 0, 2, 0, 0]
];

/* ───────────────────────────── фриспины ─────────────────────────── */

const FREESPINS = {
  triggerScatters: 3,
  awarded: { 3: 10, 4: 12, 5: 15 },
  retriggerScatters: 3,
  retriggerAward: 5,
  // Каждый дикий, участвующий в выигрышной комбинации во фриспинах,
  // получает случайный множитель. Множители перемножаются.
  wildMultipliers: [2, 3],
  maxTotalSpins: 200          // страховка от бесконечного ретригера
};

// Потолок выплаты за раунд, в общих ставках. Требование почти всех
// регуляторов и одновременно защита от переполнения кошелька оператора.
const MAX_WIN_MULTIPLIER = 5000;

/* ──────────────────────── генерация лент ────────────────────────── */

/**
 * Состав лент задаётся количеством каждого символа. Сам порядок
 * на RTP не влияет (барабаны независимы), но влияет на ощущение игры:
 * стеки одинаковых символов и слипшиеся скаттеры выглядят неправильно.
 */
// Состав подобран server/src/math/optimize.js под RTP 96.008 %.
// Менять вручную нельзя: любое изменение обязано пройти optimize + simulate,
// иначе фактический возврат разъедется с заявленным в сертификате.
const BASE_COUNTS = [
// якорь морож шашл шляп вино  крас янт  зел  бирюз фиол дикий скаттер
  [    2,    4,   5,   5,   6,   7,   8,    9,   9,   9,   0,      2],
  [    2,    4,   5,   5,   6,   6,   8,    8,   9,   9,   5,      2],
  [    2,    4,   5,   5,   6,   6,   7,    8,   9,   9,   5,      2],
  [    2,    4,   5,   5,   6,   6,   8,    8,   9,   9,   5,      2],
  [    2,    4,   5,   5,   6,   7,   8,    9,   9,   9,   0,      2]
];

// Во фриспинах ленты «богаче»: больше диких и премиальных символов.
const FREE_COUNTS = [
  [    3,    5,   5,   6,   6,   7,   8,    8,   8,   8,   0,      2],
  [    3,    5,   5,   6,   6,   6,   7,    7,   8,   8,   7,      2],
  [    3,    5,   5,   6,   6,   5,   7,    7,   8,   8,   7,      2],
  [    3,    5,   5,   6,   6,   6,   7,    7,   8,   8,   7,      2],
  [    3,    5,   5,   6,   6,   8,   8,    8,   8,   8,   0,      2]
];

/** Детерминированный ГПСЧ — ленты обязаны быть одинаковыми на всех серверах. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Раскладывает символы по ленте с ограничениями:
 *   • скаттеры не ближе чем через 4 позиции — иначе на одном барабане
 *     видно два скаттера и ломается аналитический расчёт вероятностей;
 *   • не больше двух одинаковых символов подряд — иначе появляются
 *     «стеки», которых в этой модели не предусмотрено.
 * Лента замкнута в кольцо, поэтому проверяются и стыки начала с концом.
 */
function buildStrip(counts, seed) {
  const pool = [];
  for (let s = 0; s < SYMBOL_COUNT; s++) {
    for (let i = 0; i < counts[s]; i++) pool.push(s);
  }
  const rnd = mulberry32(seed);
  const len = pool.length;

  const MIN_SCATTER_GAP = 4;
  const MAX_RUN = 2;

  for (let attempt = 0; attempt < 400; attempt++) {
    // Тасование Фишера — Йейтса
    const strip = pool.slice();
    for (let i = strip.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [strip[i], strip[j]] = [strip[j], strip[i]];
    }

    if (isValidStrip(strip, MIN_SCATTER_GAP, MAX_RUN)) return strip;

    // Не получилось случайно — чиним точечными перестановками.
    if (repairStrip(strip, rnd, MIN_SCATTER_GAP, MAX_RUN)) return strip;
  }
  throw new Error("Не удалось построить ленту с заданными ограничениями");
}

function isValidStrip(strip, minGap, maxRun) {
  const len = strip.length;
  for (let i = 0; i < len; i++) {
    if (strip[i] === SYM.SCATTER) {
      for (let d = 1; d < minGap; d++) {
        if (strip[(i + d) % len] === SYM.SCATTER) return false;
      }
    }
    let run = 1;
    while (run <= maxRun && strip[(i + run) % len] === strip[i]) run++;
    if (run > maxRun) return false;
  }
  return true;
}

function repairStrip(strip, rnd, minGap, maxRun) {
  const len = strip.length;
  for (let pass = 0; pass < len * 40; pass++) {
    if (isValidStrip(strip, minGap, maxRun)) return true;
    const i = Math.floor(rnd() * len);
    const j = Math.floor(rnd() * len);
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  return isValidStrip(strip, minGap, maxRun);
}

function buildStrips(countsPerReel, seedBase) {
  return countsPerReel.map((counts, reel) => buildStrip(counts, seedBase + reel * 7919));
}

const BASE_STRIPS = buildStrips(BASE_COUNTS, 0x5eed01);
const FREE_STRIPS = buildStrips(FREE_COUNTS, 0x5eed02);

/* ──────────────────────────── экспорт ───────────────────────────── */

module.exports = {
  SYM,
  SYMBOL_COUNT,
  SYMBOL_KEYS,
  REELS,
  ROWS,
  PAYTABLE,
  SCATTER_PAYS,
  WILD_SUBSTITUTES,
  PAYLINES,
  FREESPINS,
  MAX_WIN_MULTIPLIER,
  BASE_COUNTS,
  FREE_COUNTS,
  BASE_STRIPS,
  FREE_STRIPS,
  buildStrips,
  buildStrip,
  mulberry32,

  /** Ставки в «монетах»; денежное значение получается умножением на номинал. */
  BET_LEVELS: [0.2, 0.4, 0.6, 0.8, 1, 2, 3, 4, 5, 10, 20, 30, 50, 100],
  DEFAULT_BET: 1,

  /** Публичная часть конфигурации — уходит на клиент. Лент здесь нет. */
  publicConfig() {
    return {
      reels: REELS,
      rows: ROWS,
      paylines: PAYLINES,
      paytable: PAYTABLE,
      scatterPays: SCATTER_PAYS,
      symbolKeys: SYMBOL_KEYS,
      wild: SYM.WILD,
      scatter: SYM.SCATTER,
      freespins: {
        triggerScatters: FREESPINS.triggerScatters,
        awarded: FREESPINS.awarded,
        retriggerAward: FREESPINS.retriggerAward,
        wildMultipliers: FREESPINS.wildMultipliers
      },
      maxWinMultiplier: MAX_WIN_MULTIPLIER,
      betLevels: module.exports.BET_LEVELS,
      defaultBet: module.exports.DEFAULT_BET
    };
  }
};
