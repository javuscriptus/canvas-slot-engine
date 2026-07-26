// Точка входа игрового сервера (RGS).
//
//   node server/src/index.js
//
// Отвечает за: сессии, ставки, спины, фриспины, восстановление раунда,
// историю и отдачу клиента. Вся математика — на сервере; клиент получает
// только результат.

"use strict";

const crypto = require("node:crypto");

const { config, validate } = require("./config");
const { Router, createServer, HttpError } = require("./http");
const { Database } = require("./db");
const { createWallet, WalletError } = require("./wallet");
const { SecureRandom } = require("./rng");
const { WebSocketHub } = require("./ws");
const money = require("./money");
const C = require("./math/gameConfig");
const round = require("./game/round");

const PER_CURRENCY_LIMITS = money.parseLimits(config.limits.perCurrency);

/* ─────────────────────────── инициализация ──────────────────────── */

const problems = validate();
if (problems.length) {
  console.warn("⚠ Проблемы конфигурации:");
  for (const p of problems) console.warn("  •", p);
  if (config.isProd) {
    console.error("Запуск в production с такой конфигурацией запрещён.");
    process.exit(1);
  }
}

const db = new Database(config.db.file);
const wallet = createWallet(config, db);
const rng = new SecureRandom();
const router = new Router();

/**
 * Канал server → client.
 *
 * Через него не проходит ни одна денежная операция: ставка и результат
 * спина остаются на HTTP, где есть идемпотентность и понятное поведение
 * при обрыве. Сокет доставляет только то, что инициирует сервер и что
 * опросом получить нельзя без задержек.
 */
const hub = config.ws.enabled
  ? new WebSocketHub({
      path: config.ws.path,
      heartbeatMs: config.ws.heartbeatMs,
      // Апгрейд авторизуется одноразовым тикетом, выданным по HTTP.
      // Токен сессии сюда не попадает вообще: см. POST /api/ws-ticket.
      authenticate: (ticket) => db.consumeWsTicket(ticket)
    })
  : null;

/* ────────────────────────── вспомогательное ─────────────────────── */

// Все суммы внутри — минорные единицы валюты ИГРОКА. Пересчёт всегда идёт
// через его валюту: в иене нет копеек, и деление на 100 там даёт цифру
// в сто раз меньше настоящей.
const toMinor = (coins, currency) => money.toMinor(coins, currency);
const toMajor = (minor, currency) => money.toMajor(minor, currency);

/** Лимиты ставки: сначала заданные для валюты, иначе общие. */
function betLimits(currency) {
  return PER_CURRENCY_LIMITS[String(currency).toUpperCase()] || {
    minBetMinor: config.limits.minBetMinor,
    maxBetMinor: config.limits.maxBetMinor
  };
}

function requireSession(ctx) {
  const token = ctx.auth || ctx.body?.sessionToken;
  if (!token) throw new HttpError(401, "NO_SESSION", "Сессия не передана");
  const session = db.getSession(token);
  if (!session) throw new HttpError(401, "SESSION_EXPIRED", "Сессия истекла");
  const player = db.getPlayer(session.player_id);
  if (!player) throw new HttpError(401, "NO_PLAYER", "Игрок не найден");
  return { session, player, token };
}

/**
 * Простое окно ограничения частоты — в памяти процесса.
 * Для одного инстанса достаточно; при горизонтальном масштабировании
 * переносится в Redis без изменения вызывающего кода.
 */
const rateBuckets = new Map();
function rateLimit(key, perMinute) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now - b.start > 60000) {
    b = { start: now, count: 0 };
    rateBuckets.set(key, b);
  }
  b.count++;
  if (b.count > perMinute) {
    throw new HttpError(429, "RATE_LIMITED", "Слишком часто. Подождите немного");
  }
}

/** Ответ с идемпотентностью: повтор запроса возвращает сохранённый результат. */
async function idempotent(ctx, player, key, producer) {
  if (!key) return producer();
  const scoped = `${player.id}:${key}`;
  const cached = db.getIdempotent(scoped);
  if (cached) return { ...cached, replayed: true };
  const result = await producer();
  db.putIdempotent(scoped, player.id, result);
  return result;
}

function publicRound(r, balanceMinor, { all = false } = {}) {
  return {
    roundId: r.roundId,
    ...round.serialize(r.round, { includeAllSpins: all }),
    balance: toMajor(balanceMinor, r.currency),
    currency: r.currency
  };
}

