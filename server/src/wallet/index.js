// Кошелёк. Две реализации за одним интерфейсом:
//
//   LocalWallet    — баланс живёт в нашей БД. Демо, витрина, нагрузочные тесты.
//   SeamlessWallet — баланс живёт у оператора, мы ходим к нему по HTTP.
//                    Это стандартная схема интеграции игрового контента:
//                    провайдер не хранит деньги, а только запрашивает
//                    списание ставки и зачисление выигрыша.
//
// Контракт одинаков, поэтому переключение — вопрос одной переменной окружения.
//
// Общее для обеих реализаций правило: КАЖДОЕ движение денег оставляет строку
// в transactions. Раньше журнал вёл только локальный кошелёк, а бесшовный —
// ни одной строки. В бою это означало отсутствие аудита денег: после падения
// процесса нечем ни свериться с оператором, ни понять, что откатывать.

"use strict";

const crypto = require("node:crypto");

class WalletError extends Error {
  constructor(code, message, { retriable = false } = {}) {
    super(message);
    this.code = code;
    this.retriable = retriable;
  }
}

/* ──────────────────────── локальный кошелёк ─────────────────────── */

class LocalWallet {
  constructor(db) {
    this.db = db;
    this.kind = "local";
  }

  async getBalance(player) {
    const p = this.db.getPlayer(player.id);
    return p.balance_minor;
  }

  /**
   * Ставка. Изменение баланса и запись в журнал идут одной транзакцией:
   * порознь они дают состояние «деньги списаны, следа нет», которое
   * не воспроизводится и не разбирается.
   */
  async bet({ player, roundId, amountMinor }) {
    return this.db.transaction(() => {
      const { tx, fresh } = this.db.beginTx({
        roundId, playerId: player.id, type: "bet", amountMinor: -amountMinor
      });
      if (!fresh) {
        return { balanceMinor: tx.balance_after, txId: tx.id, replayed: true };
      }

      const balance = this.db.adjustBalance(player.id, -amountMinor);
      if (balance === null) {
        // Откат транзакции уберёт и открытую строку журнала — так и надо:
        // денег не двигали, записывать нечего. След отказа остаётся
        // в раунде, он помечается aborted.
        throw new WalletError("INSUFFICIENT_FUNDS", "Недостаточно средств");
      }
      this.db.settleTx(tx.id, { amountMinor: -amountMinor, balanceAfter: balance });
      return { balanceMinor: balance, txId: tx.id };
    });
  }

  async win({ player, roundId, amountMinor }) {
    return this.db.transaction(() => {
      const { tx, fresh } = this.db.beginTx({
        roundId, playerId: player.id, type: "win", amountMinor
      });
      if (!fresh) {
        return { balanceMinor: tx.balance_after, txId: tx.id, replayed: true };
      }

      const balance = amountMinor > 0
        ? this.db.adjustBalance(player.id, amountMinor)
        : this.db.getPlayer(player.id).balance_minor;

      this.db.settleTx(tx.id, { amountMinor, balanceAfter: balance });
      return { balanceMinor: balance, txId: tx.id };
    });
  }

  async rollback({ player, roundId }) {
    const bet = this.db.q.txByRoundType.get(roundId, "bet");
    if (!bet || bet.status === "failed") {
      return { balanceMinor: await this.getBalance(player) };
    }

    return this.db.transaction(() => {
      const { tx, fresh } = this.db.beginTx({
        roundId, playerId: player.id, type: "rollback", amountMinor: -bet.amount_minor
      });
      if (!fresh) return { balanceMinor: tx.balance_after };

      const balance = this.db.adjustBalance(player.id, -bet.amount_minor);
      this.db.settleTx(tx.id, { amountMinor: -bet.amount_minor, balanceAfter: balance });
      return { balanceMinor: balance };
    });
  }
}

/* ─────────────────────── бесшовный кошелёк ──────────────────────── */

/**
 * Ходит в API оператора. Каждый запрос подписан HMAC-SHA256 по телу и
 * временной метке — так оператор убеждается, что запрос пришёл от нас
 * и не был переигран злоумышленником.
 *
 * Ожидаемые эндпоинты оператора:
 *   POST {baseUrl}/balance   { playerId }                        → { balance }
 *   POST {baseUrl}/bet       { playerId, roundId, amount, ... }  → { balance, transactionId }
 *   POST {baseUrl}/win       { playerId, roundId, amount, ... }  → { balance, transactionId }
 *   POST {baseUrl}/rollback  { playerId, roundId }               → { balance }
 */
