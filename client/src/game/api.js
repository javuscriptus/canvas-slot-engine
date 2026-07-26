// Клиент игрового сервера.
//
// Две вещи, без которых слот нельзя выпускать в прод:
//   • у каждого спина есть requestId — при обрыве связи повтор запроса
//     возвращает ТОТ ЖЕ раунд, а не крутит барабаны заново;
//   • сетевые ошибки различаются на «можно повторить» и «нельзя»:
//     повторять списание ставки вслепую недопустимо.

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
    this.onConnectionChange = null;   // (online: boolean) => void
    this._online = true;
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

        // Сюда попадают обрывы сети и таймауты — их повторять можно,
        // потому что запрос защищён ключом идемпотентности.
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
    this.config = await this._request("GET", "/api/config");
    return this.config;
  }

  /**
   * Открывает сессию. launchToken приходит из URL, когда игру запускает
   * оператор; без него сервер выдаёт демо-сессию (если демо разрешено).
   */
  async openSession({ launchToken = null } = {}) {
    const data = await this._request("POST", "/api/session", { launchToken });
    this.sessionToken = data.sessionToken;
    return data;
  }

  async getState() {
    return this._request("GET", "/api/state");
  }

  async spin(bet, requestId = GameApi.newRequestId()) {
    return this._request("POST", "/api/spin", { bet, requestId });
  }

  async freeSpin(roundId, requestId = GameApi.newRequestId()) {
    return this._request("POST", "/api/freespin", { roundId, requestId });
  }

  async history(limit = 20) {
    return this._request("GET", `/api/history?limit=${limit}`);
  }

  /** Полная запись раунда — для экрана истории и разбора с поддержкой. */
  async round(id) {
    return this._request("GET", `/api/round/${encodeURIComponent(id)}`);
  }

  /**
   * Одноразовый тикет на апгрейд сокета.
   *
   * Повторять нельзя: тикет мог быть выдан и потерян по дороге, но каждый
   * запрос стоит записи в БД, а сеть всё равно чинится реконнектом.
   */
  async wsTicket() {
    return this._request("POST", "/api/ws-ticket", {}, { retries: 0 });
  }
}