/* ──────────────────────────── маршруты ──────────────────────────── */

router.get("/healthz", () => ({
  status: "ok",
  game: config.gameId,
  version: config.gameVersion,
  wallet: wallet.kind,
  uptime: Math.round(process.uptime()),
  sockets: hub ? hub.count : 0
}));

/**
 * Уведомление от платформы оператора: баланс изменился вне игры,
 * сессию нужно закрыть, включён режим обслуживания и т.п.
 * Подписано тем же секретом, что и запросы к кошельку.
 */
router.post("/api/notify", async (ctx) => {
  const signature = ctx.req.headers["x-signature"];
  const raw = JSON.stringify(ctx.body);
  const expected = crypto.createHmac("sha256", config.wallet.secret || "").update(raw).digest("hex");
  if (!config.wallet.secret || signature !== expected) {
    throw new HttpError(401, "BAD_SIGNATURE", "Подпись уведомления не совпадает");
  }

  const { playerId, event, payload } = ctx.body;
  const player = db.q.playerByExternal.get(playerId);
  if (!player) throw new HttpError(404, "NO_PLAYER", "Игрок не найден");

  if (event === "balance") {
    pushBalance(player, payload?.balance);
  } else if (event === "session.close") {
    hub?.toPlayer(player.id, "session.closed", { reason: payload?.reason || "operator" });
    hub?.closePlayer(player.id);
  } else {
    hub?.toPlayer(player.id, event, payload || {});
  }
  return { delivered: true };
});

router.get("/api/config", () => ({
  game: { id: config.gameId, version: config.gameVersion, title: "Сочи · Sochi Sunset" },
  ...C.publicConfig()
}));

/**
 * Открытие сессии.
 *
 * В бою сюда приходит launch-токен, подписанный оператором: игрок
 * аутентифицирован на его стороне, мы лишь проверяем подпись.
 * В демо-режиме создаётся временный игрок с игровым балансом.
 */
router.post("/api/session", async (ctx) => {
  const { launchToken, demo } = ctx.body;

  let player;
  if (launchToken) {
    const payload = verifyLaunchToken(launchToken);
    player = db.ensurePlayer(payload.playerId, { currency: payload.currency || "RUB" });
  } else {
    if (!config.demo.enabled) {
      throw new HttpError(403, "DEMO_DISABLED", "Демо-режим отключён");
    }
    const demoId = `demo:${crypto.randomBytes(9).toString("base64url")}`;
    player = db.ensurePlayer(demoId, {
      currency: config.demo.currency,
      startBalanceMinor: config.demo.startBalanceMinor
    });
  }

  const token = db.createSession(player.id, config.session.ttlMs, {
    ip: ctx.ip, userAgent: ctx.userAgent
  });

  const balanceMinor = await wallet.getBalance(player);

  // Незакрытый раунд — обрыв связи посреди фриспинов. Игрок обязан
  // получить возможность его доиграть.
  const open = db.getOpenRound(player.id);

  return {
    sessionToken: token,
    player: {
      id: player.external_id,
      currency: player.currency,
      demo: player.external_id.startsWith("demo:")
    },
    balance: toMajor(balanceMinor, player.currency),
    currency: money.publicCurrency(player.currency, betLimits(player.currency), C.BET_LEVELS),
    resume: open
      ? {
          roundId: open.id,
          ...round.serialize(open.data, { includeAllSpins: true })
        }
      : null
  };
});

/**
 * Тикет на апгрейд WebSocket.
 *
 * Браузерный WebSocket не умеет отправлять заголовки, поэтому единственное
 * место для секрета в апгрейде — query-строка. А она пишется в access-логи
 * nginx, балансировщика и APM. Класть туда токен сессии, живущий часами, —
 * значит раздать его всем, у кого есть доступ к логам.
 *
 * Тикет решает это: живёт 15 секунд, гасится первым же использованием и
 * не даёт доступа ни к одному HTTP-эндпоинту. Утёкший из логов тикет
 * бесполезен — он уже погашен тем соединением, ради которого выдавался.
 */
router.post("/api/ws-ticket", (ctx) => {
  const { player, token } = requireSession(ctx);
  if (!hub) throw new HttpError(404, "WS_DISABLED", "Канал уведомлений отключён");
  rateLimit(`ws-ticket:${player.id}`, config.limits.wsTicketsPerMinute);
  const { ticket, ttlMs } = db.createWsTicket(player.id, token, config.ws.ticketTtlMs);
  return { ticket, ttlMs, path: config.ws.path };
});