class SeamlessWallet {
  constructor({ baseUrl, secret, operatorId, gameId, db, timeoutMs = 8000, retries = 2 }) {
    if (!baseUrl || !secret) {
      throw new Error("SeamlessWallet: нужны WALLET_URL и WALLET_SECRET");
    }
    if (!db) {
      throw new Error("SeamlessWallet: нужен доступ к БД для журнала транзакций");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.secret = secret;
    this.operatorId = operatorId;
    this.gameId = gameId;
    this.db = db;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.kind = "seamless";
  }

  _sign(bodyString, timestamp) {
    return crypto
      .createHmac("sha256", this.secret)
      .update(`${timestamp}.${bodyString}`)
      .digest("hex");
  }

  async _call(endpoint, payload, { idempotencyKey } = {}) {
    const body = JSON.stringify({
      ...payload,
      operatorId: this.operatorId,
      gameId: this.gameId
    });
    const ts = Date.now().toString();

    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Timestamp": ts,
            "X-Signature": this._sign(body, ts),
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
          },
          body,
          signal: controller.signal
        });
        clearTimeout(timer);

        const data = await res.json().catch(() => ({}));

        if (res.status === 402 || data.error === "INSUFFICIENT_FUNDS") {
          throw new WalletError("INSUFFICIENT_FUNDS", "Недостаточно средств");
        }
        if (!res.ok) {
          // 5xx — можно повторить, 4xx — нет: повтор ничего не изменит.
          throw new WalletError(
            data.error || "WALLET_ERROR",
            data.message || `Кошелёк вернул HTTP ${res.status}`,
            { retriable: res.status >= 500 }
          );
        }
        return data;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        const retriable = err.name === "AbortError" || err.retriable || err.code === "ECONNRESET";
        if (!retriable || attempt === this.retries) break;
        // Экспоненциальная пауза: 150 мс, 300 мс…
        await new Promise((r) => setTimeout(r, 150 * Math.pow(2, attempt)));
      }
    }
    if (lastError instanceof WalletError) throw lastError;
    throw new WalletError("WALLET_UNAVAILABLE", `Кошелёк недоступен: ${lastError?.message}`, { retriable: true });
  }

  /**
   * Денежный вызов к оператору с записью в журнал.
   *
   * Строка открывается ДО запроса и закрывается по его результату.
   * Строка в статусе pending — это и есть «мы не знаем, прошли деньги
   * или нет»: именно её ищет сверка после падения процесса.
   */
  async _money({ player, roundId, type, amountMinor, endpoint, payload }) {
    const { tx, fresh } = this.db.beginTx({
      roundId, playerId: player.id, type, amountMinor
    });
    if (!fresh && tx.status === "ok") {
      return { balanceMinor: tx.balance_after, txId: tx.id, externalRef: tx.external_ref, replayed: true };
    }

    let data;
    try {
      // Ключ идемпотентности у оператора — тот же roundId:type. Повтор
      // после обрыва не создаёт у него вторую операцию.
      data = await this._call(endpoint, payload, { idempotencyKey: `${roundId}:${type}` });
    } catch (err) {
      // Недостаток средств — отказ, а не авария: строку закрываем как
      // failed, иначе сверка будет вечно искать несуществующие деньги.
      // Сетевой сбой оставляем pending: деньги могли и уйти.
      if (err.code === "INSUFFICIENT_FUNDS" || !err.retriable) {
        this.db.failTx(tx.id, err.code);
      }
      throw err;
    }

    const balanceMinor = Math.round(data.balance);
    this.db.settleTx(tx.id, {
      amountMinor, balanceAfter: balanceMinor, externalRef: data.transactionId || null
    });
    return { balanceMinor, txId: tx.id, externalRef: data.transactionId || null };
  }

  async getBalance(player) {
    const r = await this._call("balance", { playerId: player.external_id });
    return Math.round(r.balance);
  }

  async bet({ player, roundId, amountMinor, currency }) {
    return this._money({
      player, roundId, type: "bet", amountMinor: -amountMinor, endpoint: "bet",
      payload: { playerId: player.external_id, roundId, amount: amountMinor, currency }
    });
  }

  async win({ player, roundId, amountMinor, currency }) {
    return this._money({
      player, roundId, type: "win", amountMinor, endpoint: "win",
      payload: { playerId: player.external_id, roundId, amount: amountMinor, currency }
    });
  }

  async rollback({ player, roundId, currency }) {
    const bet = this.db.q.txByRoundType.get(roundId, "bet");
    if (!bet || bet.status === "failed") {
      return { balanceMinor: await this.getBalance(player) };
    }
    return this._money({
      player, roundId, type: "rollback", amountMinor: -bet.amount_minor, endpoint: "rollback",
      payload: { playerId: player.external_id, roundId, currency }
    });
  }
}

function createWallet(config, db) {
  if (config.wallet.mode === "seamless") {
    return new SeamlessWallet({
      baseUrl: config.wallet.url,
      secret: config.wallet.secret,
      operatorId: config.wallet.operatorId,
      gameId: config.gameId,
      db
    });
  }
  return new LocalWallet(db);
}

module.exports = { LocalWallet, SeamlessWallet, WalletError, createWallet };
