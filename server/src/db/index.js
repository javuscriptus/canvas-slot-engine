// Хранилище на node:sqlite — без внешних зависимостей.
//
// Деньги везде хранятся в МИНОРНЫХ ЕДИНИЦАХ (копейках/центах) целыми числами.
// Хранить баланс в double нельзя: 0.1 + 0.2 !== 0.3, и на миллионах спинов
// это превращается в реальное расхождение с бухгалтерией оператора.

"use strict";

const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  currency      TEXT NOT NULL DEFAULT 'RUB',
  balance_minor INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);

-- Одноразовые тикеты на апгрейд WebSocket.
--
-- Токен сессии нельзя класть в query-строку: URL апгрейда попадает в логи
-- nginx, в access-логи балансировщика и в Referer. Тикет живёт секунды,
-- срабатывает ровно один раз и не даёт доступа к HTTP-эндпоинтам.
CREATE TABLE IF NOT EXISTS ws_tickets (
  ticket     TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players(id),
  session_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ws_tickets_exp ON ws_tickets(expires_at);

CREATE TABLE IF NOT EXISTS rounds (
  id             TEXT PRIMARY KEY,
  player_id      TEXT NOT NULL REFERENCES players(id),
  bet_minor      INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  state          TEXT NOT NULL,
  total_win_minor INTEGER NOT NULL DEFAULT 0,
  data           TEXT NOT NULL,
  rng_draws      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  closed_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rounds_player ON rounds(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_open ON rounds(player_id, state);

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  round_id     TEXT NOT NULL REFERENCES rounds(id),
  player_id    TEXT NOT NULL REFERENCES players(id),
  type         TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  balance_after INTEGER,
  external_ref TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE(round_id, type)
);
CREATE INDEX IF NOT EXISTS idx_tx_player ON transactions(player_id, created_at DESC);

-- Кеш ответов по ключу идемпотентности: повторный запрос при обрыве связи
-- обязан вернуть тот же результат, а не крутить барабаны заново.
CREATE TABLE IF NOT EXISTS idempotency (
  key        TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  response   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency(created_at);
`;

class Database {
  constructor(file) {
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this._prepare();
  }

  _prepare() {
    const d = this.db;
    this.q = {
      insertPlayer: d.prepare(
        `INSERT INTO players (id, external_id, currency, balance_minor, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ),
      playerByExternal: d.prepare(`SELECT * FROM players WHERE external_id = ?`),
      playerById: d.prepare(`SELECT * FROM players WHERE id = ?`),
      updateBalance: d.prepare(
        `UPDATE players SET balance_minor = balance_minor + ?, updated_at = ? WHERE id = ?`
      ),
      setBalance: d.prepare(
        `UPDATE players SET balance_minor = ?, updated_at = ? WHERE id = ?`
      ),

      insertSession: d.prepare(
        `INSERT INTO sessions (token, player_id, created_at, expires_at, last_seen, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ),
      sessionByToken: d.prepare(`SELECT * FROM sessions WHERE token = ?`),
      touchSession: d.prepare(`UPDATE sessions SET last_seen = ? WHERE token = ?`),
      deleteExpiredSessions: d.prepare(`DELETE FROM sessions WHERE expires_at < ?`),

      insertWsTicket: d.prepare(
        `INSERT INTO ws_tickets (ticket, player_id, session_token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ),
      wsTicketByToken: d.prepare(`SELECT * FROM ws_tickets WHERE ticket = ?`),
      deleteWsTicket: d.prepare(`DELETE FROM ws_tickets WHERE ticket = ?`),
      deleteExpiredWsTickets: d.prepare(`DELETE FROM ws_tickets WHERE expires_at < ?`),
      deleteWsTicketsBySession: d.prepare(`DELETE FROM ws_tickets WHERE session_token = ?`),

      insertRound: d.prepare(
        `INSERT INTO rounds (id, player_id, bet_minor, currency, state, total_win_minor, data, rng_draws, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      updateRound: d.prepare(
        `UPDATE rounds SET state = ?, total_win_minor = ?, data = ?, rng_draws = ?, closed_at = ? WHERE id = ?`
      ),
      roundById: d.prepare(`SELECT * FROM rounds WHERE id = ?`),
      // Только 'free': раунд в состоянии 'pending' — это недоигранная
      // запись между вставкой и результатом спина, её разбирает сверка.
      openRound: d.prepare(
        `SELECT * FROM rounds WHERE player_id = ? AND state = 'free' ORDER BY created_at DESC LIMIT 1`
      ),
      pendingRounds: d.prepare(
        `SELECT * FROM rounds WHERE state = 'pending' AND created_at < ?`
      ),
      blockingRound: d.prepare(
        `SELECT * FROM rounds WHERE player_id = ? AND state IN ('free','pending') ORDER BY created_at DESC LIMIT 1`
      ),
      recentRounds: d.prepare(
        // currency обязателен: без него сумма пересчитывается по правилам
        // «две цифры после запятой», и в иенах история покажет 20.00
        // вместо 2000.
        `SELECT id, bet_minor, total_win_minor, currency, created_at, state
         FROM rounds WHERE player_id = ? ORDER BY created_at DESC LIMIT ?`
      ),

      insertTx: d.prepare(
        `INSERT INTO transactions (id, round_id, player_id, type, amount_minor, balance_after, external_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      txByRoundType: d.prepare(`SELECT * FROM transactions WHERE round_id = ? AND type = ?`),

      getIdem: d.prepare(`SELECT response FROM idempotency WHERE key = ?`),
      putIdem: d.prepare(
        `INSERT OR IGNORE INTO idempotency (key, player_id, response, created_at) VALUES (?, ?, ?, ?)`
      ),
      cleanIdem: d.prepare(`DELETE FROM idempotency WHERE created_at < ?`)
    };
  }

  /* ─────────────────────────── игроки ───────────────────────────── */

  ensurePlayer(externalId, { currency = "RUB", startBalanceMinor = 0 } = {}) {
    const existing = this.q.playerByExternal.get(externalId);
    if (existing) return existing;
    const now = Date.now();
    const id = crypto.randomUUID();
    this.q.insertPlayer.run(id, externalId, currency, startBalanceMinor, now, now);
    return this.q.playerByExternal.get(externalId);
  }

  getPlayer(id) {
    return this.q.playerById.get(id);
  }

  /**
   * Атомарно меняет баланс. Возвращает null, если средств не хватает —
   * проверка и списание идут одним оператором SQL, поэтому параллельные
   * запросы не могут увести баланс в минус.
   */
  adjustBalance(playerId, deltaMinor) {
    const now = Date.now();
    if (deltaMinor < 0) {
      const res = this.db
        .prepare(
          `UPDATE players SET balance_minor = balance_minor + ?, updated_at = ?
           WHERE id = ? AND balance_minor + ? >= 0`
        )
        .run(deltaMinor, now, playerId, deltaMinor);
      if (res.changes === 0) return null;
    } else {
      this.q.updateBalance.run(deltaMinor, now, playerId);
    }
    return this.q.playerById.get(playerId).balance_minor;
  }

  /* ─────────────────────────── сессии ───────────────────────────── */

  createSession(playerId, ttlMs, meta = {}) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    this.q.insertSession.run(token, playerId, now, now + ttlMs, now, meta.ip || null, meta.userAgent || null);
    return token;
  }

  getSession(token) {
    const s = this.q.sessionByToken.get(token);
    if (!s) return null;
    if (s.expires_at < Date.now()) return null;
    this.q.touchSession.run(Date.now(), token);
    return s;
  }

  /* ─────────────────── тикеты на апгрейд сокета ─────────────────── */

  /**
   * Выдаёт одноразовый тикет. Живёт секунды — ровно столько, сколько
   * нужно браузеру, чтобы открыть соединение после ответа HTTP.
   */
  createWsTicket(playerId, sessionToken, ttlMs = 15000) {
    const ticket = crypto.randomBytes(24).toString("base64url");
    const now = Date.now();
    // Больше одного «висящего» тикета на сессию не нужно: если игрок
    // переподключается, старый уже неактуален.
    this.q.deleteWsTicketsBySession.run(sessionToken);
    this.q.insertWsTicket.run(ticket, playerId, sessionToken, now, now + ttlMs);
    return { ticket, expiresAt: now + ttlMs, ttlMs };
  }

  /**
   * Гасит тикет и возвращает его владельца. Повторный вызов с тем же
   * тикетом вернёт null: строка удаляется тем же запросом, и только тот,
   * чей DELETE изменил строку, считается победителем гонки.
   */
  consumeWsTicket(ticket) {
    if (!ticket) return null;
    const row = this.q.wsTicketByToken.get(ticket);
    if (!row) return null;
    const res = this.q.deleteWsTicket.run(ticket);
    if (res.changes !== 1) return null;          // тикет уже погасил кто-то другой
    if (row.expires_at < Date.now()) return null;
    // Сессия могла закрыться между выдачей тикета и апгрейдом.
    const session = this.q.sessionByToken.get(row.session_token);
    if (!session || session.expires_at < Date.now()) return null;
    return { playerId: row.player_id, sessionToken: row.session_token };
  }

  /* ─────────────────────────── раунды ───────────────────────────── */

  createRound(round) {
    this.q.insertRound.run(
      round.id, round.playerId, round.betMinor, round.currency,
      round.state, round.totalWinMinor, JSON.stringify(round.data),
      round.rngDraws || 0, Date.now()
    );
  }

  saveRound(id, { state, totalWinMinor, data, rngDraws }) {
    this.q.updateRound.run(
      state, totalWinMinor, JSON.stringify(data), rngDraws || 0,
      state === "complete" ? Date.now() : null, id
    );
  }

  getRound(id) {
    const r = this.q.roundById.get(id);
    if (!r) return null;
    r.data = JSON.parse(r.data);
    return r;
  }

  getOpenRound(playerId) {
    const r = this.q.openRound.get(playerId);
    if (!r) return null;
    r.data = JSON.parse(r.data);
    return r;
  }

  /** Любой раунд, мешающий начать новый: и бонусный, и «повисший». */
  getBlockingRound(playerId) {
    const r = this.q.blockingRound.get(playerId);
    if (!r) return null;
    r.data = JSON.parse(r.data);
    return r;
  }

  /** Раунды, зависшие в pending — процесс упал между списанием и спином. */
  getStalePendingRounds(olderThanMs = 30000) {
    return this.q.pendingRounds.all(Date.now() - olderThanMs).map((r) => {
      r.data = JSON.parse(r.data);
      return r;
    });
  }

  getHistory(playerId, limit = 20) {
    return this.q.recentRounds.all(playerId, limit);
  }

  /* ────────────────────────── транзакции ────────────────────────── */

  recordTx({ roundId, playerId, type, amountMinor, balanceAfter, externalRef }) {
    const existing = this.q.txByRoundType.get(roundId, type);
    if (existing) return existing;   // идемпотентность на уровне схемы
    const id = crypto.randomUUID();
    this.q.insertTx.run(id, roundId, playerId, type, amountMinor, balanceAfter ?? null, externalRef || null, Date.now());
    return this.q.txByRoundType.get(roundId, type);
  }

  /* ───────────────────────── идемпотентность ────────────────────── */

  getIdempotent(key) {
    const row = this.q.getIdem.get(key);
    return row ? JSON.parse(row.response) : null;
  }

  putIdempotent(key, playerId, response) {
    this.q.putIdem.run(key, playerId, JSON.stringify(response), Date.now());
  }

  /** Периодическая уборка: ключи идемпотентности и протухшие сессии. */
  cleanup({ idempotencyTtlMs = 24 * 3600e3 } = {}) {
    this.q.cleanIdem.run(Date.now() - idempotencyTtlMs);
    this.q.deleteExpiredWsTickets.run(Date.now());
    this.q.deleteExpiredSessions.run(Date.now());
  }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = { Database };
