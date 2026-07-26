// Конфигурация из переменных окружения.
// Значения по умолчанию рассчитаны на локальный демо-запуск; всё, что
// касается денег и доступа, в проде обязано приходить из окружения.

"use strict";

const path = require("node:path");

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envInt(name, fallback) {
  const v = env(name, null);
  return v === null ? fallback : parseInt(v, 10);
}

function envBool(name, fallback) {
  const v = env(name, null);
  if (v === null) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

const NODE_ENV = env("NODE_ENV", "development");
const isProd = NODE_ENV === "production";

const config = {
  env: NODE_ENV,
  isProd,
  gameId: env("GAME_ID", "sochi-sunset"),
  gameVersion: env("GAME_VERSION", "1.0.0"),

  http: {
    host: env("HOST", "0.0.0.0"),
    port: envInt("PORT", 3000),
    // Список источников через запятую. Пустое значение = запросы только
    // с того же origin, что и статика.
    corsOrigins: env("CORS_ORIGINS", "").split(",").map((s) => s.trim()).filter(Boolean),
    trustProxy: envBool("TRUST_PROXY", false),
    // Домены лобби, которым разрешено встраивать игру в iframe.
    // 'self' — только собственный домен; пусто — встраивание запрещено.
    frameAncestors: env("FRAME_ANCESTORS", "'self'")
      .split(",").map((s) => s.trim()).filter(Boolean),
    staticDir: path.resolve(__dirname, "../../client"),
    serveStatic: envBool("SERVE_STATIC", true)
  },

  db: {
    file: env("DB_FILE", path.resolve(__dirname, "../../data/game.db"))
  },

  session: {
    ttlMs: envInt("SESSION_TTL_MS", 12 * 3600e3),
    // Секрет для проверки launch-токена оператора.
    launchSecret: env("LAUNCH_SECRET", "")
  },

  wallet: {
    mode: env("WALLET_MODE", "local"),        // local | seamless
    url: env("WALLET_URL", ""),
    secret: env("WALLET_SECRET", ""),
    operatorId: env("OPERATOR_ID", "demo")
  },

  demo: {
    enabled: envBool("DEMO_ENABLED", !isProd),
    startBalanceMinor: envInt("DEMO_BALANCE_MINOR", 100000),  // 1000.00
    currency: env("DEMO_CURRENCY", "RUB")
  },

  ws: {
    enabled: envBool("WS_ENABLED", true),
    path: env("WS_PATH", "/ws"),
    heartbeatMs: envInt("WS_HEARTBEAT_MS", 25000),
    // Срок жизни одноразового тикета на апгрейд. Больше нескольких секунд
    // не нужно: браузер открывает сокет сразу после ответа HTTP.
    ticketTtlMs: envInt("WS_TICKET_TTL_MS", 15000)
  },

  limits: {
    // Защита от «дятла»: спамить спинами быстрее, чем крутятся барабаны,
    // смысла нет, а нагрузку это создаёт.
    spinsPerMinute: envInt("RATE_SPINS_PER_MIN", 240),
    // Тикет запрашивается один раз на подключение. Запас — на реконнекты
    // при дёрганой сети; экспоненциальная пауза в клиенте держит нас
    // сильно ниже этого потолка.
    wsTicketsPerMinute: envInt("RATE_WS_TICKETS_PER_MIN", 30),
    maxBetMinor: envInt("MAX_BET_MINOR", 1000000),
    minBetMinor: envInt("MIN_BET_MINOR", 1),
    // Лимиты по валютам: "USD:20:500000,JPY:2000:50000000" — код, минимум
    // и максимум в минорных единицах. Валюта не из списка получает
    // общие лимиты выше.
    perCurrency: env("BET_LIMITS", "")
  }
};

/** Проверка боевой конфигурации — падаем на старте, а не в первом спине. */
function validate() {
  const problems = [];
  if (config.isProd) {
    if (config.wallet.mode === "local") {
      problems.push("WALLET_MODE=local в production: деньги игрока будут храниться в локальной SQLite");
    }
    if (config.wallet.mode === "seamless" && (!config.wallet.url || !config.wallet.secret)) {
      problems.push("WALLET_MODE=seamless требует WALLET_URL и WALLET_SECRET");
    }
    if (!config.session.launchSecret) {
      problems.push("LAUNCH_SECRET не задан: launch-токены оператора не проверяются");
    }
    if (config.demo.enabled) {
      problems.push("DEMO_ENABLED=1 в production: любой сможет создать сессию с балансом");
    }
  }
  return problems;
}

module.exports = { config, validate };
