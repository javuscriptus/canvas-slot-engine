// Тикеты на апгрейд WebSocket: одноразовость, срок жизни, привязка к сессии.
//
// Это защита от утечки токена через access-логи прокси, поэтому проверяем
// именно те свойства, ради которых тикет и вводился.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { Database } = require("../src/db");

function freshDb() {
  const db = new Database(":memory:");
  const player = db.ensurePlayer("test:1", { currency: "RUB", startBalanceMinor: 100000 });
  const token = db.createSession(player.id, 3600e3, {});
  return { db, player, token };
}

test("тикет гасится первым же использованием", () => {
  const { db, player, token } = freshDb();
  const { ticket } = db.createWsTicket(player.id, token);

  const first = db.consumeWsTicket(ticket);
  assert.equal(first.playerId, player.id);

  // Повтор — это либо гонка двух вкладок, либо кто-то поднял тикет из логов.
  assert.equal(db.consumeWsTicket(ticket), null);
  db.close();
});

test("истёкший тикет не пускает", () => {
  const { db, player, token } = freshDb();
  const { ticket } = db.createWsTicket(player.id, token, -1);
  assert.equal(db.consumeWsTicket(ticket), null);
  db.close();
});

test("выдача нового тикета обесценивает предыдущий для той же сессии", () => {
  const { db, player, token } = freshDb();
  const first = db.createWsTicket(player.id, token).ticket;
  const second = db.createWsTicket(player.id, token).ticket;

  assert.equal(db.consumeWsTicket(first), null);
  assert.equal(db.consumeWsTicket(second).playerId, player.id);
  db.close();
});

test("тикет бесполезен, если сессия уже закрыта", () => {
  const { db, player, token } = freshDb();
  const { ticket } = db.createWsTicket(player.id, token);
  db.db.exec(`DELETE FROM sessions`);
  assert.equal(db.consumeWsTicket(ticket), null);
  db.close();
});

test("пустой и выдуманный тикеты отклоняются", () => {
  const { db } = freshDb();
  assert.equal(db.consumeWsTicket(null), null);
  assert.equal(db.consumeWsTicket(""), null);
  assert.equal(db.consumeWsTicket("не существует"), null);
  db.close();
});

test("уборка удаляет протухшие тикеты", () => {
  const { db, player, token } = freshDb();
  db.createWsTicket(player.id, token, -1);
  db.cleanup();
  const left = db.db.prepare(`SELECT COUNT(*) AS n FROM ws_tickets`).get().n;
  assert.equal(left, 0);
  db.close();
});
