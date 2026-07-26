// Тесты математики. Запуск: node --test server/test/
//
// Эти проверки — не формальность. Каждая закрывает ошибку, которая на
// проде стоит денег: перекос RNG, неверная подстановка дикого, выплата
// справа налево, срыв лимита выигрыша.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const C = require("../src/math/gameConfig");
const engine = require("../src/math/engine");
const analytic = require("../src/math/analytic");
const round = require("../src/game/round");
const { SecureRandom, SeededRandom } = require("../src/rng");

/* ───────────────────────────── ленты ────────────────────────────── */

test("состав лент соответствует объявленному", () => {
  C.BASE_STRIPS.forEach((strip, reel) => {
    const counts = new Array(C.SYMBOL_COUNT).fill(0);
    for (const s of strip) counts[s]++;
    assert.deepEqual(counts, C.BASE_COUNTS[reel], `барабан ${reel}`);
  });
});

test("дикий не появляется на первом и пятом барабанах", () => {
  assert.ok(!C.BASE_STRIPS[0].includes(C.SYM.WILD));
  assert.ok(!C.BASE_STRIPS[4].includes(C.SYM.WILD));
  assert.ok(!C.FREE_STRIPS[0].includes(C.SYM.WILD));
  assert.ok(!C.FREE_STRIPS[4].includes(C.SYM.WILD));
});

test("скаттеры разнесены — в окне из 3 ячеек не больше одного", () => {
  for (const strips of [C.BASE_STRIPS, C.FREE_STRIPS]) {
    for (const strip of strips) {
      for (let i = 0; i < strip.length; i++) {
        let n = 0;
        for (let r = 0; r < C.ROWS; r++) {
          if (strip[(i + r) % strip.length] === C.SYM.SCATTER) n++;
        }
        assert.ok(n <= 1, `в окне с позиции ${i} оказалось ${n} скаттеров`);
      }
    }
  }
});

test("нет стеков длиннее двух одинаковых символов подряд", () => {
  for (const strip of [...C.BASE_STRIPS, ...C.FREE_STRIPS]) {
    for (let i = 0; i < strip.length; i++) {
      const a = strip[i];
      const b = strip[(i + 1) % strip.length];
      const c = strip[(i + 2) % strip.length];
      assert.ok(!(a === b && b === c), `стек из трёх ${a} на позиции ${i}`);
    }
  }
});

test("ленты детерминированы: пересборка даёт тот же результат", () => {
  const again = C.buildStrips(C.BASE_COUNTS, 0x5eed01);
  assert.deepEqual(again, C.BASE_STRIPS);
});

/* ───────────────────────── оценка линии ─────────────────────────── */

test("три одинаковых слева направо платят", () => {
  const res = engine.evaluateLine([C.SYM.GEM_AQUA, C.SYM.GEM_AQUA, C.SYM.GEM_AQUA, C.SYM.GEM_RED, C.SYM.GEM_AMBER]);
  assert.equal(res.symbol, C.SYM.GEM_AQUA);
  assert.equal(res.count, 3);
  assert.equal(res.payout, C.PAYTABLE[C.SYM.GEM_AQUA][3]);
});

test("те же три справа налево не платят", () => {
  const res = engine.evaluateLine([C.SYM.GEM_RED, C.SYM.GEM_AMBER, C.SYM.GEM_AQUA, C.SYM.GEM_AQUA, C.SYM.GEM_AQUA]);
  assert.equal(res, null);
});

test("дикий подставляется и считается", () => {
  const res = engine.evaluateLine([C.SYM.SHASHLIK, C.SYM.WILD, C.SYM.SHASHLIK, C.SYM.GEM_GREEN, C.SYM.GEM_AQUA]);
  assert.equal(res.symbol, C.SYM.SHASHLIK);
  assert.equal(res.count, 3);
  assert.equal(res.wilds, 1);
});

test("линия из одних диких платит по лучшему символу", () => {
  const res = engine.evaluateLine([C.SYM.WILD, C.SYM.WILD, C.SYM.WILD, C.SYM.WILD, C.SYM.WILD]);
  const best = Math.max(...C.WILD_SUBSTITUTES.map((s) => C.PAYTABLE[s][5]));
  assert.equal(res.payout, best);
  assert.equal(res.count, 5);
});

