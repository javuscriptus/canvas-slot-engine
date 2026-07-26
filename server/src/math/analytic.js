// Точный расчёт RTP — без Монте-Карло.
//
// Почему это возможно: барабаны независимы, а любая линия выплат берёт
// ровно по одной ячейке с каждого барабана. Значит, распределение символов
// на линии — это произведение маргинальных распределений лент, и матожидание
// выплаты считается полным перебором 12⁵ = 248 832 комбинаций.
//
// Симуляция всё равно нужна — но как перекрёстная проверка и источник
// статистики по волатильности, а не как способ узнать RTP.

"use strict";

const C = require("./gameConfig");
const { evaluateLine } = require("./engine");

/* ─────────────────── маргинальные вероятности ───────────────────── */

/** p[reel][symbol] — вероятность встретить символ в произвольной ячейке. */
function symbolProbabilities(strips) {
  return strips.map((strip) => {
    const p = new Array(C.SYMBOL_COUNT).fill(0);
    for (const s of strip) p[s] += 1 / strip.length;
    return p;
  });
}

/**
 * Распределение количества скаттеров на одном барабане.
 * Считается перебором всех позиций остановки, поэтому корректно даже
 * если два скаттера окажутся в одном окне.
 */
function scatterDistributionPerReel(strip) {
  const len = strip.length;
  const dist = [];
  for (let stop = 0; stop < len; stop++) {
    let k = 0;
    for (let row = 0; row < C.ROWS; row++) {
      if (strip[(stop + row) % len] === C.SYM.SCATTER) k++;
    }
    dist[k] = (dist[k] || 0) + 1 / len;
  }
  for (let i = 0; i < dist.length; i++) if (!dist[i]) dist[i] = 0;
  return dist;
}

/** Свёртка распределений по барабанам → распределение общего числа скаттеров. */
function totalScatterDistribution(strips) {
  let acc = [1];
  for (const strip of strips) {
    const d = scatterDistributionPerReel(strip);
    const next = new Array(acc.length + d.length - 1).fill(0);
    for (let i = 0; i < acc.length; i++) {
      if (acc[i] === 0) continue;
      for (let j = 0; j < d.length; j++) {
        if (d[j] === 0) continue;
        next[i + j] += acc[i] * d[j];
      }
    }
    acc = next;
  }
  return acc;
}

/* ──────────────────── матожидание выплаты по линии ──────────────── */

/**
 * Полный перебор комбинаций одной линии.
 *
 * @param {number[][]} probs           p[reel][symbol]
 * @param {number} wildMultExpect      матожидание множителя одного дикого
 *                                     (1 — в базовой игре, 2.5 — во фриспинах)
 * @returns {{expected:number, hitRate:number}} выплата в ставках на линию
 */
function lineExpectation(probs, wildMultExpect = 1) {
  const line = new Array(C.REELS);
  let expected = 0;
  let hitRate = 0;

  const p0 = probs[0], p1 = probs[1], p2 = probs[2], p3 = probs[3], p4 = probs[4];

  for (let a = 0; a < C.SYMBOL_COUNT; a++) {
    if (p0[a] === 0) continue;
    line[0] = a;
    // Комбинация не может выиграть, если первый барабан — скаттер или
    // непокрытый символ: выплаты считаются слева направо.
    for (let b = 0; b < C.SYMBOL_COUNT; b++) {
      if (p1[b] === 0) continue;
      line[1] = b;
      const pab = p0[a] * p1[b];
      for (let c = 0; c < C.SYMBOL_COUNT; c++) {
        if (p2[c] === 0) continue;
        line[2] = c;
        const pabc = pab * p2[c];
        for (let d = 0; d < C.SYMBOL_COUNT; d++) {
          if (p3[d] === 0) continue;
          line[3] = d;
          const pabcd = pabc * p3[d];
          for (let e = 0; e < C.SYMBOL_COUNT; e++) {
            if (p4[e] === 0) continue;
            line[4] = e;
            const prob = pabcd * p4[e];

            const res = evaluateLine(line);
            if (!res) continue;

            const mult = Math.pow(wildMultExpect, res.wilds);
            expected += prob * res.payout * mult;
            hitRate += prob;
          }
        }
      }
    }
  }
  return { expected, hitRate };
}

/* ───────────────────────── сводка по режиму ─────────────────────── */

