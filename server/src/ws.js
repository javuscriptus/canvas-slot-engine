// WebSocket-сервер поверх node:http. Реализация RFC 6455 без зависимостей.
//
// Зачем он нужен и, что важнее, зачем он НЕ нужен.
//
// Ставка и результат спина ходят по HTTP и останутся там. Это денежная
// операция: она обязана быть идемпотентной, повторяемой после обрыва и
// понятной для балансировщиков, прокси и WAF оператора. Запрос-ответ по
// HTTP даёт это бесплатно; через сокет пришлось бы вручную городить
// подтверждения, порядок сообщений и восстановление после реконнекта —
// и каждая ошибка там стоит денег.
//
// Сокет решает другую задачу — доставку того, что инициирует сервер:
//   • баланс изменился снаружи игры (депозит в соседней вкладке);
//   • оператор закрыл сессию или включил режим обслуживания;
//   • напоминание об ответственной игре (reality check);
//   • промо-события: джекпот-тикер, турнирная таблица, «Drops & Wins».
// Всё это невозможно получить опросом без задержек и лишней нагрузки.

"use strict";

const crypto = require("node:crypto");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa
};

const MAX_MESSAGE = 64 * 1024;

/* ─────────────────────────── кадрирование ───────────────────────── */

/** Собирает кадр от сервера. Серверные кадры не маскируются. */
function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || "", "utf8");
  const len = data.length;

  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;   // FIN + опкод
  return Buffer.concat([header, data]);
}

/**
 * Разбирает входящий буфер. Возвращает список сообщений и остаток,
 * который ещё не собрался в полный кадр.
 */
function decodeFrames(buffer, state) {
  const out = [];
  let offset = 0;

  while (true) {
    if (buffer.length - offset < 2) break;

    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;

    if (len === 126) {
      if (buffer.length - pos < 2) break;
      len = buffer.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (buffer.length - pos < 8) break;
      const big = buffer.readBigUInt64BE(pos);
      if (big > BigInt(MAX_MESSAGE)) return { error: "MESSAGE_TOO_BIG" };
      len = Number(big);
      pos += 8;
    }

    if (len > MAX_MESSAGE) return { error: "MESSAGE_TOO_BIG" };

    // Клиент ОБЯЗАН маскировать кадры — иначе это протокольная ошибка.
    if (!masked) return { error: "UNMASKED_FRAME" };
    if (buffer.length - pos < 4) break;
    const mask = buffer.subarray(pos, pos + 4);
    pos += 4;

    if (buffer.length - pos < len) break;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = buffer[pos + i] ^ mask[i & 3];
    pos += len;
    offset = pos;

    if (opcode === OPCODE.CONTINUATION) {
      state.fragments.push(payload);
      if (fin) {
        out.push({ opcode: state.fragmentOpcode, payload: Buffer.concat(state.fragments) });
        state.fragments = [];
        state.fragmentOpcode = null;
      }
    } else if (opcode === OPCODE.TEXT || opcode === OPCODE.BINARY) {
      if (fin) {
        out.push({ opcode, payload });
      } else {
        state.fragmentOpcode = opcode;
        state.fragments = [payload];
      }
    } else {
      // Управляющие кадры не фрагментируются.
      out.push({ opcode, payload });
    }

    if (state.fragments.reduce((s, f) => s + f.length, 0) > MAX_MESSAGE) {
      return { error: "MESSAGE_TOO_BIG" };
    }
  }

  return { frames: out, rest: buffer.subarray(offset) };
}

/* ──────────────────────────── соединение ────────────────────────── */

class Connection {
  constructor(socket, meta) {
    this.socket = socket;
    this.meta = meta;              // { playerId, sessionToken, ip }
    this.alive = true;
    this.closed = false;
    this._buffer = Buffer.alloc(0);
    this._state = { fragments: [], fragmentOpcode: null };
    this.onMessage = null;
    this.onClose = null;

    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("error", () => this.close(1011, "socket error"));
    socket.on("close", () => this._finish());
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    const res = decodeFrames(this._buffer, this._state);
    if (res.error) {
      this.close(1009, res.error);
      return;
    }
    this._buffer = res.rest;

    for (const frame of res.frames) {
      switch (frame.opcode) {
        case OPCODE.TEXT:
          if (this.onMessage) {
            try {
              this.onMessage(JSON.parse(frame.payload.toString("utf8")));
            } catch {
              // Мусор в канале — не повод рвать соединение.
            }
          }
          break;
        case OPCODE.PING:
          this._raw(encodeFrame(OPCODE.PONG, frame.payload));
          break;
        case OPCODE.PONG:
          this.alive = true;
          break;
        case OPCODE.CLOSE:
          this.close(1000, "bye");
          break;
      }
    }
  }