router.get("/api/state", async (ctx) => {
  const { player } = requireSession(ctx);
  const balanceMinor = await wallet.getBalance(player);
  const open = db.getOpenRound(player.id);
  return {
    balance: toMajor(balanceMinor, player.currency),
    currency: player.currency,
    resume: open ? { roundId: open.id, ...round.serialize(open.data, { includeAllSpins: true }) } : null
  };
});

/** Базовый спин: списывает ставку и открывает раунд. */
router.post("/api/spin", async (ctx) => {
  const { player } = requireSession(ctx);
  rateLimit(`spin:${player.id}`, config.limits.spinsPerMinute);

  const betCoins = Number(ctx.body.bet);
  if (!C.BET_LEVELS.includes(betCoins)) {
    throw new HttpError(400, "BAD_BET", "Недопустимый уровень ставки");
  }
  const betMinor = toMinor(betCoins, player.currency);
  if (betMinor < config.limits.minBetMinor || betMinor > config.limits.maxBetMinor) {
    throw new HttpError(400, "BET_OUT_OF_RANGE", "Ставка вне допустимого диапазона");
  }

  const blocking = db.getBlockingRound(player.id);
  if (blocking) {
    throw new HttpError(409, "ROUND_IN_PROGRESS",
      blocking.state === "free"
        ? "Предыдущий раунд не завершён — доиграйте фриспины"
        : "Предыдущий раунд ещё обрабатывается, повторите через секунду");
  }

  return idempotent(ctx, player, ctx.body.requestId, async () => {
    const roundId = crypto.randomUUID();
    const drawsBefore = rng.drawn;

    // 1. Сначала заводим раунд в состоянии pending. Порядок важен:
    //    транзакции ссылаются на раунд внешним ключом, а списание ставки
    //    обязано быть привязано к конкретному раунду ещё до того, как
    //    станет известен результат.
    db.createRound({
      id: roundId,
      playerId: player.id,
      betMinor,
      currency: player.currency,
      state: "pending",
      totalWinMinor: 0,
      data: { bet: betCoins, state: "pending", spins: [] },
      rngDraws: 0
    });

    // 2. Списываем ставку. Отказ кошелька — раунд помечается брошенным.
    let betRes;
    try {
      betRes = await wallet.bet({
        player, roundId, amountMinor: betMinor, currency: player.currency
      });
    } catch (err) {
      db.saveRound(roundId, {
        state: "complete", totalWinMinor: 0,
        data: { bet: betCoins, state: "aborted", reason: err.code || "WALLET_ERROR", spins: [] },
        rngDraws: 0
      });
      if (err instanceof WalletError) {
        throw new HttpError(err.code === "INSUFFICIENT_FUNDS" ? 402 : 502, err.code, err.message);
      }
      throw err;
    }

    // 3. Крутим.
    const r = round.startRound(rng, betCoins);
    const winMinor = toMinor(r.totalWin, player.currency);

    db.saveRound(roundId, {
      state: r.state,
      totalWinMinor: winMinor,
      data: r,
      rngDraws: rng.drawn - drawsBefore
    });

    // 3. Если бонуса нет — закрываем раунд и зачисляем выигрыш.
    let balanceMinor = betRes.balanceMinor;
    if (r.state === round.STATE.COMPLETE) {
      const winRes = await creditWin(player, roundId, winMinor);
      balanceMinor = winRes.balanceMinor;
      db.saveRound(roundId, {
        state: r.state, totalWinMinor: winMinor, data: r, rngDraws: rng.drawn - drawsBefore
      });
    }

    pushBalance(player, balanceMinor);
    return publicRound({ roundId, round: r, currency: player.currency }, balanceMinor, { all: true });
  });
});

