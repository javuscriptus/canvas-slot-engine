// Денежный контур и защита от абуза.
//
// Каждый тест здесь закрывает конкретную дыру, найденную аудитом, и обязан
// падать на коде до её закрытия. Проверки идут через настоящий HTTP —
// на пересказе логики такие дефекты не ловятся: все они живут именно
// в порядке вызовов между обработчиком, кошельком и БД.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { Database } = require("../src/db");
const { LocalWallet } = require("../src/wallet");
const { RateLimiter } = require("../src/ratelimit");
const { createApp } = require("../src/app");
const fair = require("../src/fair");
const round = require("../src/game/round");

const NOTIFY_SECRET = "notify-secret-0123456789";

function testConfig(over = {}) {
  const base = {
    env: "test",
    isProd: false,
    gameId: "sochi-sunset",
    gameVersion: "test",
    http: {
      host: "127.0.0.1", port: 0, corsOrigins: [], trustProxy: false,
      frameAncestors: ["'self'"], lobbyOrigins: ["'self'"], cspConnect: [],
      staticDir: path.resolve(__dirname, "../../client"), serveStatic: false
    },
    db: { file: ":memory:" },
    session: { ttlMs: 3600e3, launchSecret: "launch-secret" },
    wallet: { mode: "local", url: "", secret: NOTIFY_SECRET, operatorId: "demo" },
    demo: { enabled: true, startBalanceMinor: 1000000, currency: "RUB" },
    ws: { enabled: false, path: "/ws", heartbeatMs: 25000, ticketTtlMs: 15000 },
    limits: {
      spinsPerMinute: 100000, apiPerMinutePerIp: 100000, apiPerMinutePerPlayer: 100000, spinsPerMinutePerIp: 100000,
      sessionsPerMinutePerIp: 100000, wsTicketsPerMinute: 30, fairCommitsPerMinute: 100,
      maxBetMinor: 1000000, minBetMinor: 1, perCurrency: ""
    }
  };
  return {
    ...base, ...over,
    http: { ...base.http, ...(over.http || {}) },
    limits: { ...base.limits, ...(over.limits || {}) },
    demo: { ...base.demo, ...(over.demo || {}) }
  };
}

/** Кошелёк, которому можно приказать уронить зачисление выигрыша. */
class FlakyWallet extends LocalWallet {
  constructor(db) {
    super(db);
    this.failWin = false;
    this.winCalls = 0;
  }

  async win(args) {
    this.winCalls++;
    if (this.failWin) throw new Error("оператор недоступен");
    return super.win(args);
  }
}

async function startApp(over = {}) {
  const config = testConfig(over);
  const db = new Database(config.db.file);
  const wallet = over.wallet instanceof LocalWallet ? over.wallet : new FlakyWallet(db);
  if (wallet.db !== db) wallet.db = db;
  const { server, reconcile } = createApp({ config, db, wallet, limiter: new RateLimiter() });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = {
    async request(method, url, { body, token } = {}) {
      const res = await fetch(base + url, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data, headers: res.headers };
    },
    get(url, opts) { return api.request("GET", url, opts); },
    post(url, opts) { return api.request("POST", url, opts); }
  };

  return {
    config, db, wallet, server, api, reconcile, base,
    async session() {
      const res = await api.post("/api/session", { body: {} });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      return res.data;
    },
    async close() {
      await new Promise((r) => server.close(r));
      db.close();
    }
  };
}

const rid = () => crypto.randomUUID();

/**
 * Подкладывает игроку обязательство, исход которого известен заранее.
 *
 * Иначе тест про фриспины пришлось бы гонять до случайного бонуса —
 * один раз на 164 спина, — а тест про обычный спин иногда попадал бы
 * в бонус и проверял не то. Математика при этом не трогается: перебираются
 * только семена, а не ленты.
 */
function plantSeed(db, playerId, predicate, clientSeed = "test") {
  const nonce = db.q.lastNonce.get(playerId).n + 1;
  for (let i = 0; i < 20000; i++) {
    const serverSeed = fair.newServerSeed();
    const replay = fair.replayRound({ serverSeed, clientSeed, nonce, bet: 1 });
    if (!predicate(replay.round)) continue;
    const seed = db.createFairSeed({
      playerId, serverSeed, serverSeedHash: fair.hashSeed(serverSeed), clientSeed
    });
    assert.equal(seed.nonce, nonce, "номер обязательства сместился — тест нерепрезентативен");
    return { seed, expected: replay.round };
  }
  throw new Error("не удалось подобрать семя под условие");
}

