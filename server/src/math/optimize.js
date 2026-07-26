// Подбор состава лент под целевой RTP.
//
//   node server/src/math/optimize.js [--target 0.96]
//
// Работает на точной модели из analytic.js, поэтому перебор идёт за секунды,
// а не за часы симуляции. Ключевая оптимизация: статистика базовой игры и
// фриспинов считается независимо (25 + 25 вариантов), а потом 625 пар
// комбинируются арифметикой — вместо 625 полных расчётов.

"use strict";

const C = require("./gameConfig");
const { modeStats } = require("./analytic");

const TARGET = 0.96;

// Символы-наполнители: их количеством регулируется длина ленты,
// а значит и вероятность любой комбинации.
const FILLERS = [C.SYM.GEM_RED, C.SYM.GEM_AMBER, C.SYM.GEM_GREEN, C.SYM.GEM_AQUA, C.SYM.GEM_PURPLE];
const WILD_REELS = [1, 2, 3];   // дикий не появляется на первом и пятом барабане

const WILD_MULT_EXPECT =
  C.FREESPINS.wildMultipliers.reduce((a, b) => a + b, 0) / C.FREESPINS.wildMultipliers.length;

/**
 * Применяет к составу дельты по наполнителям, диким и скаттерам.
 *
 * fillerUnits снимает наполнители по одному, распределяя удаления по кругу
 * (барабан за барабаном, символ за символом). Шаг в одну единицу меняет RTP
 * примерно на 0.2 %, и этого хватает, чтобы попасть в цель с точностью до
 * сотых — снимать сразу по символу со всех барабанов слишком грубо.
 */
function applyDeltas(counts, fillerUnits, wildCount, scatterCount) {
  const next = counts.map((reel) => reel.slice());
  for (let u = 0; u < fillerUnits; u++) {
    const reel = u % C.REELS;
    const sym = FILLERS[Math.floor(u / C.REELS) % FILLERS.length];
    next[reel][sym] = Math.max(2, next[reel][sym] - 1);
  }
  for (let r = 0; r < C.REELS; r++) {
    if (WILD_REELS.includes(r)) next[r][C.SYM.WILD] = wildCount;
    next[r][C.SYM.SCATTER] = scatterCount;
  }
  return next;
}

function buildFrom(counts, seed) {
  return C.buildStrips(counts, seed);
}

function search({ target = TARGET, verbose = true } = {}) {
  const baseVariants = [];
  const freeVariants = [];

  // ── базовая игра ────────────────────────────────────────────────
  for (let units = 0; units <= 24; units += 1) {
    for (let wild = 3; wild <= 6; wild++) {
      for (const scatter of [2, 3]) {
        const counts = applyDeltas(C.BASE_COUNTS, units, wild, scatter);
        const strips = buildFrom(counts, 0x5eed01);
        const stats = modeStats(strips, 1);
        baseVariants.push({ units, wild, scatter, counts, strips, stats });
      }
    }
  }

  // ── фриспины ────────────────────────────────────────────────────
  for (let units = 0; units <= 24; units += 1) {
    for (let wild = 5; wild <= 9; wild++) {
      const counts = applyDeltas(C.FREE_COUNTS, units, wild, 2);
      const strips = buildFrom(counts, 0x5eed02);
      const stats = modeStats(strips, WILD_MULT_EXPECT);
      freeVariants.push({ units, wild, scatter: 2, counts, strips, stats });
    }
  }
  if (verbose) console.log(`перебор: ${baseVariants.length} × ${freeVariants.length} конфигураций`);

  let best = null;

  for (const b of baseVariants) {
    // Частота бонуса — вопрос ощущения игры, а не только RTP.
    // Реже 1/400 игрок не доживает до фриспинов, чаще 1/90 они перестают
    // быть событием.
    const oneIn = b.stats.triggerProb > 0 ? 1 / b.stats.triggerProb : Infinity;
    if (oneIn < 90 || oneIn > 400) continue;

    for (const f of freeVariants) {
      const branch = C.FREESPINS.retriggerAward * f.stats.triggerProb;
      if (branch >= 0.6) continue;   // слишком частый ретригер — дисперсия улетает

      const spins = b.stats.expectedAwardIfTrigger / (1 - branch);
      const freeRTP = b.stats.triggerProb * spins * f.stats.totalRTP;
      const total = b.stats.totalRTP + freeRTP;
      const freeShare = freeRTP / total;

      // Здоровая пропорция для слота такого типа: фриспины дают
      // от четверти до 40 % возврата.
      if (freeShare < 0.26 || freeShare > 0.40) continue;

      // RTP — жёсткое требование, доля фриспинов — предпочтение.
      // Вес подобран так, чтобы сотые доли RTP всегда перевешивали.
      const err = Math.abs(total - target) + 0.02 * Math.abs(freeShare - 0.32);
      if (!best || err < best.err) {
        best = { err, total, freeShare, base: b, free: f, spins, freeRTP, oneIn };
      }
    }
  }

  if (!best) throw new Error("Не нашлось конфигурации в заданных ограничениях");

  if (verbose) {
    console.log("── найденная конфигурация ─────────────────────────────");
    console.log(`RTP               ${(best.total * 100).toFixed(3)} %  (цель ${(target * 100).toFixed(1)} %)`);
    console.log(`  база, линии     ${(best.base.stats.lineRTP * 100).toFixed(2)} %`);
    console.log(`  база, скаттер   ${(best.base.stats.scatterRTP * 100).toFixed(2)} %`);
    console.log(`  фриспины        ${(best.freeRTP * 100).toFixed(2)} %  (доля ${(best.freeShare * 100).toFixed(1)} %)`);
    console.log(`частота бонуса    1 к ${best.oneIn.toFixed(0)}`);
    console.log(`фриспинов за бонус${best.spins.toFixed(2)}`);
    console.log(`хит-рейт линий    ${(best.base.stats.lineHitRate * 100).toFixed(1)} %`);
    console.log(`длина лент база   ${best.base.strips.map((s) => s.length).join(", ")}`);
    console.log(`длина лент FS     ${best.free.strips.map((s) => s.length).join(", ")}`);
    console.log("");
    console.log("BASE_COUNTS =", JSON.stringify(best.base.counts));
    console.log("FREE_COUNTS =", JSON.stringify(best.free.counts));
  }

  return best;
}

if (require.main === module) {
  const argTarget = process.argv.indexOf("--target");
  const target = argTarget >= 0 ? parseFloat(process.argv[argTarget + 1]) : TARGET;
  search({ target });
}

module.exports = { search, applyDeltas };