  _raw(buf) {
    if (this.closed || this.socket.destroyed) return;
    try { this.socket.write(buf); } catch { this._finish(); }
  }

  send(type, data = {}) {
    this._raw(encodeFrame(OPCODE.TEXT, JSON.stringify({ type, ...data })));
  }

  ping() {
    this.alive = false;
    this._raw(encodeFrame(OPCODE.PING, Buffer.alloc(0)));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    try {
      this.socket.write(encodeFrame(OPCODE.CLOSE, payload));
      this.socket.end();
    } catch { /* сокет уже мёртв */ }
    this._finish();
  }

  _finish() {
    if (this._finished) return;
    this._finished = true;
    this.closed = true;
    if (this.onClose) this.onClose(this);
  }
}

/* ──────────────────────────── сервер ────────────────────────────── */

class WebSocketHub {
  /**
   * @param {object} opts
   *   path          — путь апгрейда, по умолчанию /ws
   *   authenticate  — (ticket, req) => { playerId } | null.
   *                   На вход приходит ОДНОРАЗОВЫЙ тикет, а не токен сессии:
   *                   query-строка апгрейда оседает в логах прокси, и
   *                   долгоживущий токен там держать нельзя.
   *   heartbeatMs   — интервал ping; молчащие соединения отключаются
   */
  constructor({ path = "/ws", authenticate, heartbeatMs = 25000 } = {}) {
    this.path = path;
    this.authenticate = authenticate;
    this.byPlayer = new Map();     // playerId → Set<Connection>
    this.count = 0;

    // Пинг нужен не только для проверки живости: он же удерживает
    // соединение открытым через прокси, которые рвут «тихие» сокеты.
    this._timer = setInterval(() => this._heartbeat(), heartbeatMs);
    this._timer.unref();
  }

  /** Подключается к серверу: server.on('upgrade', hub.handleUpgrade). */
  handleUpgrade(req, socket, head) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== this.path) {
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (req.headers.upgrade?.toLowerCase() !== "websocket" || !key) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    // Токен сессии в URL — ошибка, а не альтернативный способ входа.
    // Отвечаем 400, чтобы старый клиент сломался громко и был замечен,
    // а не тихо продолжил светить токеном в логах.
    if (url.searchParams.has("token")) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    const ticket = url.searchParams.get("ticket");
    const session = ticket && this.authenticate ? this.authenticate(ticket, req) : null;
    if (!session) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }

    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);

    const conn = new Connection(socket, {
      playerId: session.playerId,
      ip: socket.remoteAddress
    });

    let set = this.byPlayer.get(session.playerId);
    if (!set) {
      set = new Set();
      this.byPlayer.set(session.playerId, set);
    }
    set.add(conn);
    this.count++;

    conn.onClose = () => {
      set.delete(conn);
      if (set.size === 0) this.byPlayer.delete(session.playerId);
      this.count--;
    };

    conn.onMessage = (msg) => {
      // Единственное, что принимаем от клиента, — отклик на живость.
      // Игровые действия по сокету принципиально не обрабатываются.
      if (msg.type === "ping") conn.send("pong", { t: Date.now() });
    };

    conn.send("hello", { t: Date.now(), heartbeat: 25000 });

    if (head && head.length) conn._onData(head);
  }

  /** Отправляет событие всем вкладкам игрока. */
  toPlayer(playerId, type, data) {
    const set = this.byPlayer.get(playerId);
    if (!set) return 0;
    for (const conn of set) conn.send(type, data);
    return set.size;
  }

  broadcast(type, data) {
    let n = 0;
    for (const set of this.byPlayer.values()) {
      for (const conn of set) {
        conn.send(type, data);
        n++;
      }
    }
    return n;
  }

  closePlayer(playerId, code = 4001, reason = "session closed") {
    const set = this.byPlayer.get(playerId);
    if (!set) return;
    for (const conn of set) conn.close(code, reason);
  }

  _heartbeat() {
    for (const set of this.byPlayer.values()) {
      for (const conn of set) {
        if (!conn.alive) {
          conn.close(1001, "no pong");
          continue;
        }
        conn.ping();
      }
    }
  }

  destroy() {
    clearInterval(this._timer);
    for (const set of this.byPlayer.values()) {
      for (const conn of set) conn.close(1001, "shutdown");
    }
    this.byPlayer.clear();
  }
}

module.exports = { WebSocketHub, encodeFrame, decodeFrames, OPCODE };
