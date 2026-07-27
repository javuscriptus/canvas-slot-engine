// Точка входа игрового сервера (RGS).
//
//   node server/src/index.js
//
// Здесь только сборка боевого экземпляра: конфигурация из окружения,
// БД, кошелёк, канал уведомлений, запуск и корректное завершение.
// Сами маршруты живут в app.js — их можно поднять в тесте на памяти,
// не трогая ни окружение, ни порт.

"use strict";

const { config, validate } = require("./config");
const { Database } = require("./db");
const { createWallet } = require("./wallet");
const { WebSocketHub } = require("./ws");
const { RateLimiter } = require("./ratelimit");
const { createApp } = require("./app");
const money = require("./money");

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
const limiter = new RateLimiter();

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

const { server, reconcile } = createApp({ config, db, wallet, hub, limiter });

/* ──────────────────────────── запуск ────────────────────────────── */

server.listen(config.http.port, config.http.host, () => {
  console.log(`Sochi Sunset RGS`);
  console.log(`  режим:    ${config.env}`);
  console.log(`  кошелёк:  ${wallet.kind}`);
  console.log(`  адрес:    http://${config.http.host}:${config.http.port}`);
  console.log(`  сокет:    ${hub ? config.ws.path : "выключен"}`);
  console.log(`  iframe:   ${config.http.frameAncestors.join(" ") || "запрещён"}`);
  if (config.demo.enabled) {
    const start = money.toMajor(config.demo.startBalanceMinor, config.demo.currency);
    console.log(`  демо:     включено, стартовый баланс ${start} ${config.demo.currency}`);
  }
});

reconcile().catch((e) => console.error("[сверка] сбой:", e));

const cleanupTimer = setInterval(() => {
  db.cleanup();
  limiter.sweep();
  reconcile().catch((e) => console.error("[сверка] сбой:", e));
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

module.exports = { server, db };
