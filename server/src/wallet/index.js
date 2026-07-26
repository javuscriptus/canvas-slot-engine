// Кошелёк. Две реализации за одним интерфейсом:
//
//   LocalWallet    — баланс живёт в нашей БД. Демо, витрина, нагрузочные тесты.
//   SeamlessWallet — баланс живёт у оператора, мы ходим к нему по HTTP.
//                    Это стандартная схема интеграции игрового контента:
//                    провайдер не хранит деньги, а только запрашивает
//                    списание ставки и зачисление выигрыша.
//
// Контракт одинаков, поэтому переключение — вопрос одной переменной окружения.

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

  async bet({ player, roundId, amountMinor }) {
    const existing = this.db.q.txByRoundType.get(roundId, "bet");
    if (existing) {
      return { balanceMinor: existing.balance_after, txId: existing.id, replayed: true };
    }

    const balance = this.db.adjustBalance(player.id, -amountMinor);
    if (balance === null) {
      throw new WalletError("INSUFFICIENT_FUNDS", "Недостаточно средств");
    }
    const tx = this.db.recordTx({
      roundId, playerId: player.id, type: "bet",
      amountMinor: -amountMinor, balanceAfter: balance
    });
    return { balanceMinor: balance, txId: tx.id };
  }

  async win({ player, roundId, amountMinor }) {
    const existing = this.db.q.txByRoundType.get(roundId, "win");
    if (existing) {
      return { balanceMinor: existing.balance_after, txId: existing.id, replayed: true };
    }

    const balance = amountMinor > 0
      ? this.db.adjustBalance(player.id, amountMinor)
      : this.db.getPlayer(player.id).balance_minor;

    const tx = this.db.recordTx({
      roundId, playerId: player.id, type: "win",
      amountMinor, balanceAfter: balance
    });
    return { balanceMinor: balance, txId: tx.id };
  }

  async rollback({ player, roundId }) {
    const bet = this.db.q.txByRoundType.get(roundId, "bet");
    if (!bet) return { balanceMinor: await this.getBalance(player) };
    const already = this.db.q.txByRoundType.get(roundId, "rollback");
    if (already) return { balanceMinor: already.balance_after };

    const balance = this.db.adjustBalance(player.id, -bet.amount_minor);
    this.db.recordTx({
      roundId, playerId: player.id, type: "rollback",
      amountMinor: -bet.amount_minor, balanceAfter: balance
    });
    return { balanceMinor: balance };
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
  constructor({ baseUrl, secret, operatorId, gameId, timeoutMs = 8000, retries = 2 }) {
    if (!baseUrl || !secret) {
      throw new Error("SeamlessWallet: нужны WALLET_URL и WALLET_SECRET");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.secret = secret;
    this.operatorId = operatorId;
    this.gameId = gameId;
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

  async getBalance(player) {
    const r = await this._call("balance", { playerId: player.external_id });
    return Math.round(r.balance);
  }

  async bet({ player, roundId, amountMinor, currency }) {
    const r = await this._call("bet", {
      playerId: player.external_id,
      roundId,
      amount: amountMinor,
      currency
    }, { idempotencyKey: `${roundId}:bet` });
    return { balanceMinor: Math.round(r.balance), txId: r.transactionId };
  }

  async win({ player, roundId, amountMinor, currency }) {
    const r = await this._call("win", {
      playerId: player.external_id,
      roundId,
      amount: amountMinor,
      currency
    }, { idempotencyKey: `${roundId}:win` });
    return { balanceMinor: Math.round(r.balance), txId: r.transactionId };
  }

  async rollback({ player, roundId }) {
    const r = await this._call("rollback", {
      playerId: player.external_id,
      roundId
    }, { idempotencyKey: `${roundId}:rollback` });
    return { balanceMinor: Math.round(r.balance) };
  }
}

function createWallet(config, db) {
  if (config.wallet.mode === "seamless") {
    return new SeamlessWallet({
      baseUrl: config.wallet.url,
      secret: config.wallet.secret,
      operatorId: config.wallet.operatorId,
      gameId: config.gameId
    });
  }
  return new LocalWallet(db);
}

module.exports = { LocalWallet, SeamlessWallet, WalletError, createWallet };