test("выбирается самая выгодная трактовка линии", () => {
  // Дикий, дикий, корона, корона, десятка:
  // 4 короны (200) выгоднее, чем 5 десяток тут невозможны,
  // но сравнение с 4 десятками (25) должно выиграть в пользу короны.
  const res = engine.evaluateLine([C.SYM.WILD, C.SYM.WILD, C.SYM.ANCHOR, C.SYM.ANCHOR, C.SYM.GEM_AQUA]);
  assert.equal(res.symbol, C.SYM.ANCHOR);
  assert.equal(res.count, 4);
  assert.equal(res.payout, C.PAYTABLE[C.SYM.ANCHOR][4]);
});

test("скаттер не участвует в линейных комбинациях", () => {
  const res = engine.evaluateLine([C.SYM.SCATTER, C.SYM.SCATTER, C.SYM.SCATTER, C.SYM.GEM_AQUA, C.SYM.GEM_AQUA]);
  assert.equal(res, null);
});

test("дикий не заменяет скаттер", () => {
  const screen = [
    [C.SYM.SCATTER, C.SYM.WILD, C.SYM.SCATTER, C.SYM.GEM_AQUA, C.SYM.GEM_AQUA],
    [C.SYM.GEM_AQUA, C.SYM.GEM_AQUA, C.SYM.GEM_AQUA, C.SYM.GEM_RED, C.SYM.GEM_AMBER],
    [C.SYM.GEM_RED, C.SYM.GEM_AMBER, C.SYM.GEM_GREEN, C.SYM.GEM_PURPLE, C.SYM.GEM_AQUA]
  ];
  const res = engine.evaluateScreen(screen, 20);
  assert.equal(res.scatterCount, 2, "дикий не должен считаться скаттером");
});

/* ──────────────────────── экран и выплаты ───────────────────────── */

test("выплата по линии считается от ставки на линию", () => {
  const screen = [
    [C.SYM.ANCHOR, C.SYM.ANCHOR, C.SYM.ANCHOR, C.SYM.GEM_AQUA, C.SYM.GEM_PURPLE],
    [C.SYM.GEM_AQUA, C.SYM.GEM_PURPLE, C.SYM.GEM_GREEN, C.SYM.GEM_AMBER, C.SYM.GEM_RED],
    [C.SYM.GEM_PURPLE, C.SYM.GEM_GREEN, C.SYM.GEM_AMBER, C.SYM.GEM_RED, C.SYM.GEM_AQUA]
  ];
  const totalBet = 20;
  const res = engine.evaluateScreen(screen, totalBet);
  const lineBet = totalBet / C.PAYLINES.length;   // = 1
  const crownWin = res.wins.find((w) => w.symbol === C.SYM.ANCHOR);
  assert.ok(crownWin);
  assert.equal(crownWin.amount, lineBet * C.PAYTABLE[C.SYM.ANCHOR][3]);
});

test("скаттер платит от общей ставки", () => {
  const screen = [
    [C.SYM.SCATTER, C.SYM.GEM_AQUA, C.SYM.SCATTER, C.SYM.GEM_AQUA, C.SYM.SCATTER],
    [C.SYM.GEM_AQUA, C.SYM.GEM_PURPLE, C.SYM.GEM_GREEN, C.SYM.GEM_AMBER, C.SYM.GEM_RED],
    [C.SYM.GEM_PURPLE, C.SYM.GEM_GREEN, C.SYM.GEM_AMBER, C.SYM.GEM_RED, C.SYM.GEM_AMBER]
  ];
  const res = engine.evaluateScreen(screen, 20);
  const sc = res.wins.find((w) => w.type === "scatter");
  assert.equal(sc.count, 3);
  assert.equal(sc.amount, 20 * C.SCATTER_PAYS[3]);
});

