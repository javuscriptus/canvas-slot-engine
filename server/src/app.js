// Маршруты игрового сервера (RGS): сессии, ставки, спины, фриспины,
// история, разбор раунда и доказуемая честность.
//
// Здесь нет ни запуска процесса, ни чтения окружения: всё приходит
// параметрами. Так сервер поднимается в тесте на памяти, с подставным
// кошельком и без единой переменной окружения — а деньги проверяются
// на настоящих маршрутах, а не на их пересказе.
//
// Три правила, из которых выведено почти всё остальное в этом файле.
//
//   1. Ключ идемпотентности пишется ДО денежной операции и в одной
//      транзакции с созданием раунда. Повтор запроса продолжает тот же
//      раунд, а не начинает новый.
//   2. Всё, что меняет состояние раунда, делается одной синхронной
//      транзакцией. Между чтением и записью не должно быть await:
//      именно туда пролезали параллельные запросы.
//   3. Ни одно число от клиента не участвует в расчёте, пока не проверено
//      по типу, границам и длине.

"use strict";

const crypto = require("node:crypto");

const { Router, createServer, HttpError } = require("./http");
const { WalletError } = require("./wallet");
const { RateLimiter } = require("./ratelimit");
const { SecureRandom } = require("./rng");
const money = require("./money");
const fair = require("./fair");
const C = require("./math/gameConfig");
const analytic = require("./math/analytic");
const round = require("./game/round");

/**
 * Теоретический возврат игроку в процентах.
 *
 * Считается точным перебором (analytic.js, ~80 мс) и запоминается: состав
 * лент за время работы процесса не меняется, а раздавать клиенту вписанное
 * руками число нельзя — оно разойдётся с математикой при первой же правке.
 */
