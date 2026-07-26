// Монте-Карло проверка математики.
//
//   node server/src/tools/simulate.js --spins 20000000 --workers 8
//
// Аналитический расчёт (math/analytic.js) даёт точный RTP. Симуляция нужна
// для другого: подтвердить, что боевой код спина реализует ту же модель,
// и измерить то, что аналитикой считать неудобно — волатильность,
// распределение выигрышей, максимум за миллионы спинов.

"use strict";

const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const C = require("../math/gameConfig");
const round = require("../game/round");
const { SeededRandom } = require("../rng");

const BET = 1;

// Границы корзин в ставках — по ним строится распределение выигрышей.
const BUCKETS = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 5000, Infinity];

/* ───────────────────────────── воркер ───────────────────────────── */

function runChunk(spins, seed) {
  const rng = new SeededRandom(seed);

  let totalBet = 0;
  let totalWin = 0;
  let baseWinSum = 0;
  let freeWinSum = 0;
  let hits = 0;
  let bonuses = 0;
  let freeSpinsPlayed = 0;
  let maxWin = 0;
  let sumSq = 0;
  let capped = 0;
  const buckets = new Array(BUCKETS.length - 1).fill(0);

  for (let i = 0; i < spins; i++) {
    const r = round.startRound(rng, BET);
    while (r.state === round.STATE.FREE) {
      round.playFreeSpin(rng, r);
      freeSpinsPlayed++;
    }

    totalBet += BET;
    totalWin += r.totalWin;
    baseWinSum += r.spins[0].win;
    freeWinSum += r.freeWin;
    if (r.totalWin > 0) hits++;
    if (r.freeSpinsTotal > 0) bonuses++;
    if (r.capped) capped++;
    if (r.totalWin > maxWin) maxWin = r.totalWin;

    const x = r.totalWin / BET;
    sumSq += x * x;

    for (let b = 0; b < buckets.length; b++) {
      if (x > BUCKETS[b] && x <= BUCKETS[b + 1]) {
        buckets[b]++;
        break;
      }
    }
  }

  return {
    spins, totalBet, totalWin, baseWinSum, freeWinSum,
    hits, bonuses, freeSpinsPlayed, maxWin, sumSq, capped, buckets
  };
}

if (!isMainThread) {
  parentPort.postMessage(runChunk(workerData.spins, workerData.seed));
}

/* ────────────────────────────── главный ─────────────────────────── */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

async function main() {
  const totalSpins = arg("spins", 5_000_000);
  const workers = Math.max(1, Math.min(arg("workers", os.cpus().length - 1 || 1), 16));
  const per = Math.floor(totalSpins / workers);

  console.log(`Симуляция: ${totalSpins.toLocaleString("ru")} спинов на ${workers} потоках…`);
  const t0 = Date.now();

  const results = await Promise.all(
    Array.from({ length: workers }, (_, i) =>
      new Promise((resolve, reject) => {
        const w = new Worker(__filename, {
          workerData: { spins: per, seed: 0x1234 + i * 7919 }
        });
        w.on("message", resolve);
        w.on("error", reject);
      })
    )
  );

  const agg = results.reduce((a, r) => {
    a.spins += r.spins;
    a.totalBet += r.totalBet;
    a.totalWin += r.totalWin;
    a.baseWinSum += r.baseWinSum;
    a.freeWinSum += r.freeWinSum;
    a.hits += r.hits;
    a.bonuses += r.bonuses;
    a.freeSpinsPlayed += r.freeSpinsPlayed;
    a.sumSq += r.sumSq;
    a.capped += r.capped;
    a.maxWin = Math.max(a.maxWin, r.maxWin);
    r.buckets.forEach((v, i) => (a.buckets[i] += v));
    return a;
  }, {
    spins: 0, totalBet: 0, totalWin: 0, baseWinSum: 0, freeWinSum: 0,
    hits: 0, bonuses: 0, freeSpinsPlayed: 0, sumSq: 0, capped: 0,
    maxWin: 0, buckets: new Array(BUCKETS.length - 1).fill(0)
  });

  const secs = (Date.now() - t0) / 1000;
  const rtp = agg.totalWin / agg.totalBet;
  const mean = rtp;
  const variance = agg.sumSq / agg.spins - mean * mean;
  const sigma = Math.sqrt(variance);

  // Аналитическая эталонная величина
  const analytic = require("../math/analytic").computeRTP();

  const se = sigma / Math.sqrt(agg.spins);          // стандартная ошибка оценки RTP
  const deviation = Math.abs(rtp - analytic.total) / se;

  console.log("");
  console.log("── результат ──────────────────────────────────────────");
  console.log(`спинов              ${agg.spins.toLocaleString("ru")} за ${secs.toFixed(1)} с ` +
    `(${Math.round(agg.spins / secs).toLocaleString("ru")}/с)`);
  console.log(`RTP (симуляция)     ${(rtp * 100).toFixed(4)} %`);
  console.log(`RTP (аналитика)     ${(analytic.total * 100).toFixed(4)} %`);
  console.log(`отклонение          ${deviation.toFixed(2)} σ  ` +
    `${deviation < 3 ? "✓ модели совпадают" : "✗ РАСХОЖДЕНИЕ, проверить engine.js"}`);
  console.log("");
  console.log(`  база              ${(agg.baseWinSum / agg.totalBet * 100).toFixed(3)} %`);
  console.log(`  фриспины          ${(agg.freeWinSum / agg.totalBet * 100).toFixed(3)} %`);
  console.log(`частота выигрыша    ${(agg.hits / agg.spins * 100).toFixed(2)} %  (1 к ${(agg.spins / agg.hits).toFixed(2)})`);
  console.log(`частота бонуса      1 к ${(agg.spins / agg.bonuses).toFixed(0)}`);
  console.log(`фриспинов за бонус  ${(agg.freeSpinsPlayed / agg.bonuses).toFixed(2)}`);
  console.log(`максимум за спин    ${agg.maxWin.toFixed(0)}× ставки`);
  console.log(`срезано лимитом     ${agg.capped} раз(а)`);
  console.log(`СКО выигрыша (σ)    ${sigma.toFixed(2)}  → волатильность: ${volatilityLabel(sigma)}`);
  console.log("");
  console.log("распределение выигрыша за раунд:");
  for (let i = 0; i < agg.buckets.length; i++) {
    const from = BUCKETS[i];
    const to = BUCKETS[i + 1];
    const share = agg.buckets[i] / agg.spins;
    if (share < 1e-7) continue;
    const label = to === Infinity ? `> ${from}×` : `${from}–${to}×`;
    const bar = "█".repeat(Math.max(1, Math.round(share * 300)));
    console.log(`  ${label.padStart(12)}  ${(share * 100).toFixed(4).padStart(8)} %  ${bar}`);
  }
  const zero = 1 - agg.hits / agg.spins;
  console.log(`  ${"без выигрыша".padStart(12)}  ${(zero * 100).toFixed(4).padStart(8)} %`);
}

function volatilityLabel(sigma) {
  if (sigma < 3) return "низкая";
  if (sigma < 6) return "средняя";
  if (sigma < 12) return "высокая";
  return "очень высокая";
}

if (isMainThread && require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runChunk, BUCKETS };
