// Отправка push-уведомления игроку — так это будет делать платформа оператора.
//
//   WALLET_SECRET=test node server/src/tools/notify.js \
//     --player demo:abc --event balance --balance 5000
//
//   WALLET_SECRET=test node server/src/tools/notify.js \
//     --player demo:abc --event session.close --reason "выход по требованию"
//
// Сервер обязан быть запущен с тем же WALLET_SECRET, иначе подпись
// не совпадёт и запрос будет отклонён — это и есть защита канала.

"use strict";

const crypto = require("node:crypto");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const secret = process.env.WALLET_SECRET || "";
  if (!secret) {
    console.error("Нужен WALLET_SECRET — тот же, с которым запущен сервер.");
    process.exit(1);
  }

  const playerId = arg("player");
  if (!playerId) {
    console.error("Нужен --player <external id игрока>");
    process.exit(1);
  }

  const event = arg("event", "balance");
  const url = arg("url", `http://localhost:${process.env.PORT || 3000}/api/notify`);

  const payload = {};
  if (event === "balance") {
    // Баланс передаётся в минорных единицах — как и везде в системе.
    payload.balance = parseInt(arg("balance", "100000"), 10);
  }
  if (arg("reason")) payload.reason = arg("reason");
  if (arg("message")) payload.message = arg("message");

  const body = JSON.stringify({ playerId, event, payload });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": signature },
    body
  });
  const data = await res.json().catch(() => ({}));
  console.log(res.status, JSON.stringify(data));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