const noBonus = (r) => r.state === round.STATE.COMPLETE;
const withBonus = (r) => r.freeSpinsTotal >= 8;

function signNotify(body) {
  return crypto.createHmac("sha256", NOTIFY_SECRET).update(JSON.stringify(body)).digest("hex");
}

/* ───────────── 1. повтор после сбоя зачисления не списывает дважды ───────────── */

test("сбой зачисления выигрыша не приводит к двойному списанию ставки", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const player = app.db.q.playerByExternal.get(s.player.id);
    plantSeed(app.db, player.id, noBonus);

    const before = app.db.getPlayer(player.id).balance_minor;
    const requestId = rid();

    app.wallet.failWin = true;
    const failed = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId } });
    assert.equal(failed.status, 502, "сбой кошелька обязан быть виден клиенту");
    assert.equal(failed.data.error, "WALLET_WIN_FAILED");

    // Клиент по своей политике повтора шлёт тот же запрос ещё раз —
    // и ещё раз. Ставка при этом обязана списаться ровно один раз.
    app.wallet.failWin = false;
    const retry = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId } });
    assert.equal(retry.status, 200, JSON.stringify(retry.data));
    const retry2 = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId } });
    assert.equal(retry2.status, 200);
    assert.equal(retry2.data.roundId, retry.data.roundId, "повтор обязан вернуть тот же раунд");

    const rounds = app.db.db.prepare(`SELECT COUNT(*) AS n FROM rounds WHERE player_id = ?`).get(player.id).n;
    assert.equal(rounds, 1, "повтор создал новый раунд — ставка списана заново");

    const bets = app.db.db
      .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE player_id = ? AND type = 'bet'`)
      .get(player.id).n;
    assert.equal(bets, 1, "ставка списана больше одного раза");

    const after = app.db.getPlayer(player.id).balance_minor;
    const win = Math.round(retry.data.totalWin * 100);
    assert.equal(after, before - 100 + win, "баланс сошёлся не по одной ставке");
  } finally {
    await app.close();
  }
});

test("ключ идемпотентности записан ДО денежной операции", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const player = app.db.q.playerByExternal.get(s.player.id);
    plantSeed(app.db, player.id, noBonus);

    app.wallet.failWin = true;
    const requestId = rid();
    await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId } });

    const row = app.db.q.getIdem.get(`${player.id}:spin:${requestId}`);
    assert.ok(row, "ключа нет — повтор начнёт новый раунд и спишет ставку снова");
    assert.equal(row.status, "pending");
    assert.ok(row.round_id, "ключ не привязан к раунду — доигрывать нечего");
  } finally {
    await app.close();
  }
});

test("отказ кошелька в ставке возвращается повтору тем же ответом", async () => {
  const app = await startApp({ demo: { enabled: true, startBalanceMinor: 50, currency: "RUB" } });
  try {
    const s = await app.session();
    const requestId = rid();
    const first = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId } });
    assert.equal(first.status, 402);
    const again = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId } });
    assert.equal(again.status, 402, "повтор обязан вернуть тот же отказ");
    assert.equal(again.data.error, first.data.error);
  } finally {
    await app.close();
  }
});

/* ─────────────────── 2. гонка фриспинов ─────────────────── */

test("параллельные /api/freespin не выдают лишних фриспинов", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const player = app.db.q.playerByExternal.get(s.player.id);
    const { expected } = plantSeed(app.db, player.id, withBonus);

    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    assert.equal(spin.status, 200, JSON.stringify(spin.data));
    assert.equal(spin.data.state, "free");
    const awarded = spin.data.freeSpins.total;
    assert.equal(awarded, expected.freeSpinsTotal);

    // Вдвое больше запросов, чем есть прав на спин, и все одновременно.
    const attempts = awarded * 2 + 6;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        app.api.post("/api/freespin", { token: s.sessionToken, body: { requestId: rid() } }))
    );

    const ok = results.filter((r) => r.status === 200);
    const stored = app.db.getRound(spin.data.roundId);
    // Ретригер добавляет спины на законных основаниях, поэтому сверяемся
    // с итоговым состоянием раунда, а не с числом, известным заранее.
    assert.equal(ok.length, stored.data.freeSpinsPlayed,
      "успешных ответов больше, чем сыгранных спинов — часть выдана из воздуха");
    assert.equal(stored.data.freeSpinsPlayed, stored.data.freeSpinsTotal);
    assert.equal(stored.data.freeSpinsLeft, 0);
    assert.equal(stored.free_left, 0);
    assert.equal(stored.state, "complete");

    // Выигрыш зачислен ровно один раз, независимо от числа параллельных попыток.
    const wins = app.db.db
      .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE round_id = ? AND type = 'win'`)
      .get(spin.data.roundId).n;
    assert.equal(wins, 1);
  } finally {
    await app.close();
  }
});