let rtpCache = null;
function theoreticalRtp() {
  if (rtpCache === null) {
    rtpCache = Math.round(analytic.computeRTP().total * 100 * 1000) / 1000;
  }
  return rtpCache;
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const ROUND_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const EXTERNAL_ID_RE = /^[\x20-\x7E]{1,128}$/;

/* ────────────────────────── проверка входа ──────────────────────── */

function badRequest(message) {
  return new HttpError(400, "BAD_REQUEST", message);
}

function readString(value, field, { max = 128, pattern = null, optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw badRequest(`Поле ${field} обязательно`);
  }
  if (typeof value !== "string") throw badRequest(`Поле ${field} должно быть строкой`);
  if (value.length > max) throw badRequest(`Поле ${field} длиннее ${max} символов`);
  if (pattern && !pattern.test(value)) throw badRequest(`Поле ${field} содержит недопустимые символы`);
  return value;
}

/**
 * Целое из query-строки.
 *
 * Отдельная функция, а не parseInt по месту: parseInt("abc") даёт NaN,
 * который дальше уходит в SQL как есть, а LIMIT -1 в SQLite означает
 * «без ограничения» — то есть выгрузку всей истории игрока одним запросом.
 */
function readInt(raw, { field = "limit", min, max, fallback }) {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (!/^-?\d{1,9}$/.test(String(raw))) {
    throw badRequest(`Параметр ${field} должен быть целым числом`);
  }
  const n = parseInt(String(raw), 10);
  if (n < min || n > max) {
    throw badRequest(`Параметр ${field} должен быть в диапазоне ${min}…${max}`);
  }
  return n;
}

/* ─────────────────────── очередь операций игрока ────────────────── */

/**
 * Последовательное выполнение денежных операций одного игрока.
 *
 * Транзакция БД закрывает гонку между процессами, но внутри процесса
 * между «прочитал состояние» и «записал результат» всегда есть await
 * к кошельку. Очередь убирает саму возможность чередования: второй спин
 * того же игрока начинается после того, как закончился первый.
 * Для разных игроков очереди независимы, поэтому пропускную способность
 * это не ограничивает.
 */
function createLockTable() {
  const locks = new Map();
  return function withLock(id, fn) {
    const prev = locks.get(id) || Promise.resolve();
    // Ошибка предыдущей операции не должна ронять очередь следующей.
    const run = prev.then(fn, fn);
    const tail = run.then(() => {}, () => {});
    locks.set(id, tail);
    tail.then(() => {
      if (locks.get(id) === tail) locks.delete(id);
    });
    return run;
  };
}

/* ──────────────────────────── приложение ────────────────────────── */

function createApp({ config, db, wallet, hub = null, limiter = new RateLimiter() }) {
  const perCurrencyLimits = money.parseLimits(config.limits.perCurrency);
  const router = new Router();
  const withPlayerLock = createLockTable();

  // Все суммы внутри — минорные единицы валюты ИГРОКА. Пересчёт всегда идёт
  // через его валюту: в иене нет копеек, и деление на 100 там даёт цифру
  // в сто раз меньше настоящей.
  const toMinor = (coins, currency) => money.toMinor(coins, currency);
  const toMajor = (minor, currency) => money.toMajor(minor, currency);

  /** Лимиты ставки: сначала заданные для валюты, иначе общие. */
  function betLimits(currency) {
    return perCurrencyLimits[String(currency).toUpperCase()] || {
      minBetMinor: config.limits.minBetMinor,
      maxBetMinor: config.limits.maxBetMinor
    };
  }

  function rateLimit(key, perMinute) {
    const hit = limiter.hit(key, perMinute);
    if (!hit.allowed) {
      throw new HttpError(429, "RATE_LIMITED", "Слишком часто. Подождите немного");
    }
  }

  function requireSession(ctx) {
    const token = ctx.auth || ctx.body?.sessionToken;
    if (!token || typeof token !== "string" || token.length > 256) {
      throw new HttpError(401, "NO_SESSION", "Сессия не передана");
    }
    const session = db.getSession(token);
    // Отозванная сессия неотличима от истёкшей намеренно: игроку,
    // которого выставил оператор, незачем знать, чем именно закрыт доступ.
    if (!session) throw new HttpError(401, "SESSION_EXPIRED", "Сессия истекла");
    const player = db.getPlayer(session.player_id);
    if (!player) throw new HttpError(401, "NO_PLAYER", "Игрок не найден");
    // Лимит по игроку не зависит от токена, поэтому пересоздание сессии
    // его не сбрасывает. Для игрока оператора это основная ось: он приходит
    // с одним и тем же external_id с любого адреса.
    rateLimit(`player:${player.id}`, config.limits.apiPerMinutePerPlayer);
    return { session, player, token };
  }

  /* ───────────────────────── провабли-фейр ──────────────────────── */

  /**
   * Обязательство на следующий раунд: хеш серверного семени выдаётся
   * ДО спина. Если открытого обязательства нет, оно создаётся здесь же —
   * игрок не обязан помнить о существовании схемы, чтобы она работала.
   */
  function ensureFairSeed(player, clientSeed = null) {
    const open = db.getOpenFairSeed(player.id);
    if (open && !clientSeed) return open;
    const serverSeed = fair.newServerSeed();
    return db.createFairSeed({
      playerId: player.id,
      serverSeed,
      serverSeedHash: fair.hashSeed(serverSeed),
      clientSeed: clientSeed || fair.newClientSeed()
    });
  }

  /** Публичная часть обязательства: семя остаётся у сервера до раскрытия. */
  function publicFair(seed) {
    return {
      seedId: seed.id,
      serverSeedHash: seed.server_seed_hash,
      clientSeed: seed.client_seed,
      nonce: seed.nonce
    };
  }

  /**
   * Источник случайности раунда.
   *
   * Раунды, начатые до включения commit-reveal, обязательства не имеют
   * и проверке не подлежат — доиграть их надо, поэтому у них остаётся
   * прежний ГПСЧ. Экземпляр создаётся на раунд: общий счётчик обращений
   * под параллельной нагрузкой считал чужие спины и делал поле rngDraws
   * бессмысленным.
   */
  function roundRandom(data) {
    if (!data.fair?.seedId) return new SecureRandom();
    const seed = db.getFairSeed(data.fair.seedId);
    if (!seed) return new SecureRandom();
    return new fair.FairRandom({
      serverSeed: seed.server_seed,
      clientSeed: seed.client_seed,
      nonce: seed.nonce,
      cursor: data.fair.cursor || 0
    });
  }

  /* ────────────────────────── общее по деньгам ──────────────────── */

  function publicRound(r, roundId, balanceMinor, currency, { all = false } = {}) {
    return {
      roundId,
      ...round.serialize(r, { includeAllSpins: all }),
      balance: toMajor(balanceMinor, currency),
      currency,
      fair: r.fair
        ? { seedId: r.fair.seedId, serverSeedHash: r.fair.serverSeedHash, clientSeed: r.fair.clientSeed, nonce: r.fair.nonce }
        : null
    };
  }

  /** Сообщает всем открытым вкладкам игрока актуальный баланс. */
  function pushBalance(player, balanceMinor) {
    if (!hub) return;
    const value = balanceMinor ?? db.getPlayer(player.id)?.balance_minor ?? 0;
    hub.toPlayer(player.id, "balance", {
      balance: toMajor(value, player.currency), currency: player.currency
    });
  }

  function walletError(err, roundId) {
    if (err instanceof WalletError) {
      return new HttpError(
        err.code === "INSUFFICIENT_FUNDS" ? 402 : 502,
        err.code,
        err.code === "INSUFFICIENT_FUNDS" ? err.message : `${err.message} (раунд ${roundId})`
      );
    }
    return err;
  }

  /**
   * Ответ, сохранённый под ключом идемпотентности.
   * Отказ — тоже ответ: повтор обязан вернуть ту же ошибку, а не начать
   * новый раунд и не списать ставку второй раз.
   */
  function replayStored(stored) {
    if (stored.__error) {
      throw new HttpError(stored.__error.status, stored.__error.code, stored.__error.message);
    }
    return { ...stored, replayed: true };
  }

  async function creditWin(player, roundId, winMinor) {
    try {
      return await wallet.win({
        player, roundId, amountMinor: winMinor, currency: player.currency
      });
    } catch (err) {
      // Выигрыш не зачислился — это авария, а не штатная ситуация.
      // Ключ идемпотентности при этом остаётся незакрытым: повтор запроса
      // войдёт в тот же раунд и попробует зачислить ещё раз, но ставку
      // второй раз не спишет.
      console.error(`[wallet] не удалось зачислить выигрыш по раунду ${roundId}:`, err.message);
      throw new HttpError(502, "WALLET_WIN_FAILED",
        "Выигрыш зафиксирован, но зачисление задерживается. Обратитесь в поддержку, раунд: " + roundId);
    }
  }

  /* ──────────────────────────── маршруты ────────────────────────── */

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
    // Сравнение с постоянным временем: обычное === отвечает тем быстрее,
    // чем раньше расходятся строки, и подпись подбирается побайтово.
    const got = Buffer.from(String(signature || ""), "utf8");
    const want = Buffer.from(expected, "utf8");
    if (!config.wallet.secret || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      throw new HttpError(401, "BAD_SIGNATURE", "Подпись уведомления не совпадает");
    }

    const playerId = readString(ctx.body.playerId, "playerId", { max: 128, pattern: EXTERNAL_ID_RE });
    const event = readString(ctx.body.event, "event", { max: 64, pattern: /^[a-z][a-z0-9._-]{0,63}$/i });
    const payload = ctx.body.payload && typeof ctx.body.payload === "object" && !Array.isArray(ctx.body.payload)
      ? ctx.body.payload
      : {};

    const player = db.q.playerByExternal.get(playerId);
    if (!player) throw new HttpError(404, "NO_PLAYER", "Игрок не найден");

    if (event === "balance") {
      const balance = payload.balance;
      if (!Number.isInteger(balance) || balance < 0) {
        throw badRequest("Баланс передаётся целым числом минорных единиц");
      }
      pushBalance(player, balance);
    } else if (event === "session.close") {
      // Закрыть сокет мало: HTTP-сессия живёт часами, и игрок,
      // которого оператор выставил из игры (самоисключение, блокировка,
      // подозрение на мошенничество), продолжал бы крутить барабаны.
      const revoked = db.revokeSessions(player.id, payload.reason || "operator");
      hub?.toPlayer(player.id, "session.closed", { reason: String(payload.reason || "operator").slice(0, 120) });
      hub?.closePlayer(player.id);
      return { delivered: true, sessionsRevoked: revoked };
    } else {
      hub?.toPlayer(player.id, event, payload);
    }
    return { delivered: true };
  });

  router.get("/api/config", () => ({
    game: { id: config.gameId, version: config.gameVersion, title: "Сочи · Sochi Sunset" },
    // Список origin для postMessage отдаёт сервер. Взятый из параметра URL,
    // он позволял бы увести launch-токен: ?lobby_origin=https://злой.хост.
    lobby: { origins: config.http.lobbyOrigins },
    // Возврат игроку — из той же модели, по которой играется спин.
    // Раньше клиент показывал круглые «96.0», вписанные в него руками,
    // и это расходилось с сертифицированными 96.008: в правилах игры
    // такое расхождение — вопрос регулятора, а не опечатка.
    rtp: theoreticalRtp(),
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
    // Лимит по адресу: открытие сессии — единственная точка, которая
    // создаёт игрока, и именно ею обнуляли счётчики, привязанные к игроку.
    rateLimit(`session:${ctx.ip}`, config.limits.sessionsPerMinutePerIp);

    const launchToken = readString(ctx.body.launchToken, "launchToken", { max: 4096, optional: true });

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
      // Обязательство выдаётся вместе с сессией: хеш серверного семени
      // обязан быть у игрока ДО первого спина, иначе схема ничего не доказывает.
      fair: publicFair(ensureFairSeed(player)),
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
    rateLimit(`ws-ticket-ip:${ctx.ip}`, config.limits.wsTicketsPerMinute * 4);
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
      fair: publicFair(ensureFairSeed(player)),
      resume: open ? { roundId: open.id, ...round.serialize(open.data, { includeAllSpins: true }) } : null
    };
  });

  /* ───────────────────────────── спин ───────────────────────────── */

  /**
   * Доигрывает раунд до конца: ставка, барабаны, зачисление.
   *
   * Функция обязана быть безопасной для повторного вызова с тем же
   * roundId — на этом держится вся идемпотентность. Ставка и выигрыш
   * идемпотентны по раунду в кошельке, а спин не повторяется, если
   * результат уже сохранён.
   */
  async function settleSpin(player, roundId, key) {
    const stored = db.getRound(roundId);
    const data = stored.data;
    const betCoins = data.bet;

    let betRes;
    try {
      betRes = await wallet.bet({
        player, roundId, amountMinor: stored.bet_minor, currency: player.currency
      });
    } catch (err) {
      // Кошелёк отказал осмысленно (нет средств, отклонил операцию) —
      // это окончательный итог раунда, и повтор обязан получить его же.
      // Неизвестное исключение итогом не считается: раунд остаётся
      // pending, ключ незакрытым, и разбирает это сверка.
      if (!(err instanceof WalletError)) throw err;

      const failure = walletError(err, roundId);
      db.saveRound(roundId, {
        state: "complete",
        totalWinMinor: 0,
        data: { ...data, state: "aborted", reason: err.code || "WALLET_ERROR" },
        rngDraws: stored.rng_draws
      });
      db.finishIdempotency(key, {
        __error: { status: failure.status, code: failure.code, message: failure.message }
      });
      throw failure;
    }

    let r = data;
    if (!Array.isArray(data.spins) || data.spins.length === 0) {
      const rng = roundRandom(data);
      r = round.startRound(rng, betCoins);
      r.fair = { ...data.fair, cursor: rng.cursor };
      db.saveRound(roundId, {
        state: r.state,
        totalWinMinor: toMinor(r.totalWin, player.currency),
        data: r,
        rngDraws: rng.drawn
      });
    }

    let balanceMinor = betRes.balanceMinor;
    if (r.state === round.STATE.COMPLETE) {
      const winRes = await creditWin(player, roundId, toMinor(r.totalWin, player.currency));
      balanceMinor = winRes.balanceMinor;
    }

    const response = publicRound(r, roundId, balanceMinor, player.currency, { all: true });
    response.nextFair = publicFair(ensureFairSeed(player));
    db.finishIdempotency(key, response);
    pushBalance(player, balanceMinor);
    return response;
  }

  /** Базовый спин: списывает ставку и открывает раунд. */
  router.post("/api/spin", async (ctx) => {
    const { player } = requireSession(ctx);
    rateLimit(`spin:${player.id}`, config.limits.spinsPerMinute);
    rateLimit(`spin-ip:${ctx.ip}`, config.limits.spinsPerMinutePerIp);

    const betCoins = ctx.body.bet;
    if (typeof betCoins !== "number" || !Number.isFinite(betCoins) || !C.BET_LEVELS.includes(betCoins)) {
      throw new HttpError(400, "BAD_BET", "Недопустимый уровень ставки");
    }
    const requestId = readString(ctx.body.requestId, "requestId", { max: 128, pattern: REQUEST_ID_RE });

    // Лимиты оператора считаются в валюте игрока и проверяются здесь,
    // а не только показываются клиенту: клиент — это чужой код.
    const betMinor = toMinor(betCoins, player.currency);
    const limits = betLimits(player.currency);
    if (betMinor < limits.minBetMinor || betMinor > limits.maxBetMinor) {
      throw new HttpError(400, "BET_OUT_OF_RANGE", "Ставка вне допустимого диапазона");
    }

    const key = `${player.id}:spin:${requestId}`;
    const cached = db.getIdempotent(key);
    if (cached) return replayStored(cached);

    return withPlayerLock(player.id, async () => {
      const again = db.getIdempotent(key);
      if (again) return replayStored(again);

      const claim = db.transaction(() => {
        const roundId = crypto.randomUUID();
        const taken = db.claimIdempotency(key, player.id, roundId);
        if (!taken.claimed) return { resumeRoundId: taken.row.round_id };

        // Раунд заводится в той же транзакции, что и ключ: иначе повтор
        // запроса нашёл бы ключ без раунда и не знал бы, что доигрывать.
        const blocking = db.getBlockingRound(player.id);
        if (blocking) {
          throw new HttpError(409, "ROUND_IN_PROGRESS",
            blocking.state === "free"
              ? "Предыдущий раунд не завершён — доиграйте фриспины"
              : "Предыдущий раунд ещё обрабатывается, повторите через секунду");
        }

        const seed = ensureFairSeed(player);
        db.createRound({
          id: roundId,
          playerId: player.id,
          betMinor,
          currency: player.currency,
          state: "pending",
          totalWinMinor: 0,
          data: {
            bet: betCoins,
            state: "pending",
            spins: [],
            fair: { ...publicFair(seed), cursor: 0 }
          },
          rngDraws: 0
        });
        db.useFairSeed(seed.id, roundId);
        return { roundId };
      });

      return settleSpin(player, claim.roundId || claim.resumeRoundId, key);
    });
  });

  /** Один фриспин внутри открытого раунда. Ставка не списывается. */
  router.post("/api/freespin", async (ctx) => {
    const { player } = requireSession(ctx);
    rateLimit(`spin:${player.id}`, config.limits.spinsPerMinute);
    rateLimit(`spin-ip:${ctx.ip}`, config.limits.spinsPerMinutePerIp);

    const requestId = readString(ctx.body.requestId, "requestId", { max: 128, pattern: REQUEST_ID_RE });
    const wantRoundId = readString(ctx.body.roundId, "roundId", {
      max: 64, pattern: ROUND_ID_RE, optional: true
    });

    const key = `${player.id}:freespin:${requestId}`;
    const cached = db.getIdempotent(key);
    if (cached) return replayStored(cached);

    return withPlayerLock(player.id, async () => {
      const again = db.getIdempotent(key);
      if (again) return replayStored(again);

      // Всё изменение состояния — одной синхронной транзакцией. Раньше
      // здесь было «прочитали раунд → await к кошельку → записали», и два
      // параллельных запроса выдавали неограниченное число фриспинов:
      // оба видели одно и то же «осталось N».
      const claim = db.transaction(() => {
        const stored = db.getOpenRound(player.id);
        if (!stored) throw new HttpError(409, "NO_ACTIVE_ROUND", "Нет активного бонусного раунда");
        if (wantRoundId && wantRoundId !== stored.id) {
          throw new HttpError(409, "ROUND_MISMATCH", "Указан другой раунд");
        }

        const taken = db.claimIdempotency(key, player.id, stored.id);
        if (!taken.claimed) return { resumeRoundId: taken.row.round_id };

        // Право на спин списывается условным UPDATE: выигрывает ровно
        // один вызов, остальные видят изменений 0 и получают отказ.
        if (!db.claimFreeSpin(stored.id)) {
          throw new HttpError(409, "NO_FREE_SPINS", "Фриспины закончились");
        }

        const r = stored.data;
        const rng = roundRandom(r);
        round.playFreeSpin(rng, r);
        if (r.fair) r.fair.cursor = rng.cursor;

        db.saveRound(stored.id, {
          state: r.state,
          totalWinMinor: toMinor(r.totalWin, player.currency),
          data: r,
          rngDraws: stored.rng_draws + rng.drawn
        });
        return { roundId: stored.id, round: r };
      });

      const roundId = claim.roundId || claim.resumeRoundId;
      const r = claim.round || db.getRound(roundId).data;

      let balanceMinor;
      if (r.state === round.STATE.COMPLETE) {
        const winRes = await creditWin(player, roundId, toMinor(r.totalWin, player.currency));
        balanceMinor = winRes.balanceMinor;
      } else {
        balanceMinor = await wallet.getBalance(player);
      }

      const response = publicRound(r, roundId, balanceMinor, player.currency);
      if (r.state === round.STATE.COMPLETE) {
        response.nextFair = publicFair(ensureFairSeed(player));
      }
      db.finishIdempotency(key, response);
      pushBalance(player, balanceMinor);
      return response;
    });
  });

  /* ──────────────────────── история и разбор ────────────────────── */

  router.get("/api/history", (ctx) => {
    const { player } = requireSession(ctx);
    const limit = readInt(ctx.query.get("limit"), { min: 1, max: 100, fallback: 20 });
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
    const stored = ownRound(player, ctx.params.id);

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
      fair: fairDisclosure(stored),
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

  function ownRound(player, id) {
    const stored = db.getRound(id);
    if (!stored || stored.player_id !== player.id) {
      throw new HttpError(404, "NO_ROUND", "Раунд не найден");
    }
    return stored;
  }

  /**
   * Что можно показать игроку о случайности раунда.
   *
   * Серверное семя раскрывается только у закрытого раунда: раскрыть его
   * посреди фриспинов — значит отдать игроку все будущие исходы этого же
   * раунда, которые считаются из того же потока.
   */
  function fairDisclosure(stored) {
    const info = stored.data?.fair;
    if (!info?.seedId) return null;
    const seed = db.getFairSeed(info.seedId);
    if (!seed) return null;
    const revealed = stored.state === "complete";
    return {
      serverSeedHash: seed.server_seed_hash,
      clientSeed: seed.client_seed,
      nonce: seed.nonce,
      revealed,
      serverSeed: revealed ? seed.server_seed : null
    };
  }

  /* ───────────────────── провабли-фейр: маршруты ────────────────── */

  /**
   * Текущее обязательство. Игрок вправе задать своё клиентское семя —
   * тогда выдаётся новое серверное семя и новый хеш: обязательство,
   * которое уже опубликовано, задним числом не меняется.
   */
  router.post("/api/fair/commit", (ctx) => {
    const { player } = requireSession(ctx);
    rateLimit(`fair:${player.id}`, config.limits.fairCommitsPerMinute);

    const raw = readString(ctx.body.clientSeed, "clientSeed", { max: 64, optional: true });
    const clientSeed = raw === null ? null : fair.normalizeClientSeed(raw);
    if (raw !== null && clientSeed === null) {
      throw badRequest("Клиентское семя: до 64 символов из A-Z, a-z, 0-9, _ и -");
    }

    // Пока раунд не закрыт, менять семя нельзя: его исход уже определён
    // выданным обязательством, и подмена семени выглядела бы как попытка
    // переиграть результат.
    if (clientSeed && db.getBlockingRound(player.id)) {
      throw new HttpError(409, "ROUND_IN_PROGRESS", "Сначала завершите текущий раунд");
    }

    return { fair: publicFair(ensureFairSeed(player, clientSeed)) };
  });

  router.get("/api/fair", (ctx) => {
    const { player } = requireSession(ctx);
    return { fair: publicFair(ensureFairSeed(player)) };
  });

  /**
   * Проверка прошлого раунда.
   *
   * Сервер пересчитывает раунд из раскрытых семян тем же кодом, что играл
   * его в бою, и показывает результат построчно. Игроку это нужно не как
   * «сервер сам себя проверил», а как эталон: формула потока опубликована,
   * и тот же расчёт воспроизводится любым сторонним скриптом.
   */
  router.get(/^\/api\/fair\/round\/(?<id>[A-Za-z0-9-]{1,64})$/, (ctx) => {
    const { player } = requireSession(ctx);
    const stored = ownRound(player, ctx.params.id);
    const disclosure = fairDisclosure(stored);

    if (!disclosure) {
      throw new HttpError(409, "NO_COMMITMENT", "Раунд сыгран без обязательства и проверке не подлежит");
    }
    if (!disclosure.revealed) {
      throw new HttpError(409, "ROUND_IN_PROGRESS", "Семя раскрывается после закрытия раунда");
    }

    const data = stored.data || {};
    const check = fair.verifyRound({
      stored: {
        serverSeedHash: disclosure.serverSeedHash,
        bet: data.bet,
        spins: data.spins || []
      },
      serverSeed: disclosure.serverSeed,
      clientSeed: disclosure.clientSeed,
      nonce: disclosure.nonce
    });

    return {
      roundId: stored.id,
      bet: data.bet,
      ...disclosure,
      algorithm: "HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${block}`) → uint32 BE, отбраковка по модулю",
      check
    };
  });

  /* ─────────────────────────── служебное ────────────────────────── */

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

    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new HttpError(400, "BAD_TOKEN", "Полезная нагрузка токена — не объект");
    }
    const playerId = readString(payload.playerId, "playerId", { max: 128, pattern: EXTERNAL_ID_RE });
    if (payload.currency !== undefined) {
      readString(payload.currency, "currency", { max: 8, pattern: /^[A-Za-z]{3,8}$/ });
    }
    if (payload.exp !== undefined) {
      if (!Number.isFinite(payload.exp)) throw new HttpError(400, "BAD_TOKEN", "Некорректный срок токена");
      if (payload.exp < Date.now()) throw new HttpError(401, "TOKEN_EXPIRED", "Launch-токен истёк");
    }
    return { ...payload, playerId };
  }

  /**
   * Сверка после нештатного перезапуска.
   *
   * Раунд в состоянии pending означает, что процесс умер между списанием
   * ставки и результатом спина. Отдельно ищутся зависшие транзакции: запрос
   * к кошельку оператора мог уйти и не вернуться, и такая строка — это
   * деньги в неизвестном состоянии. И то и другое разбирается откатом.
   */
  async function reconcile(olderThanMs = 30000) {
    let fixed = 0;

    const stale = db.getStalePendingRounds(olderThanMs);
    if (stale.length) console.warn(`[сверка] незакрытых раундов: ${stale.length}`);
    for (const r of stale) {
      const player = db.getPlayer(r.player_id);
      const betTx = db.q.txByRoundType.get(r.id, "bet");
      try {
        if (betTx && betTx.status !== "failed" && betTx.status !== "rolled_back") {
          await wallet.rollback({ player, roundId: r.id, currency: r.currency });
          db.markRolledBack(betTx.id);
          console.warn(`[сверка] раунд ${r.id}: ставка возвращена`);
        }
        db.saveRound(r.id, {
          state: "complete",
          totalWinMinor: 0,
          data: { ...r.data, state: "aborted", reason: "RECONCILED" },
          rngDraws: r.rng_draws
        });
        fixed++;
      } catch (err) {
        console.error(`[сверка] раунд ${r.id}: не удалось откатить —`, err.message);
      }
    }

    // Строка в pending — это ушедший к оператору запрос без ответа.
    // Ставку возвращаем, выигрыш дозачисляем: оба вызова идемпотентны
    // по раунду, поэтому повтор безопасен даже если деньги уже прошли.
    for (const tx of db.getStalePendingTransactions(olderThanMs)) {
      const r = db.getRound(tx.round_id);
      const player = db.getPlayer(tx.player_id);
      if (!r || !player) continue;
      try {
        if (tx.type === "win") {
          await wallet.win({
            player, roundId: r.id, amountMinor: r.total_win_minor, currency: r.currency
          });
          console.warn(`[сверка] раунд ${r.id}: выигрыш дозачислен`);
        } else if (tx.type === "bet") {
          await wallet.rollback({ player, roundId: r.id, currency: r.currency });
          db.markRolledBack(tx.id);
          console.warn(`[сверка] раунд ${r.id}: зависшая ставка возвращена`);
        }
        fixed++;
      } catch (err) {
        console.error(`[сверка] транзакция ${tx.id} (${tx.type}): не удалось разобрать —`, err.message);
      }
    }

    return fixed;
  }

  const server = createServer({
    router,
    config,
    limiter,
    // Неожиданное исключение логируется целиком и получает метку, по которой
    // его найдут в логе по ответу клиента. Наш собственный HttpError — это
    // описанная ситуация (кошелёк не ответил), и стек к ней ничего не добавляет.
    onError: (err, req, ref) => console.error(
      `[${err.status || 500}${ref ? " " + ref : ""}] ${req.method} ${req.url}`,
      ref ? err : err.message
    )
  });

  if (hub) {
    server.on("upgrade", (req, socket, head) => hub.handleUpgrade(req, socket, head));
  }

  return { server, router, limiter, reconcile };
}

module.exports = { createApp };
