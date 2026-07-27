// Клиент игрового сервера.
//
// Две вещи, без которых слот нельзя выпускать в прод:
//   • у каждого спина есть requestId — при обрыве связи повтор запроса
//     возвращает ТОТ ЖЕ раунд, а не крутит барабаны заново;
//   • сетевые ошибки различаются на «можно повторить» и «нельзя»:
//     повторять списание ставки вслепую недопустимо.
//
// Повтор безопасен потому, что сервер занимает ключ идемпотентности ДО
// денежной операции и в одной транзакции с созданием раунда. Повторный
// запрос с тем же requestId доигрывает тот же раунд — в том числе когда
// первая попытка упала на зачислении выигрыша.

import { MockGameServer } from "./mockApi.js";

const RETRIABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(code, message, { status = 0, retriable = false } = {}) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.retriable = retriable;
  }
}

export class GameApi {
  constructor({ baseUrl = "", timeoutMs = 15000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.sessionToken = null;
    this.config = null;
    this.fair = null;
    this.onConnectionChange = null;
    this._online = true;
    this.mock = null;
    this.isMock = false;
  }

  _getMock() {
    if (!this.mock) this.mock = new MockGameServer();
    return this.mock;
  }

  _setOnline(v) {
    if (this._online === v) return;
    this._online = v;
    if (this.onConnectionChange) this.onConnectionChange(v);
  }

  async _request(method, path, body, { retries = 2 } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(this.baseUrl + path, {
          method,
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(this.sessionToken ? { Authorization: `Bearer ${this.sessionToken}` } : {})
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });
        clearTimeout(timer);

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const err = new ApiError(data.error || "HTTP_" + res.status, data.message, {
            status: res.status,
            retriable: RETRIABLE_STATUS.has(res.status)
          });
          if (err.retriable && attempt < retries) {
            lastError = err;
            await this._backoff(attempt);
            continue;
          }
          this._setOnline(true);
          throw err;
        }

        this._setOnline(true);
        return data;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof ApiError) throw err;

        lastError = new ApiError("NETWORK", "Нет связи с сервером", { retriable: true });
        this._setOnline(false);
        if (attempt < retries) {
          await this._backoff(attempt);
          continue;
        }
      }
    }
    throw lastError;
  }

  _backoff(attempt) {
    const ms = Math.min(4000, 400 * Math.pow(2, attempt)) * (0.7 + Math.random() * 0.6);
    return new Promise((r) => setTimeout(r, ms));
  }

  static newRequestId() {
    return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  async loadConfig() {
    if (this.isMock) return this._getMock().getConfig();
    try {
      this.config = await this._request("GET", "/api/config");
      return this.config;
    } catch (err) {
      console.warn("Бэкенд недоступен, переход в клиентский демо-режим:", err);
      this.isMock = true;
      this.config = this._getMock().getConfig();
      return this.config;
    }
  }

  async openSession({ launchToken = null } = {}) {
    if (this.isMock) return this._getMock().getSession();
    try {
      const data = await this._request("POST", "/api/session", { launchToken });
      this.sessionToken = data.sessionToken;
      this.fair = data.fair || null;
      return data;
    } catch (err) {
      this.isMock = true;
      const data = this._getMock().getSession();
      this.sessionToken = data.sessionToken;
      this.fair = data.fair || null;
      return data;
    }
  }

  async getState() {
    if (this.isMock) return this._getMock().getState();
    const data = await this._request("GET", "/api/state");
    if (data.fair) this.fair = data.fair;
    return data;
  }

  async spin(bet, requestId = GameApi.newRequestId()) {
    if (this.isMock) return this._getMock().spin(bet);
    const data = await this._request("POST", "/api/spin", { bet, requestId });
    if (data.nextFair) this.fair = data.nextFair;
    return data;
  }

  async freeSpin(roundId, requestId = GameApi.newRequestId()) {
    if (this.isMock) return this._getMock().freeSpin(roundId);
    const data = await this._request("POST", "/api/freespin", { roundId, requestId });
    if (data.nextFair) this.fair = data.nextFair;
    return data;
  }

  async setClientSeed(clientSeed) {
    if (this.isMock) return { hash: "demo-hash" };
    const data = await this._request("POST", "/api/fair/commit", { clientSeed }, { retries: 0 });
    this.fair = data.fair;
    return data.fair;
  }

  async verifyRound(id) {
    if (this.isMock) return { id };
    return this._request("GET", `/api/fair/round/${encodeURIComponent(id)}`);
  }

  async history(limit = 20) {
    if (this.isMock) return this._getMock().getHistory();
    return this._request("GET", `/api/history?limit=${limit}`);
  }

  async round(id) {
    if (this.isMock) return this._getMock().getRound(id);
    return this._request("GET", `/api/round/${encodeURIComponent(id)}`);
  }

  async wsTicket() {
    if (this.isMock) return { ticket: "mock-ticket" };
    return this._request("POST", "/api/ws-ticket", {}, { retries: 0 });
  }
}