test("фриспин в чужом раунде и без раунда отклоняется", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const nothing = await app.api.post("/api/freespin", { token: s.sessionToken, body: { requestId: rid() } });
    assert.equal(nothing.status, 409);
    assert.equal(nothing.data.error, "NO_ACTIVE_ROUND");

    const player = app.db.q.playerByExternal.get(s.player.id);
    plantSeed(app.db, player.id, withBonus);
    await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });

    const alien = await app.api.post("/api/freespin", {
      token: s.sessionToken,
      body: { requestId: rid(), roundId: crypto.randomUUID() }
    });
    assert.equal(alien.status, 409);
    assert.equal(alien.data.error, "ROUND_MISMATCH");
  } finally {
    await app.close();
  }
});

/* ─────────────────── 3. журнал транзакций ─────────────────── */

test("каждое движение денег оставляет строку в журнале", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const player = app.db.q.playerByExternal.get(s.player.id);
    plantSeed(app.db, player.id, noBonus);

    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    assert.equal(spin.status, 200);

    const rows = app.db.getRoundTransactions(spin.data.roundId);
    const types = rows.map((r) => r.type).sort();
    assert.deepEqual(types, ["bet", "win"]);
    for (const r of rows) {
      assert.equal(r.status, "ok", "строка журнала осталась незакрытой");
      assert.equal(typeof r.balance_after, "number");
    }
    assert.equal(rows.find((r) => r.type === "bet").amount_minor, -100);
  } finally {
    await app.close();
  }
});

/* ─────────────────── 4. отзыв сессии оператором ─────────────────── */

test("session.close от оператора отзывает HTTP-сессию, а не только сокет", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const alive = await app.api.get("/api/state", { token: s.sessionToken });
    assert.equal(alive.status, 200);

    const body = { playerId: s.player.id, event: "session.close", payload: { reason: "самоисключение" } };
    const res = await fetch(`${app.base}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": signNotify(body) },
      body: JSON.stringify(body)
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).sessionsRevoked, 1);

    const dead = await app.api.get("/api/state", { token: s.sessionToken });
    assert.equal(dead.status, 401, "по отозванной сессии игра продолжается — обход блокировки");

    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    assert.equal(spin.status, 401);
  } finally {
    await app.close();
  }
});

test("подпись уведомления обязательна", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const body = { playerId: s.player.id, event: "session.close", payload: {} };
    const res = await fetch(`${app.base}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": "00" },
      body: JSON.stringify(body)
    });
    assert.equal(res.status, 401);
    assert.equal((await app.api.get("/api/state", { token: s.sessionToken })).status, 200);
  } finally {
    await app.close();
  }
});

/* ─────────────────── 5. лимиты ставки ─────────────────── */

