// Форматирование денег.
//
// Правила задаёт сервер: он знает валюту кошелька игрока и число знаков
// после запятой в ней. Клиент не выбирает валюту и не конвертирует — он
// только показывает. Это важно: игра, которая сама решает, что «в валюте
// два знака», в Японии выводит 12.34 вместо 1234.
//
// Разделители берутся из языка интерфейса, а не из валюты: русский игрок
// с долларовым счётом ждёт «1 234,50 $», а не «1,234.50 $».

const LOCALE = { ru: { thousands: " ", decimal: "," }, en: { thousands: ",", decimal: "." } };

export class Money {
  /**
   * @param spec — объект currency из ответа /api/session:
   *   { code, symbol, decimals, unit, betLevels, minBet, maxBet }
   */
  constructor(spec = {}, lang = "ru") {
    this.set(spec, lang);
  }

  set(spec = {}, lang = this.lang || "ru") {
    this.code = spec.code || "RUB";
    this.symbol = spec.symbol || this.code;
    this.decimals = Number.isFinite(spec.decimals) ? spec.decimals : 2;
    // Номинал: во сколько основных единиц обходится одна «монета» ставки.
    // Ставка ходит на сервер в монетах, а игроку показывается в деньгах.
    this.unit = spec.unit || 1;
    this.minBet = spec.minBet ?? 0;
    this.maxBet = spec.maxBet ?? Infinity;
    this.lang = LOCALE[lang] ? lang : "ru";
    this.sep = LOCALE[this.lang];
  }

  /** Монеты ставки → деньги. */
  fromCoins(coins) {
    const k = 10 ** this.decimals;
    return Math.round(coins * this.unit * k) / k;
  }

  /** Только число: для мест, где символ валюты уже подписан рядом. */
  plain(value, { decimals = this.decimals } = {}) {
    const neg = value < 0;
    const fixed = Math.abs(value).toFixed(decimals);
    const [int, frac] = fixed.split(".");
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, this.sep.thousands);
    return `${neg ? "−" : ""}${grouped}${frac ? this.sep.decimal + frac : ""}`;
  }

  /** Число с символом валюты. */
  format(value, opts) {
    return `${this.plain(value, opts)} ${this.symbol}`;
  }

  /** Ставка в монетах → строка с символом валюты. */
  coins(coins, opts) {
    return this.format(this.fromCoins(coins), opts);
  }

  /**
   * Допустимые уровни ставки для этой валюты: сервер режет их по лимитам
   * оператора, но список приходит в деньгах, а играем мы монетами —
   * поэтому фильтруем исходный список монет по денежному эквиваленту.
   */
  filterLevels(levels) {
    const ok = levels.filter((c) => {
      const v = this.fromCoins(c);
      return v >= this.minBet && v <= this.maxBet;
    });
    // Пустой список означал бы, что играть нельзя вообще; лучше показать
    // минимальную ставку и дать серверу отклонить её с внятной ошибкой.
    return ok.length ? ok : [levels[0]];
  }
}