/** Один фриспин внутри открытого раунда. Ставка не списывается. */
router.post("/api/freespin", async (ctx) => {
  const { player } = requireSession(ctx);
  rateLimit(`spin:${player.id}`, config.limits.spinsPerMinute);

  const stored = db.getOpenRound(player.id);
  if (!stored) throw new HttpError(409, "NO_ACTIVE_ROUND", "Нет активного бонусного раунда");
  if (ctx.body.roundId && ctx.body.roundId !== stored.id) {
    throw new HttpError(409, "ROUND_MISMATCH", "Указан другой раунд");
  }

  return idempotent(ctx, player, ctx.body.requestId, async () => {
    const r = stored.data;
    const drawsBefore = rng.drawn;

    round.playFreeSpin(rng, r);

    const winMinor = toMinor(r.totalWin, player.currency);
    let balanceMinor = await wallet.getBalance(player);

    if (r.state === round.STATE.COMPLETE) {
      const winRes = await creditWin(player, stored.id, winMinor);
      balanceMinor = winRes.balanceMinor;
    }

    db.saveRound(stored.id, {
      state: r.state,
      totalWinMinor: winMinor,
      data: r,
      rngDraws: stored.rng_draws + (rng.drawn - drawsBefore)
    });

    pushBalance(player, balanceMinor);
    return publicRound({ roundId: stored.id, round: r, currency: player.currency }, balanceMinor);
  });
});

router.get("/api/history", (ctx) => {
  const { player } = requireSession(ctx);
  const limit = Math.min(parseInt(ctx.query.get("limit") || "20", 10), 100);
  return {
    rounds: db.getHistory(player.id, limit).map((r) => ({
      id: r.id,
      bet: toMajor(r.bet_minor, r.currency),
      win: toMajor(r.total_win_minor, r.currency),
      currency: r.currency,
      state: r.state,
      at: r.created_at
    }))
  };
});

/**
 * Полная запись одного раунда.
 *
 * Это не украшение экрана истории, а требование почти любого регулятора:
 * по номеру раунда обязано воспроизводиться всё — ставка, экран каждого
 * спина, каждая сработавшая линия и её вклад, число обращений к ГПСЧ.
 * Поддержка оператора разбирает спорные обращения ровно этим эндпоинтом.
 *
 * Чужой раунд не отдаётся: проверка по player_id, а не только по id.
 */
router.get(/^\/api\/round\/(?<id>[A-Za-z0-9-]{1,64})$/, (ctx) => {
  const { player } = requireSession(ctx);
  const stored = db.getRound(ctx.params.id);
  if (!stored || stored.player_id !== player.id) {
    throw new HttpError(404, "NO_ROUND", "Раунд не найден");
  }

  const data = stored.data || {};
  const spins = Array.isArray(data.spins) ? data.spins : [];

  return {
    id: stored.id,
    at: stored.created_at,
    closedAt: stored.closed_at,
    state: stored.state,
    bet: toMajor(stored.bet_minor, stored.currency),
    win: toMajor(stored.total_win_minor, stored.currency),
    currency: stored.currency,
    capped: !!data.capped,
    reason: data.reason || null,
    // Аудит: сколько случайных чисел израсходовано. Расхождение с числом
    // спинов — первый признак того, что раунд пересчитывали.
    rngDraws: stored.rng_draws,
    freeSpins: {
      total: data.freeSpinsTotal || 0,
      played: data.freeSpinsPlayed || 0,
      win: data.freeWin || 0
    },
    spins: spins.map((s, i) => ({
      index: s.index ?? i,
      type: s.type,
      stops: s.stops,
      screen: s.screen,
      win: s.win,
      scatterCount: s.scatterCount ?? 0,
      retrigger: s.retrigger || 0,
      wins: (s.wins || []).map((w) => ({
        type: w.type,
        line: w.line ?? null,
        symbol: w.symbol,
        symbolKey: C.SYMBOL_KEYS[w.symbol],
        count: w.count,
        payout: w.payout,
        multiplier: w.multiplier ?? 1,
        amount: w.amount,
        positions: w.positions
      }))
    }))
  };
});

/* ────────────────────────── служебное ───────────────────────────── */

/** Сообщает всем открытым вкладкам игрока актуальный баланс. */
function pushBalance(player, balanceMinor) {
  if (!hub) return;
  const value = balanceMinor ?? db.getPlayer(player.id)?.balance_minor ?? 0;
  hub.toPlayer(player.id, "balance", {
    balance: toMajor(value, player.currency), currency: player.currency
  });
}