test("ставка вне лимитов валюты отвергается сервером", async () => {
  const app = await startApp({ limits: { perCurrency: "RUB:100:500" } });
  try {
    const s = await app.session();
    assert.equal(s.currency.minBet, 1);
    assert.equal(s.currency.maxBet, 5);

    const inside = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    assert.equal(inside.status, 200, JSON.stringify(inside.data));

    // 100 монет — это 10000 копеек при потолке 500.
    const over = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 100, requestId: rid() } });
    assert.equal(over.status, 400, "ставка выше лимита оператора принята");
    assert.equal(over.data.error, "BET_OUT_OF_RANGE");

    const spent = app.db.db
      .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'bet'`).get().n;
    assert.equal(spent, 1, "по отклонённой ставке всё равно списали деньги");
  } finally {
    await app.close();
  }
});

test("ставка не из списка уровней и не-число отвергаются", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    for (const bet of [7.77, "1", null, {}, [], Infinity, -1]) {
      const res = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet, requestId: rid() } });
      assert.equal(res.status, 400, `ставка ${JSON.stringify(bet)} принята`);
      assert.equal(res.data.error, "BAD_BET");
    }
  } finally {
    await app.close();
  }
});

/* ─────────────────── 6. валидация входа ─────────────────── */

test("history: отрицательный и нечисловой limit не проходят", async () => {
  const app = await startApp();
  try {
    const s = await app.session();

    // В SQLite LIMIT -1 означает «без ограничения»: так выгружается
    // вся история игрока одним запросом.
    const negative = await app.api.get("/api/history?limit=-1", { token: s.sessionToken });
    assert.equal(negative.status, 400);

    const garbage = await app.api.get("/api/history?limit=abc", { token: s.sessionToken });
    assert.equal(garbage.status, 400, "нечисловой limit обязан быть 400, а не 500");
    assert.notEqual(garbage.data.error, "INTERNAL_ERROR");

    const huge = await app.api.get("/api/history?limit=100000", { token: s.sessionToken });
    assert.equal(huge.status, 400);

    const ok = await app.api.get("/api/history?limit=5", { token: s.sessionToken });
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.data.rounds));
  } finally {
    await app.close();
  }
});

test("спин без ключа идемпотентности не принимается", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const res = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1 } });
    assert.equal(res.status, 400);
    const bad = await app.api.post("/api/spin", {
      token: s.sessionToken, body: { bet: 1, requestId: "короткий" }
    });
    assert.equal(bad.status, 400);
  } finally {
    await app.close();
  }
});

test("тело запроса обязано быть объектом", async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.base}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["не объект"])
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test("внутренняя ошибка не утекает наружу подробностями", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    // Кошелёк начинает падать неожиданным исключением, а не WalletError.
    app.wallet.getBalance = async () => { throw new Error("SQLITE_CORRUPT: /var/lib/game.db"); };
    const res = await app.api.get("/api/state", { token: s.sessionToken });
    assert.equal(res.status, 500);
    assert.equal(res.data.error, "INTERNAL_ERROR");
    assert.equal(res.data.message, "Внутренняя ошибка");
    assert.ok(res.data.ref, "без ссылки на лог инцидент не разобрать");
    assert.ok(!JSON.stringify(res.data).includes("game.db"));
  } finally {
    await app.close();
  }
});

/* ─────────────────── 7. лимиты частоты ─────────────────── */

test("лимит по адресу переживает пересоздание сессии", async () => {
  const app = await startApp({ limits: { spinsPerMinutePerIp: 2 } });
  try {
    const first = await app.session();
    const player = app.db.q.playerByExternal.get(first.player.id);
    plantSeed(app.db, player.id, noBonus);

    for (let i = 0; i < 2; i++) {
      const r = await app.api.post("/api/spin", { token: first.sessionToken, body: { bet: 1, requestId: rid() } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      plantSeed(app.db, player.id, noBonus);
    }

    // Раньше счётчик жил на игроке, а демо-игрок создаётся заново
    // на каждую сессию: одного лишнего POST /api/session хватало,
    // чтобы обнулить лимит.
    const second = await app.session();
    const blocked = await app.api.post("/api/spin", {
      token: second.sessionToken, body: { bet: 1, requestId: rid() }
    });
    assert.equal(blocked.status, 429);
  } finally {
    await app.close();
  }
});

test("открытие сессий ограничено по адресу", async () => {
  const app = await startApp({ limits: { sessionsPerMinutePerIp: 3 } });
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal((await app.api.post("/api/session", { body: {} })).status, 200);
    }
    assert.equal((await app.api.post("/api/session", { body: {} })).status, 429);
  } finally {
    await app.close();
  }
});

/* ─────────────────── 8. заголовки безопасности ─────────────────── */

test("ответ несёт строгий CSP и остальные заголовки защиты", async () => {
  const app = await startApp();
  try {
    const res = await app.api.get("/healthz");
    const csp = res.headers.get("content-security-policy");
    assert.ok(csp, "CSP отсутствует");
    assert.ok(!csp.includes("unsafe-inline"), "CSP разрешает инлайновые стили и скрипты");
    assert.ok(!csp.includes("unsafe-eval"), "CSP разрешает eval");
    assert.ok(csp.includes("default-src 'none'"));
    assert.ok(csp.includes("script-src 'self'"));
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes("base-uri 'none'"));
    assert.ok(csp.includes("frame-ancestors 'self'"));
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.ok(res.headers.get("permissions-policy").includes("camera=()"));
    // HSTS по HTTP не выдаётся: браузер его всё равно игнорирует,
    // а на localhost он ломает разработку.
    assert.equal(res.headers.get("strict-transport-security"), null);
  } finally {
    await app.close();
  }
});

test("список origin для postMessage приходит с сервера", async () => {
  const app = await startApp({ http: { lobbyOrigins: ["https://lobby.example"] } });
  try {
    const res = await app.api.get("/api/config");
    assert.deepEqual(res.data.lobby.origins, ["https://lobby.example"]);
  } finally {
    await app.close();
  }
});

/* ─────────────────── 9. счётчик обращений к ГПСЧ ─────────────────── */

test("rngDraws считается по своему раунду, а не по всему процессу", async () => {
  const app = await startApp();
  try {
    // Пять сессий крутят одновременно: при общем счётчике каждый раунд
    // забирал бы себе обращения соседей.
    const sessions = await Promise.all([1, 2, 3, 4, 5].map(() => app.session()));
    for (const s of sessions) {
      const player = app.db.q.playerByExternal.get(s.player.id);
      plantSeed(app.db, player.id, noBonus);
    }

    const spins = await Promise.all(sessions.map((s) =>
      app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } })));

    for (const spin of spins) {
      assert.equal(spin.status, 200, JSON.stringify(spin.data));
      const stored = app.db.getRound(spin.data.roundId);
      // Пять барабанов — пять принятых значений на базовый спин.
      assert.equal(stored.rng_draws, 5, "счётчик ГПСЧ раунда испорчен соседними спинами");
    }
  } finally {
    await app.close();
  }
});

/* ─────────────────── 10. провабли-фейр ─────────────────── */

test("хеш серверного семени выдаётся до спина и совпадает после раскрытия", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    assert.ok(s.fair.serverSeedHash, "обязательство не выдано вместе с сессией");
    assert.equal(s.fair.serverSeed, undefined, "серверное семя раскрыто до спина");

    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    assert.equal(spin.status, 200);
    assert.equal(spin.data.fair.serverSeedHash, s.fair.serverSeedHash,
      "раунд сыгран не на том обязательстве, которое видел игрок");
    assert.ok(spin.data.nextFair.serverSeedHash, "обязательство на следующий раунд не выдано");
    assert.notEqual(spin.data.nextFair.serverSeedHash, s.fair.serverSeedHash);

    const detail = await app.api.get(`/api/round/${spin.data.roundId}`, { token: s.sessionToken });
    assert.equal(detail.status, 200);

    if (spin.data.state === "free") {
      // Пока раунд идёт, семя не раскрывается: из него считаются
      // и все оставшиеся фриспины.
      assert.equal(detail.data.fair.revealed, false);
      assert.equal(detail.data.fair.serverSeed, null);
      let state = "free";
      while (state !== "complete") {
        const fs = await app.api.post("/api/freespin", { token: s.sessionToken, body: { requestId: rid() } });
        state = fs.data.state;
      }
    }

    const closed = await app.api.get(`/api/round/${spin.data.roundId}`, { token: s.sessionToken });
    assert.equal(closed.data.fair.revealed, true);
    assert.equal(fair.hashSeed(closed.data.fair.serverSeed), closed.data.fair.serverSeedHash);
  } finally {
    await app.close();
  }
});

test("раскрытый раунд пересчитывается посторонним кодом до символа", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const player = app.db.q.playerByExternal.get(s.player.id);
    plantSeed(app.db, player.id, withBonus);

    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    let state = spin.data.state;
    while (state !== "complete") {
      const fs = await app.api.post("/api/freespin", { token: s.sessionToken, body: { requestId: rid() } });
      state = fs.data.state;
    }

    const verify = await app.api.get(`/api/fair/round/${spin.data.roundId}`, { token: s.sessionToken });
    assert.equal(verify.status, 200);
    assert.equal(verify.data.check.valid, true);
    assert.equal(verify.data.check.complete, true);

    // Тот же расчёт, но без сервера: только раскрытые семена и открытая формула.
    const detail = await app.api.get(`/api/round/${spin.data.roundId}`, { token: s.sessionToken });
    const replay = fair.replayRound({
      serverSeed: verify.data.serverSeed,
      clientSeed: verify.data.clientSeed,
      nonce: verify.data.nonce,
      bet: detail.data.bet
    });
    assert.equal(replay.round.spins.length, detail.data.spins.length);
    for (let i = 0; i < detail.data.spins.length; i++) {
      assert.deepEqual(replay.round.spins[i].screen, detail.data.spins[i].screen, `спин ${i}`);
    }
    assert.equal(replay.round.totalWin, detail.data.win);
  } finally {
    await app.close();
  }
});

test("подменённое семя не сходится с опубликованным хешем", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const player = app.db.q.playerByExternal.get(s.player.id);
    const { seed } = plantSeed(app.db, player.id, noBonus);

    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    const stored = app.db.getRound(spin.data.roundId);

    const check = fair.verifyRound({
      stored: { serverSeedHash: seed.server_seed_hash, bet: stored.data.bet, spins: stored.data.spins },
      serverSeed: fair.newServerSeed(),
      clientSeed: seed.client_seed,
      nonce: seed.nonce
    });
    assert.equal(check.valid, false);
    assert.equal(check.reason, "SEED_HASH_MISMATCH");
  } finally {
    await app.close();
  }
});

test("клиентское семя задаёт игрок, мусор не принимается", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const set = await app.api.post("/api/fair/commit", {
      token: s.sessionToken, body: { clientSeed: "my-lucky-seed_1" }
    });
    assert.equal(set.status, 200);
    assert.equal(set.data.fair.clientSeed, "my-lucky-seed_1");
    assert.notEqual(set.data.fair.serverSeedHash, s.fair.serverSeedHash);

    const bad = await app.api.post("/api/fair/commit", {
      token: s.sessionToken, body: { clientSeed: "плохое:семя" }
    });
    assert.equal(bad.status, 400);

    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    assert.equal(spin.data.fair.clientSeed, "my-lucky-seed_1");
  } finally {
    await app.close();
  }
});

test("незакрытый раунд не раскрывает семя", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const player = app.db.q.playerByExternal.get(s.player.id);
    plantSeed(app.db, player.id, withBonus);
    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });

    const early = await app.api.get(`/api/fair/round/${spin.data.roundId}`, { token: s.sessionToken });
    assert.equal(early.status, 409);
    assert.equal(early.data.error, "ROUND_IN_PROGRESS");

    const change = await app.api.post("/api/fair/commit", {
      token: s.sessionToken, body: { clientSeed: "поменяю-на-ходу" }
    });
    assert.equal(change.status, 400, "семя с недопустимыми символами");

    const legit = await app.api.post("/api/fair/commit", {
      token: s.sessionToken, body: { clientSeed: "newseed" }
    });
    assert.equal(legit.status, 409, "семя меняется только между раундами");
  } finally {
    await app.close();
  }
});

test("чужой раунд не проверяется и не отдаётся", async () => {
  const app = await startApp();
  try {
    const mine = await app.session();
    const player = app.db.q.playerByExternal.get(mine.player.id);
    plantSeed(app.db, player.id, noBonus);
    const spin = await app.api.post("/api/spin", { token: mine.sessionToken, body: { bet: 1, requestId: rid() } });

    const stranger = await app.session();
    const stolen = await app.api.get(`/api/fair/round/${spin.data.roundId}`, { token: stranger.sessionToken });
    assert.equal(stolen.status, 404);
    const detail = await app.api.get(`/api/round/${spin.data.roundId}`, { token: stranger.sessionToken });
    assert.equal(detail.status, 404);
  } finally {
    await app.close();
  }
});

/* ─────────────────── 11. сверка после падения ─────────────────── */

test("сверка возвращает ставку по раунду, зависшему в pending", async () => {
  const app = await startApp();
  try {
    const s = await app.session();
    const player = app.db.q.playerByExternal.get(s.player.id);
    plantSeed(app.db, player.id, noBonus);

    const spin = await app.api.post("/api/spin", { token: s.sessionToken, body: { bet: 1, requestId: rid() } });
    const before = app.db.getPlayer(player.id).balance_minor;

    // Имитируем падение процесса между списанием и результатом.
    app.db.db.prepare(`UPDATE rounds SET state = 'pending', created_at = ? WHERE id = ?`)
      .run(Date.now() - 120000, spin.data.roundId);

    const fixed = await app.reconcile(30000);
    assert.equal(fixed, 1);
    assert.equal(app.db.getPlayer(player.id).balance_minor, before + 100, "ставка не вернулась");
    assert.equal(app.db.getRound(spin.data.roundId).state, "complete");
  } finally {
    await app.close();
  }
});
