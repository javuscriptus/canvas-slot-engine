// Хранилище на node:sqlite — без внешних зависимостей.
//
// Деньги везде хранятся в МИНОРНЫХ ЕДИНИЦАХ (копейках/центах) целыми числами.
// Хранить баланс в double нельзя: 0.1 + 0.2 !== 0.3, и на миллионах спинов
// это превращается в реальное расхождение с бухгалтерией оператора.
//
// Второе сквозное правило: всё, что связано с деньгами, меняется одним
// оператором SQL или одной транзакцией. Между «проверил» и «списал» не должно
// помещаться ни await, ни второй запрос — иначе параллельные вызовы уводят
// баланс в минус, а фриспины становятся бесконечными.

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

-- revoked_at — отзыв сессии оператором.
--
-- Раньше session.close закрывал только сокет, а HTTP-сессия продолжала жить
-- отведённые ей часы. Это обход самоисключения и блокировки: игрок,
-- которого оператор только что выставил из игры, спокойно крутил дальше
-- по тому же токену. Теперь токен гасится в БД, и сокет — лишь следствие.
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  revoked_at  INTEGER,
  revoke_reason TEXT
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

-- free_left дублирует data.freeSpinsLeft намеренно: JSON нельзя уменьшить
-- условным UPDATE, а именно условный UPDATE закрывает гонку параллельных
-- запросов /api/freespin. Колонка — счётчик прав на спин, JSON — состояние
-- раунда; расходиться они не могут, потому что пишутся одним вызовом.
CREATE TABLE IF NOT EXISTS rounds (
  id             TEXT PRIMARY KEY,
  player_id      TEXT NOT NULL REFERENCES players(id),
  bet_minor      INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  state          TEXT NOT NULL,
  total_win_minor INTEGER NOT NULL DEFAULT 0,
  data           TEXT NOT NULL,
  rng_draws      INTEGER NOT NULL DEFAULT 0,
  free_left      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  closed_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rounds_player ON rounds(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_open ON rounds(player_id, state);

-- Журнал движения денег. Пишется в ОБОИХ режимах кошелька: без него после
-- падения процесса нечем ни свериться с оператором, ни откатить ставку.
-- status: pending (запрос ушёл, ответа нет) → ok | failed.
CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  round_id     TEXT NOT NULL REFERENCES rounds(id),
  player_id    TEXT NOT NULL REFERENCES players(id),
  type         TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  balance_after INTEGER,
  external_ref TEXT,
  status       TEXT NOT NULL DEFAULT 'ok',
  note         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER,
  UNIQUE(round_id, type)
);
CREATE INDEX IF NOT EXISTS idx_tx_player ON transactions(player_id, created_at DESC);

-- Ключ идемпотентности пишется ДО денежной операции и в одной транзакции
-- с созданием раунда. Порядок «сначала операция, потом ключ» выглядит
-- безобиднее, но именно он позволяет списать ставку дважды: если зачисление
-- выигрыша упало, ключа ещё нет, и повтор запроса начинает новый раунд.
CREATE TABLE IF NOT EXISTS idempotency (
  key        TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  round_id   TEXT,
  status     TEXT NOT NULL DEFAULT 'done',
  response   TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency(created_at);

-- Провабли-фейр: серверное семя раунда и его хеш.
--
-- Хеш выдаётся игроку ДО спина, семя раскрывается ПОСЛЕ закрытия раунда.
-- Поэтому семя обязано жить в БД отдельно от раунда: на момент выдачи
-- обязательства раунда ещё нет.
CREATE TABLE IF NOT EXISTS fair_seeds (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES players(id),
  server_seed   TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed   TEXT NOT NULL,
  nonce         INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'open',
  round_id      TEXT,
  created_at    INTEGER NOT NULL,
  used_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fair_open ON fair_seeds(player_id, state);
`;

// Индексы по колонкам, которых в первой версии схемы не было. Их нельзя
// класть в SCHEMA: CREATE TABLE IF NOT EXISTS на существующей базе колонку
// не добавит, а CREATE INDEX по несуществующей колонке уронит запуск.
const INDEXES_AFTER_MIGRATION = `
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_rounds_free ON rounds(state, free_left);
`;

/**
 * Колонки, добавленные после первого релиза. node:sqlite не умеет
 * ADD COLUMN IF NOT EXISTS, а боевая база уже существует, поэтому
 * недостающее досыпается по факту.
 */
const MIGRATIONS = [
  ["sessions", "revoked_at", "INTEGER"],
  ["sessions", "revoke_reason", "TEXT"],
  // Четвёртым элементом идёт доливка данных: новая колонка со значением
  // по умолчанию оставила бы недоигранным бонусным раундам ноль прав на
  // спин, и игрок не смог бы ни доиграть фриспины, ни начать новый раунд.
  ["rounds", "free_left", "INTEGER NOT NULL DEFAULT 0",
    `UPDATE rounds SET free_left = COALESCE(json_extract(data, '$.freeSpinsLeft'), 0)
     WHERE state = 'free'`],
  ["transactions", "status", "TEXT NOT NULL DEFAULT 'ok'"],
  ["transactions", "note", "TEXT"],
  ["transactions", "updated_at", "INTEGER"],
  ["idempotency", "round_id", "TEXT"],
  ["idempotency", "status", "TEXT NOT NULL DEFAULT 'done'"],
  ["idempotency", "updated_at", "INTEGER"]
];

class Database {
  constructor(file) {
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this._migrate();
    this.db.exec(INDEXES_AFTER_MIGRATION);
    this._txDepth = 0;
    this._prepare();
  }

  _migrate() {
    for (const [table, column, decl, backfill] of MIGRATIONS) {
      const has = this.db
        .prepare(`SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?`)
        .get(table, column).n;
      if (has) continue;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      if (backfill) this.db.exec(backfill);
    }
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
      spendBalance: d.prepare(
        `UPDATE players SET balance_minor = balance_minor + ?, updated_at = ?
         WHERE id = ? AND balance_minor + ? >= 0`
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
      revokePlayerSessions: d.prepare(
        `UPDATE sessions SET revoked_at = ?, revoke_reason = ?
         WHERE player_id = ? AND revoked_at IS NULL`
      ),
      revokeSession: d.prepare(
        `UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE token = ? AND revoked_at IS NULL`
      ),
      deleteWsTicketsByPlayer: d.prepare(`DELETE FROM ws_tickets WHERE player_id = ?`),

      insertWsTicket: d.prepare(
        `INSERT INTO ws_tickets (ticket, player_id, session_token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ),
      wsTicketByToken: d.prepare(`SELECT * FROM ws_tickets WHERE ticket = ?`),
      deleteWsTicket: d.prepare(`DELETE FROM ws_tickets WHERE ticket = ?`),
      deleteExpiredWsTickets: d.prepare(`DELETE FROM ws_tickets WHERE expires_at < ?`),
      deleteWsTicketsBySession: d.prepare(`DELETE FROM ws_tickets WHERE session_token = ?`),

      insertRound: d.prepare(
        `INSERT INTO rounds (id, player_id, bet_minor, currency, state, total_win_minor, data, rng_draws, free_left, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      updateRound: d.prepare(
        `UPDATE rounds SET state = ?, total_win_minor = ?, data = ?, rng_draws = ?, free_left = ?, closed_at = ?
         WHERE id = ?`
      ),
      // Условное списание права на фриспин. Проверка и уменьшение — один
      // оператор, поэтому два одновременных запроса не могут оба выиграть.
      claimFreeSpin: d.prepare(
        `UPDATE rounds SET free_left = free_left - 1
         WHERE id = ? AND state = 'free' AND free_left > 0`
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
        `INSERT INTO transactions (id, round_id, player_id, type, amount_minor, balance_after, external_ref, status, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      updateTx: d.prepare(
        `UPDATE transactions SET amount_minor = ?, balance_after = ?, external_ref = ?, status = ?, note = ?, updated_at = ?
         WHERE id = ?`
      ),
      txByRoundType: d.prepare(`SELECT * FROM transactions WHERE round_id = ? AND type = ?`),
      txByRound: d.prepare(`SELECT * FROM transactions WHERE round_id = ? ORDER BY created_at`),
      stalePendingTx: d.prepare(
        `SELECT * FROM transactions WHERE status = 'pending' AND created_at < ? ORDER BY created_at`
      ),

      getIdem: d.prepare(`SELECT * FROM idempotency WHERE key = ?`),
      putIdem: d.prepare(
        `INSERT OR IGNORE INTO idempotency (key, player_id, round_id, status, response, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', '', ?, ?)`
      ),
      finishIdem: d.prepare(
        `UPDATE idempotency SET status = 'done', response = ?, updated_at = ? WHERE key = ?`
      ),
      cleanIdem: d.prepare(`DELETE FROM idempotency WHERE created_at < ?`),

      insertFairSeed: d.prepare(
        `INSERT INTO fair_seeds (id, player_id, server_seed, server_seed_hash, client_seed, nonce, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
      ),
      openFairSeed: d.prepare(
        `SELECT * FROM fair_seeds WHERE player_id = ? AND state = 'open' ORDER BY created_at DESC LIMIT 1`
      ),
      fairSeedById: d.prepare(`SELECT * FROM fair_seeds WHERE id = ?`),
      // Прошлое обязательство не удаляется, а помечается заменённым:
      // номер (nonce) обязан расти монотонно, иначе два разных раунда
      // получат одинаковые (clientSeed, nonce) и один и тот же поток.
      dropOpenFairSeeds: d.prepare(
        `UPDATE fair_seeds SET state = 'replaced' WHERE player_id = ? AND state = 'open'`
      ),
      useFairSeed: d.prepare(
        `UPDATE fair_seeds SET state = 'used', round_id = ?, used_at = ? WHERE id = ? AND state = 'open'`
      ),
      lastNonce: d.prepare(
        `SELECT COALESCE(MAX(nonce), -1) AS n FROM fair_seeds WHERE player_id = ?`
      )
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
      const res = this.q.spendBalance.run(deltaMinor, now, playerId, deltaMinor);
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
    if (typeof token !== "string" || !token) return null;
    const s = this.q.sessionByToken.get(token);
    if (!s) return null;
    if (s.revoked_at) return null;
    if (s.expires_at < Date.now()) return null;
    this.q.touchSession.run(Date.now(), token);
    return s;
  }

  /**
   * Гасит все сессии игрока. Это и есть исполнение session.close от
   * оператора: закрыть сокет мало — по живому токену игра продолжится
   * на HTTP, а значит самоисключение и блокировка не работают.
   * @returns {number} сколько сессий погашено
   */
  revokeSessions(playerId, reason = "operator") {
    const res = this.q.revokePlayerSessions.run(Date.now(), String(reason).slice(0, 120), playerId);
    // Тикет на сокет переживает отзыв сессии, если его не убрать явно:
    // consumeWsTicket проверяет только существование сессии.
    this.q.deleteWsTicketsByPlayer.run(playerId);
    return res.changes;
  }

  revokeSession(token, reason = "operator") {
    const res = this.q.revokeSession.run(Date.now(), String(reason).slice(0, 120), token);
    this.q.deleteWsTicketsBySession.run(token);
    return res.changes;
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
    if (typeof ticket !== "string" || !ticket) return null;
    const row = this.q.wsTicketByToken.get(ticket);
    if (!row) return null;
    const res = this.q.deleteWsTicket.run(ticket);
    if (res.changes !== 1) return null;          // тикет уже погасил кто-то другой
    if (row.expires_at < Date.now()) return null;
    // Сессия могла закрыться или быть отозвана между выдачей тикета и апгрейдом.
    const session = this.q.sessionByToken.get(row.session_token);
    if (!session || session.revoked_at || session.expires_at < Date.now()) return null;
    return { playerId: row.player_id, sessionToken: row.session_token };
  }

  /* ─────────────────────────── раунды ───────────────────────────── */

  createRound(round) {
    this.q.insertRound.run(
      round.id, round.playerId, round.betMinor, round.currency,
      round.state, round.totalWinMinor, JSON.stringify(round.data),
      round.rngDraws || 0, freeLeftOf(round.data), Date.now()
    );
  }

  saveRound(id, { state, totalWinMinor, data, rngDraws }) {
    this.q.updateRound.run(
      state, totalWinMinor, JSON.stringify(data), rngDraws || 0, freeLeftOf(data),
      state === "complete" ? Date.now() : null, id
    );
  }

  /**
   * Резервирует один фриспин. Возвращает true только тому вызову, который
   * реально уменьшил счётчик, — этим и закрывается гонка параллельных
   * запросов, где оба читали «осталось 1» и оба играли.
   */
  claimFreeSpin(roundId) {
    return this.q.claimFreeSpin.run(roundId).changes === 1;
  }

  /** Возвращает право на спин, если сыграть его не удалось. */
  releaseFreeSpin(roundId) {
    this.db
      .prepare(`UPDATE rounds SET free_left = free_left + 1 WHERE id = ? AND state = 'free'`)
      .run(roundId);
  }

  getRound(id) {
    if (typeof id !== "string" || !id) return null;
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
    // Отрицательный LIMIT в SQLite означает «без ограничения»: ?limit=-1
    // выгружал бы всю историю игрока одним запросом. Граница ставится
    // здесь, а не только в обработчике, чтобы её нельзя было обойти
    // через другой вызывающий код.
    const n = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 20;
    return this.q.recentRounds.all(playerId, n);
  }

  /* ────────────────────────── транзакции ────────────────────────── */

  /**
   * Открывает запись о движении денег ДО обращения к кошельку.
   *
   * Порядок именно такой: если процесс умрёт во время запроса к оператору,
   * в журнале останется строка со статусом pending — по ней сверка найдёт
   * зависшие деньги. Строка, записанная после успеха, о падении не знает.
   *
   * @returns {{tx:object, fresh:boolean}} fresh=false — операция уже была
   */
  beginTx({ roundId, playerId, type, amountMinor, note = null }) {
    const existing = this.q.txByRoundType.get(roundId, type);
    const now = Date.now();
    if (existing) {
      if (existing.status === "failed") {
        // Прошлая попытка отклонена оператором — повторяем по той же строке,
        // чтобы UNIQUE(round_id, type) остался единственным ключом операции.
        this.q.updateTx.run(amountMinor, null, null, "pending", note, now, existing.id);
        return { tx: this.q.txByRoundType.get(roundId, type), fresh: true };
      }
      return { tx: existing, fresh: false };
    }
    const id = crypto.randomUUID();
    this.q.insertTx.run(id, roundId, playerId, type, amountMinor, null, null, "pending", note, now, now);
    return { tx: this.q.txByRoundType.get(roundId, type), fresh: true };
  }

  settleTx(id, { amountMinor, balanceAfter, externalRef = null, status = "ok", note = null }) {
    this.q.updateTx.run(amountMinor, balanceAfter ?? null, externalRef, status, note, Date.now(), id);
  }

  failTx(id, reason) {
    const row = this.db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id);
    if (!row) return;
    this.q.updateTx.run(row.amount_minor, row.balance_after, row.external_ref, "failed",
      String(reason || "").slice(0, 200), Date.now(), id);
  }

  getRoundTransactions(roundId) {
    return this.q.txByRound.all(roundId);
  }

  /**
   * Транзакции, застрявшие в pending: запрос к кошельку оператора ушёл,
   * а ответа не было — процесс упал или связь оборвалась. Это деньги
   * в неизвестном состоянии, и разобрать их может только сверка.
   */
  getStalePendingTransactions(olderThanMs = 30000) {
    return this.q.stalePendingTx.all(Date.now() - olderThanMs);
  }

  /** Помечает ставку возвращённой — чтобы сверка не искала её повторно. */
  markRolledBack(txId) {
    const row = this.db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txId);
    if (!row) return;
    this.q.updateTx.run(row.amount_minor, row.balance_after, row.external_ref,
      "rolled_back", row.note, Date.now(), txId);
  }

  /* ───────────────────────── идемпотентность ────────────────────── */

  /**
   * Занимает ключ идемпотентности. Вызывается ДО денежной операции.
   *
   * @returns {{claimed:boolean, row?:object}} claimed=false — ключ уже занят;
   *          в row лежит либо готовый ответ, либо ссылка на незавершённый раунд
   */
  claimIdempotency(key, playerId, roundId) {
    const now = Date.now();
    const res = this.q.putIdem.run(key, playerId, roundId, now, now);
    if (res.changes === 0) return { claimed: false, row: this.q.getIdem.get(key) };
    return { claimed: true };
  }

  finishIdempotency(key, response) {
    this.q.finishIdem.run(JSON.stringify(response), Date.now(), key);
  }

  getIdempotent(key) {
    const row = this.q.getIdem.get(key);
    if (!row || row.status !== "done" || !row.response) return null;
    return JSON.parse(row.response);
  }

  /* ────────────────────── провабли-фейр: семена ─────────────────── */

  /**
   * Публикует новое обязательство: серверное семя и его хеш.
   * Прошлое неиспользованное обязательство отменяется — «висящих»
   * обязательств у игрока не бывает больше одного, иначе непонятно,
   * какое из них проверять.
   */
  createFairSeed({ playerId, serverSeed, serverSeedHash, clientSeed }) {
    return this.transaction(() => {
      this.q.dropOpenFairSeeds.run(playerId);
      const id = crypto.randomUUID();
      const nonce = this.q.lastNonce.get(playerId).n + 1;
      this.q.insertFairSeed.run(id, playerId, serverSeed, serverSeedHash, clientSeed, nonce, Date.now());
      return this.q.fairSeedById.get(id);
    });
  }

  getOpenFairSeed(playerId) {
    return this.q.openFairSeed.get(playerId) || null;
  }

  getFairSeed(id) {
    if (typeof id !== "string" || !id) return null;
    return this.q.fairSeedById.get(id) || null;
  }

  /** Привязывает обязательство к раунду. false — семя уже израсходовано. */
  useFairSeed(id, roundId) {
    return this.q.useFairSeed.run(roundId, Date.now(), id).changes === 1;
  }

  /* ─────────────────────────── обслуживание ─────────────────────── */

  /** Периодическая уборка: ключи идемпотентности и протухшие сессии. */
  cleanup({ idempotencyTtlMs = 24 * 3600e3 } = {}) {
    this.q.cleanIdem.run(Date.now() - idempotencyTtlMs);
    this.q.deleteExpiredWsTickets.run(Date.now());
    this.q.deleteExpiredSessions.run(Date.now());
  }

  /**
   * Транзакция с поддержкой вложенности.
   *
   * Вложенность нужна не для красоты: кошелёк меняет баланс и пишет
   * журнал внутри своей транзакции, а вызывать его могут уже изнутри
   * чужой. BEGIN внутри BEGIN — ошибка SQLite, SAVEPOINT — нет.
   */
  transaction(fn) {
    const nested = this._txDepth > 0;
    const name = `sp_${this._txDepth}`;
    this.db.exec(nested ? `SAVEPOINT ${name}` : "BEGIN IMMEDIATE");
    this._txDepth++;
    try {
      const out = fn();
      this.db.exec(nested ? `RELEASE ${name}` : "COMMIT");
      this._txDepth--;
      return out;
    } catch (e) {
      this.db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : "ROLLBACK");
      this._txDepth--;
      throw e;
    }
  }

  close() {
    this.db.close();
  }
}

/** Сколько прав на фриспин осталось по состоянию раунда. */
function freeLeftOf(data) {
  const n = Number(data?.freeSpinsLeft);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

module.exports = { Database };
