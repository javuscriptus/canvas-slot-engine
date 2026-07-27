// Ограничение частоты запросов.
//
// Ключевое требование — лимит обязан переживать пересоздание сессии.
// Счётчик, привязанный к токену, обходится одним лишним POST /api/session:
// новая сессия — новый ключ — новый пустой счётчик. Поэтому считаем по двум
// осям, ни одна из которых не сбрасывается по желанию клиента: по адресу
// (IP) и по игроку (его внутренний id стабилен, пока это тот же игрок).
//
// Демо-игрок создаётся заново на каждую сессию, и лимит по игроку его не
// сдерживает — именно поэтому лимит по IP не «дублирование», а основная
// защита. В бою игрок приходит с launch-токеном оператора и остаётся тем же.
//
// Хранилище — в памяти процесса. Для одного инстанса этого достаточно;
// при горизонтальном масштабировании класс заменяется на реализацию поверх
// Redis без изменения вызывающего кода: интерфейс — один метод hit().

"use strict";

const WINDOW_MS = 60000;

class RateLimiter {
  /**
   * @param {object} opts
   *   windowMs — длина окна, по умолчанию минута
   *   maxKeys  — потолок числа ключей; защита от роста памяти при
   *              распределённом переборе адресов
   */
  constructor({ windowMs = WINDOW_MS, maxKeys = 50000 } = {}) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  /**
   * Учитывает одно обращение.
   * @returns {{allowed:boolean, retryAfterMs:number, count:number}}
   */
  hit(key, limit) {
    if (!limit || limit <= 0) return { allowed: true, retryAfterMs: 0, count: 0 };

    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || now - b.start >= this.windowMs) {
      b = { start: now, count: 0 };
      // Map сохраняет порядок вставки, поэтому самый старый ключ —
      // первый. Выкидываем его, а не чистим всё: сброс всей таблицы под
      // нагрузкой обнулял бы лимиты ровно тогда, когда они нужнее всего.
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        this.buckets.delete(oldest);
      }
      this.buckets.set(key, b);
    }

    b.count++;
    const allowed = b.count <= limit;
    return {
      allowed,
      count: b.count,
      retryAfterMs: allowed ? 0 : Math.max(0, b.start + this.windowMs - now)
    };
  }

  /** Убирает окна, которые уже истекли. Вызывается по таймеру уборки. */
  sweep() {
    const now = Date.now();
    for (const [key, b] of this.buckets) {
      if (now - b.start >= this.windowMs) this.buckets.delete(key);
    }
  }

  reset() {
    this.buckets.clear();
  }
}

module.exports = { RateLimiter };