async function creditWin(player, roundId, winMinor) {
  try {
    return await wallet.win({
      player, roundId, amountMinor: winMinor, currency: player.currency
    });
  } catch (err) {
    // Выигрыш не зачислился — это авария, а не штатная ситуация.
    // Раунд остаётся в БД, деньги дозачисляются сверкой; игроку сообщаем честно.
    console.error(`[wallet] не удалось зачислить выигрыш по раунду ${roundId}:`, err.message);
    throw new HttpError(502, "WALLET_WIN_FAILED",
      "Выигрыш зафиксирован, но зачисление задерживается. Обратитесь в поддержку, раунд: " + roundId);
  }
}

/**
 * Проверка launch-токена оператора.
 * Формат: base64url(payload).base64url(hmacSHA256(payload, LAUNCH_SECRET))
 */
function verifyLaunchToken(token) {
  if (!config.session.launchSecret) {
    throw new HttpError(500, "NO_LAUNCH_SECRET", "LAUNCH_SECRET не настроен");
  }
  const [payloadPart, sigPart] = String(token).split(".");
  if (!payloadPart || !sigPart) {
    throw new HttpError(400, "BAD_TOKEN", "Некорректный launch-токен");
  }

  const expected = crypto
    .createHmac("sha256", config.session.launchSecret)
    .update(payloadPart)
    .digest();
  const got = Buffer.from(sigPart, "base64url");

  // Сравнение с постоянным временем: обычное === утекает информацию
  // о подписи через тайминг.
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    throw new HttpError(401, "BAD_SIGNATURE", "Подпись токена не совпадает");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "BAD_TOKEN", "Не удалось разобрать токен");
  }

  if (!payload.playerId) throw new HttpError(400, "BAD_TOKEN", "В токене нет playerId");
  if (payload.exp && payload.exp < Date.now()) {
    throw new HttpError(401, "TOKEN_EXPIRED", "Launch-токен истёк");
  }
  return payload;
}

/* ──────────────────────────── запуск ────────────────────────────── */

const server = createServer({
  router,
  config,
  onError: (err, req) => console.error(`[500] ${req.method} ${req.url}`, err)
});

if (hub) {
  server.on("upgrade", (req, socket, head) => hub.handleUpgrade(req, socket, head));
}

server.listen(config.http.port, config.http.host, () => {
  console.log(`Sochi Sunset RGS`);
  console.log(`  режим:    ${config.env}`);
  console.log(`  кошелёк:  ${wallet.kind}`);
  console.log(`  адрес:    http://${config.http.host}:${config.http.port}`);
  console.log(`  сокет:    ${hub ? config.ws.path : "выключен"}`);
  console.log(`  iframe:   ${config.http.frameAncestors.join(" ") || "запрещён"}`);
  if (config.demo.enabled) {
    console.log(`  демо:     включено, стартовый баланс ${toMajor(config.demo.startBalanceMinor, config.demo.currency)} ${config.demo.currency}`);
  }
});

/**
 * Сверка после нештатного перезапуска.
 *
 * Раунд в состоянии pending означает, что процесс умер между списанием
 * ставки и результатом спина. Если ставка успела списаться — возвращаем её
 * игроку; если нет — просто закрываем запись. Без этого игрок остаётся
 * и без денег, и с заблокированным следующим спином.
 */
async function reconcilePendingRounds() {
  const stale = db.getStalePendingRounds(30000);
  if (!stale.length) return;
  console.warn(`[сверка] незакрытых раундов: ${stale.length}`);

  for (const r of stale) {
    const player = db.getPlayer(r.player_id);
    const betTx = db.q.txByRoundType.get(r.id, "bet");
    try {
      if (betTx) {
        await wallet.rollback({ player, roundId: r.id });
        console.warn(`[сверка] раунд ${r.id}: ставка возвращена`);
      }
      db.saveRound(r.id, {
        state: "complete",
        totalWinMinor: 0,
        data: { ...r.data, state: "aborted", reason: "RECONCILED" },
        rngDraws: r.rng_draws
      });
    } catch (err) {
      console.error(`[сверка] раунд ${r.id}: не удалось откатить —`, err.message);
    }
  }
}

reconcilePendingRounds().catch((e) => console.error("[сверка] сбой:", e));

const cleanupTimer = setInterval(() => {
  db.cleanup();
  reconcilePendingRounds().catch((e) => console.error("[сверка] сбой:", e));
}, 3600e3);
cleanupTimer.unref();

function shutdown(signal) {
  console.log(`\n${signal}: завершаю работу…`);
  hub?.destroy();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Если соединения висят — не ждём вечно.
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = { server, db, router };
