// Валюты.
//
// Две вещи, которые ломают слоты при выходе на второй рынок.
//
// Первая — предположение «в валюте всегда 100 минорных единиц». В иене и воне
// их нет вовсе: 1 JPY — это и есть минорная единица. Сервер, который делит
// баланс на 100, покажет японцу 12.34 вместо 1234 и спишет ставку в сто раз
// меньше заявленной.
//
// Вторая — ставка, заданная одним числом на все валюты. 100 монет в рублях и
// 100 монет в турецких лирах — разные деньги; уровни ставок обязаны
// пересчитываться через номинал валюты, а лимиты оператора — задаваться
// отдельно для каждой.
//
// Курсов здесь нет и быть не должно: конвертацией занимается оператор,
// игра работает в валюте кошелька игрока и только в ней.

"use strict";

/**
 * decimals   — знаков после запятой в этой валюте;
 * minorUnits — сколько минорных единиц в одной основной (10^decimals);
 * unit       — номинал одной «монеты» ставки в основных единицах.
 *
 * unit подобран так, чтобы минимальная ставка (0.2 монеты) была в районе
 * привычного минимума рынка: 0.20 евро, 20 рублей, 20 иен.
 */
const CURRENCIES = {
  RUB: { decimals: 2, unit: 1,    symbol: "₽" },
  USD: { decimals: 2, unit: 0.1,  symbol: "$" },
  EUR: { decimals: 2, unit: 0.1,  symbol: "€" },
  GBP: { decimals: 2, unit: 0.1,  symbol: "£" },
  KZT: { decimals: 2, unit: 5,    symbol: "₸" },
  UAH: { decimals: 2, unit: 0.5,  symbol: "₴" },
  TRY: { decimals: 2, unit: 0.5,  symbol: "₺" },
  BRL: { decimals: 2, unit: 0.5,  symbol: "R$" },
  INR: { decimals: 2, unit: 10,   symbol: "₹" },
  JPY: { decimals: 0, unit: 20,   symbol: "¥" },
  KRW: { decimals: 0, unit: 200,  symbol: "₩" }
};

const FALLBACK = { decimals: 2, unit: 1, symbol: "" };

function spec(currency) {
  const s = CURRENCIES[String(currency || "").toUpperCase()] || FALLBACK;
  return { ...s, minorUnits: Math.round(10 ** s.decimals) };
}

/** Сколько минорных единиц стоит одна «монета» ставки в этой валюте. */
function denominationMinor(currency) {
  const s = spec(currency);
  return Math.round(s.unit * s.minorUnits);
}

/** Монеты ставки → минорные единицы. */
function toMinor(coins, currency) {
  return Math.round(coins * denominationMinor(currency));
}

/**
 * Минорные единицы → основные, для показа игроку.
 * Возвращается число, а не строка: форматированием занимается клиент,
 * он знает язык интерфейса.
 */
function toMajor(minor, currency) {
  const s = spec(currency);
  return s.decimals === 0 ? Math.round(minor) : minor / s.minorUnits;
}

/**
 * Публичная часть — уходит на клиент вместе с конфигурацией.
 * Клиент по ней форматирует суммы; лимиты уже пересчитаны в основные
 * единицы этой валюты, чтобы клиент ничего не домножал сам.
 */
function publicCurrency(currency, limits, betLevels) {
  const s = spec(currency);
  const code = String(currency || "").toUpperCase();
  return {
    code,
    symbol: s.symbol || code,
    decimals: s.decimals,
    // Номинал: во столько раз уровень ставки в монетах больше основной единицы.
    unit: s.unit,
    // Уровни ставок уже в деньгах — клиенту не нужно знать про монеты.
    betLevels: betLevels.map((c) => round(c * s.unit, s.decimals)),
    minBet: toMajor(limits.minBetMinor, code),
    maxBet: toMajor(limits.maxBetMinor, code)
  };
}

function round(v, decimals) {
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
}

/**
 * Лимиты оператора для конкретной валюты.
 *
 * Формат переменной окружения — «USD:20:500000,JPY:2000:50000000»:
 * код, минимум и максимум в МИНОРНЫХ единицах. Валюта, которой нет
 * в списке, получает общие лимиты.
 */
function parseLimits(raw) {
  const out = {};
  for (const part of String(raw || "").split(",")) {
    const [code, min, max] = part.split(":").map((s) => s.trim());
    if (!code || !min || !max) continue;
    const minBetMinor = parseInt(min, 10);
    const maxBetMinor = parseInt(max, 10);
    if (!Number.isFinite(minBetMinor) || !Number.isFinite(maxBetMinor)) continue;
    out[code.toUpperCase()] = { minBetMinor, maxBetMinor };
  }
  return out;
}

module.exports = {
  CURRENCIES, spec, denominationMinor, toMinor, toMajor,
  publicCurrency, parseLimits, isKnown: (c) => !!CURRENCIES[String(c || "").toUpperCase()]
};
