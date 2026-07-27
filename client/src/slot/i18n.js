// Локализация: механизм здесь, сами тексты — в теме.
//
// Разделение не формальное. Половина строк слота одинакова у любой игры
// («БАЛАНС», «СТАВКА», «Недостаточно средств»), а половина описывает
// конкретную тему («Якорь Сочи», правила про диких на 2, 3 и 4 барабанах).
// Поэтому словарь приходит параметром: добавление языка — это правка темы,
// а не движка и не слота.

export class I18n {
  /**
   * @param lang    выбранный язык
   * @param strings { ru: {...}, en: {...} } — ключ → строка или функция
   * @param symbols { ru: { ключСимвола: имя }, … }
   */
  constructor(lang, { strings, symbols = {} } = {}) {
    this.strings = strings;
    this.symbols = symbols;
    this.fallback = Object.keys(strings)[0];
    this.lang = strings[lang] ? lang : this.fallback;
  }

  /** Язык из ?lang=, иначе из настроек браузера, иначе первый в словаре. */
  static detect(strings) {
    const q = new URLSearchParams(location.search).get("lang");
    if (q && strings[q]) return q;
    const nav = (navigator.language || "").slice(0, 2).toLowerCase();
    return strings[nav] ? nav : Object.keys(strings)[0];
  }

  /** t("balance") или t("freeSpinsCount", 10) для строк-функций. */
  t(key, ...args) {
    const v = this.strings[this.lang]?.[key] ?? this.strings[this.fallback][key] ?? key;
    return typeof v === "function" ? v(...args) : v;
  }

  symbol(key) {
    return this.symbols[this.lang]?.[key] || this.symbols[this.fallback]?.[key] || key;
  }
}