function modeStats(strips, wildMultExpect) {
  const probs = symbolProbabilities(strips);
  const { expected: linePerLine, hitRate: lineHit } = lineExpectation(probs, wildMultExpect);

  // Выплата всех 20 линий, выраженная в долях ОБЩЕЙ ставки:
  // 20 линий × (ставка/20) × выплата = ставка × выплата.
  const lineRTP = linePerLine;

  const scatterDist = totalScatterDistribution(strips);
  let scatterRTP = 0;
  let triggerProb = 0;
  let expectedAwardIfTrigger = 0;

  for (let k = 0; k < scatterDist.length; k++) {
    const p = scatterDist[k];
    if (p === 0) continue;
    const pay = C.SCATTER_PAYS[Math.min(k, C.REELS)] || 0;
    if (k >= 3 && pay > 0) scatterRTP += p * pay;
    if (k >= C.FREESPINS.triggerScatters) {
      triggerProb += p;
      expectedAwardIfTrigger += p * (C.FREESPINS.awarded[Math.min(k, C.REELS)] || 0);
    }
  }
  if (triggerProb > 0) expectedAwardIfTrigger /= triggerProb;

  return {
    lineRTP,
    scatterRTP,
    totalRTP: lineRTP + scatterRTP,
    lineHitRate: 1 - Math.pow(1 - lineHit, C.PAYLINES.length), // приближение: линии слабо зависимы
    lineHitPerLine: lineHit,
    scatterDist,
    triggerProb,
    expectedAwardIfTrigger
  };
}

/* ──────────────────────────── общий RTP ─────────────────────────── */

function computeRTP() {
  const wildMultExpect =
    C.FREESPINS.wildMultipliers.reduce((a, b) => a + b, 0) / C.FREESPINS.wildMultipliers.length;

  const base = modeStats(C.BASE_STRIPS, 1);
  const free = modeStats(C.FREE_STRIPS, wildMultExpect);

  // Ретригер — ветвящийся процесс: каждый сыгранный фриспин порождает
  // ещё retriggerAward спинов с вероятностью q. Ряд сходится при 5q < 1.
  const q = free.triggerProb;
  const branch = C.FREESPINS.retriggerAward * q;
  if (branch >= 1) {
    throw new Error(`Ретригер расходится: 5q = ${branch.toFixed(3)} ≥ 1`);
  }
  const spinsMultiplier = 1 / (1 - branch);
  const expectedFreeSpins = base.expectedAwardIfTrigger * spinsMultiplier;

  const freeRTP = base.triggerProb * expectedFreeSpins * free.totalRTP;

  const total = base.totalRTP + freeRTP;

  return {
    total,
    base: {
      lines: base.lineRTP,
      scatter: base.scatterRTP,
      total: base.totalRTP,
      hitRate: base.lineHitRate,
      triggerProb: base.triggerProb,
      triggerOneIn: base.triggerProb > 0 ? 1 / base.triggerProb : Infinity,
      expectedAward: base.expectedAwardIfTrigger
    },
    free: {
      lines: free.lineRTP,
      scatter: free.scatterRTP,
      perSpin: free.totalRTP,
      retriggerProb: q,
      spinsMultiplier,
      expectedTotalSpins: expectedFreeSpins,
      contribution: freeRTP
    },
    shares: {
      baseLines: base.lineRTP / total,
      baseScatter: base.scatterRTP / total,
      freeSpins: freeRTP / total
    }
  };
}

/** Тот же расчёт, но для произвольного набора лент — нужен оптимизатору. */
function computeRTPFor(baseStrips, freeStrips) {
  const wildMultExpect =
    C.FREESPINS.wildMultipliers.reduce((a, b) => a + b, 0) / C.FREESPINS.wildMultipliers.length;

  const base = modeStats(baseStrips, 1);
  const free = modeStats(freeStrips, wildMultExpect);

  const q = free.triggerProb;
  const branch = C.FREESPINS.retriggerAward * q;
  if (branch >= 1) return { total: Infinity, base, free, invalid: true };

  const expectedFreeSpins = base.expectedAwardIfTrigger / (1 - branch);
  const freeRTP = base.triggerProb * expectedFreeSpins * free.totalRTP;

  return { total: base.totalRTP + freeRTP, base, free, freeRTP };
}

module.exports = {
  symbolProbabilities,
  scatterDistributionPerReel,
  totalScatterDistribution,
  lineExpectation,
  modeStats,
  computeRTP,
  computeRTPFor
};