test("множители диких перемножаются только во фриспинах", () => {
  const screen = [
    [C.SYM.ANCHOR, C.SYM.WILD, C.SYM.WILD, C.SYM.GEM_AQUA, C.SYM.GEM_PURPLE],
    [C.SYM.GEM_AQUA, C.SYM.GEM_PURPLE, C.SYM.GEM_GREEN, C.SYM.GEM_AMBER, C.SYM.GEM_RED],
    [C.SYM.GEM_PURPLE, C.SYM.GEM_GREEN, C.SYM.GEM_AMBER, C.SYM.GEM_RED, C.SYM.GEM_AQUA]
  ];
  const base = engine.evaluateScreen(screen, 20, { freeSpin: false });
  const free = engine.evaluateScreen(screen, 20, {
    freeSpin: true,
    multiplierRoll: () => 3
  });
  const b = base.wins.find((w) => w.symbol === C.SYM.ANCHOR);
  const f = free.wins.find((w) => w.symbol === C.SYM.ANCHOR);
  assert.equal(b.multiplier, 1);
  assert.equal(f.multiplier, 9);           // два диких по ×3
  assert.equal(f.amount, b.amount * 9);
});

/* ────────────────────────────── раунд ───────────────────────────── */

test("раунд с бонусом не закрывается, пока есть фриспины", () => {
  const rng = new SeededRandom(12345);
  let r = null;
  for (let i = 0; i < 5000; i++) {
    r = round.startRound(rng, 1);
    if (r.state === round.STATE.FREE) break;
  }
  assert.equal(r.state, round.STATE.FREE, "за 5000 спинов бонус обязан выпасть");
  const total = r.freeSpinsTotal;
  assert.ok(total >= 10);

  let played = 0;
  while (r.state === round.STATE.FREE) {
    round.playFreeSpin(rng, r);
    played++;
    assert.ok(played < 300, "бонус не должен быть бесконечным");
  }
  assert.equal(r.state, round.STATE.COMPLETE);
  assert.equal(r.freeSpinsLeft, 0);
  assert.equal(r.freeSpinsPlayed, played);
});

test("лимит выигрыша срезает выплату", () => {
  const r = {
    bet: 1,
    totalWin: C.MAX_WIN_MULTIPLIER * 10,
    state: round.STATE.COMPLETE
  };
  round.applyCap(r);
  assert.equal(r.totalWin, C.MAX_WIN_MULTIPLIER);
  assert.equal(r.capped, true);
});

/* ─────────────────────────────── RNG ────────────────────────────── */

test("RNG не выходит за границу", () => {
  const rng = new SecureRandom();
  for (let i = 0; i < 20000; i++) {
    const v = rng.nextInt(67);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 67);
  }
});

test("RNG равномерен: хи-квадрат в пределах нормы", () => {
  const rng = new SecureRandom();
  const k = 32;
  const n = 320000;
  const buckets = new Array(k).fill(0);
  for (let i = 0; i < n; i++) buckets[rng.nextInt(k)]++;

  const expected = n / k;
  let chi2 = 0;
  for (const b of buckets) chi2 += (b - expected) ** 2 / expected;

  // 31 степень свободы, критическое значение при p=0.001 ≈ 65.
  assert.ok(chi2 < 65, `χ² = ${chi2.toFixed(1)} — распределение подозрительное`);
});

/* ─────────────────────────── аналитика ──────────────────────────── */

test("RTP в объявленном диапазоне", () => {
  const r = analytic.computeRTP();
  assert.ok(r.total > 0.955 && r.total < 0.965,
    `RTP ${(r.total * 100).toFixed(3)} % вышел за 95.5–96.5 %`);
});

test("ветвящийся процесс ретригера сходится", () => {
  const r = analytic.computeRTP();
  assert.ok(r.free.spinsMultiplier > 1 && r.free.spinsMultiplier < 1.5);
});

test("сумма вкладов равна общему RTP", () => {
  const r = analytic.computeRTP();
  const sum = r.base.lines + r.base.scatter + r.free.contribution;
  assert.ok(Math.abs(sum - r.total) < 1e-9);
});

test("распределение скаттеров — корректная вероятностная мера", () => {
  const dist = analytic.totalScatterDistribution(C.BASE_STRIPS);
  const sum = dist.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `сумма вероятностей ${sum}`);
});
