// Валюты: пересчёт минорных единиц, номиналы ставки и лимиты оператора.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const money = require("../src/money");
const C = require("../src/math/gameConfig");

test("рубль: одна монета ставки — один рубль", () => {
  assert.equal(money.denominationMinor("RUB"), 100);
  assert.equal(money.toMinor(1, "RUB"), 100);
  assert.equal(money.toMajor(12345, "RUB"), 123.45);
});

test("иена: минорных единиц нет, деления на 100 быть не должно", () => {
  const s = money.spec("JPY");
  assert.equal(s.decimals, 0);
  assert.equal(s.minorUnits, 1);
  // 1 монета = 20 иен, значит и 20 минорных единиц.
  assert.equal(money.denominationMinor("JPY"), 20);
  assert.equal(money.toMajor(1234, "JPY"), 1234);
});

test("доллар: номинал 0.1 — минимальная ставка 2 цента", () => {
  assert.equal(money.denominationMinor("USD"), 10);
  assert.equal(money.toMinor(0.2, "USD"), 2);
  assert.equal(money.toMajor(2, "USD"), 0.02);
});

test("пересчёт туда-обратно не теряет копейки ни на одном уровне ставки", () => {
  for (const code of Object.keys(money.CURRENCIES)) {
    for (const coins of C.BET_LEVELS) {
      const minor = money.toMinor(coins, code);
      assert.ok(Number.isInteger(minor), `${code} ${coins}: минорные единицы дробные`);
      assert.ok(minor > 0, `${code} ${coins}: ставка обнулилась`);
    }
  }
});

test("неизвестная валюта не роняет сервер, а получает нейтральные правила", () => {
  assert.equal(money.isKnown("XYZ"), false);
  assert.equal(money.toMajor(100, "XYZ"), 1);
  assert.equal(money.denominationMinor("XYZ"), 100);
});

test("лимиты оператора разбираются по валютам, мусор игнорируется", () => {
  const limits = money.parseLimits("USD:20:500000, JPY:2000:50000000,,BROKEN,EUR:x:y");
  assert.deepEqual(limits.USD, { minBetMinor: 20, maxBetMinor: 500000 });
  assert.deepEqual(limits.JPY, { minBetMinor: 2000, maxBetMinor: 50000000 });
  assert.equal(limits.EUR, undefined);
  assert.equal(limits.BROKEN, undefined);
});

test("публичное описание валюты отдаёт уровни ставок уже в деньгах", () => {
  const pub = money.publicCurrency("USD", { minBetMinor: 2, maxBetMinor: 100000 }, C.BET_LEVELS);
  assert.equal(pub.code, "USD");
  assert.equal(pub.symbol, "$");
  assert.equal(pub.decimals, 2);
  assert.equal(pub.betLevels[0], 0.02);
  assert.equal(pub.minBet, 0.02);
  assert.equal(pub.maxBet, 1000);
  // Порядок обязан совпадать с BET_LEVELS: клиент индексирует по нему.
  assert.equal(pub.betLevels.length, C.BET_LEVELS.length);
});
