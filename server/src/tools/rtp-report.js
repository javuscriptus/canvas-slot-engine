// Сертификационный отчёт по математике: точный RTP, состав лент,
// частоты и распределение вклада по режимам.
//
//   node server/src/tools/rtp-report.js [--json]
//
// Именно этот вывод прикладывается к заявке в тестовую лабораторию
// вместе с исходниками gameConfig.js и engine.js.

"use strict";

const C = require("../math/gameConfig");
const analytic = require("../math/analytic");

const pct = (v, d = 4) => `${(v * 100).toFixed(d)} %`;
const pad = (s, n) => String(s).padStart(n);

function symbolTable() {
  const rows = [];
  for (let id = 0; id < C.SYMBOL_COUNT; id++) {
    const key = C.SYMBOL_KEYS[id];
    const pays = C.PAYTABLE[id];
    const cells = [3, 4, 5].map((n) => pad(pays?.[n] ?? (id === C.SYM.SCATTER ? C.SCATTER_PAYS[n] : "—"), 6));
    const counts = C.BASE_COUNTS.map((r) => pad(r[id], 3)).join("");
    const freeCounts = C.FREE_COUNTS.map((r) => pad(r[id], 3)).join("");
    rows.push(`  ${pad(id, 2)} ${key.padEnd(10)}${cells.join("")}   ${counts}  |${freeCounts}`);
  }
  return rows.join("\n");
}

function main() {
  const r = analytic.computeRTP();
  const asJson = process.argv.includes("--json");

  if (asJson) {
    console.log(JSON.stringify({
      game: "sochi-sunset",
      rtp: r.total,
      base: r.base,
      free: r.free,
      shares: r.shares,
      config: {
        reels: C.REELS,
        rows: C.ROWS,
        paylines: C.PAYLINES.length,
        paytable: C.PAYTABLE,
        scatterPays: C.SCATTER_PAYS,
        baseCounts: C.BASE_COUNTS,
        freeCounts: C.FREE_COUNTS,
        stripLengths: {
          base: C.BASE_STRIPS.map((s) => s.length),
          free: C.FREE_STRIPS.map((s) => s.length)
        },
        maxWinMultiplier: C.MAX_WIN_MULTIPLIER,
        freespins: C.FREESPINS
      }
    }, null, 2));
    return;
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  СОЧИ · SOCHI SUNSET — отчёт по математической модели");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log(`  Формат            ${C.REELS}×${C.ROWS}, ${C.PAYLINES.length} линий, выплаты слева направо`);
  console.log(`  Дикий             барабаны 2–4, заменяет всё кроме скаттера`);
  console.log(`  Скаттер           платит от общей ставки, 3+ запускают фриспины`);
  console.log(`  Длины лент        база ${C.BASE_STRIPS.map((s) => s.length).join("/")}`);
  console.log(`                    FS   ${C.FREE_STRIPS.map((s) => s.length).join("/")}`);
  console.log("");
  console.log("───────────────────────────── RTP ──────────────────────────────");
  console.log(`  ИТОГО                          ${pct(r.total)}`);
  console.log("");
  console.log(`  базовая игра, линии            ${pct(r.base.lines)}   ${pct(r.shares.baseLines, 1)} вклада`);
  console.log(`  базовая игра, скаттеры         ${pct(r.base.scatter)}   ${pct(r.shares.baseScatter, 1)} вклада`);
  console.log(`  фриспины                       ${pct(r.free.contribution)}   ${pct(r.shares.freeSpins, 1)} вклада`);
  console.log("");
  console.log("──────────────────────────── частоты ───────────────────────────");
  console.log(`  запуск бонуса                  1 к ${r.base.triggerOneIn.toFixed(1)}  (${pct(r.base.triggerProb, 4)})`);
  console.log(`  фриспинов за запуск            ${r.base.expectedAward.toFixed(2)} базовых`);
  console.log(`  ретригер (за фриспин)          ${pct(r.free.retriggerProb, 4)}`);
  console.log(`  множитель от ретригеров        ×${r.free.spinsMultiplier.toFixed(4)}`);
  console.log(`  фриспинов за бонус, итого      ${r.free.expectedTotalSpins.toFixed(2)}`);
  console.log(`  RTP одного фриспина            ${pct(r.free.perSpin, 2)} от ставки`);
  console.log("");
  console.log("──────────────────────── таблица выплат ────────────────────────");
  console.log("  id символ         3     4     5     состав лент база | фриспины");
  console.log(symbolTable());
  console.log("");
  console.log(`  Максимальная выплата за раунд: ${C.MAX_WIN_MULTIPLIER}× общей ставки`);
  console.log("");
  console.log("  Расчёт точный: барабаны независимы, поэтому матожидание");
  console.log("  считается полным перебором 12⁵ комбинаций линии, а не симуляцией.");
  console.log("  Перекрёстная проверка боевого кода — server/src/tools/simulate.js");
  console.log("═══════════════════════════════════════════════════════════════");
}

main();
