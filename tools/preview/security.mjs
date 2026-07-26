// Проверка того, что закрыто в этом заходе:
//   • апгрейд сокета идёт по одноразовому тикету, а не по токену сессии;
//   • токен в query-строке отвергается, а не принимается «на всякий случай»;
//   • раунд отдаётся только своему владельцу;
//   • лимиты ставки по валюте применяются на сервере, а не только в UI.
//
//   node tools/preview/security.mjs

import net from "node:net";
import crypto from "node:crypto";

const BASE = process.env.URL || "http://localhost:3111";

let failures = 0;
const ok = (cond, text) => {
  console.log(cond ? `✓ ${text}` : `✗ ${text}`);
  if (!cond) failures++;
};

async function api(method, path, { body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/* ── сессия ──────────────────────────────────────────────────────── */

const session = await api("POST", "/api/session", { body: {} });
ok(session.status === 200, "демо-сессия открывается");
const token = session.data.sessionToken;

ok(!!session.data.currency && session.data.currency.code === "RUB",
  `в сессии есть описание валюты (${session.data.currency?.code} ${session.data.currency?.symbol})`);
ok(session.data.currency.betLevels.length > 0 &&
   session.data.currency.minBet > 0,
  `уровни ставок пришли в деньгах: ${session.data.currency.betLevels.slice(0, 3).join(", ")}…`);

/* ── тикет на сокет ──────────────────────────────────────────────── */

const t1 = await api("POST", "/api/ws-ticket", { token });
ok(t1.status === 200 && !!t1.data.ticket, "тикет выдаётся по сессии");
ok(t1.data.ttlMs > 0 && t1.data.ttlMs <= 60000,
  `тикет короткоживущий: ${t1.data.ttlMs} мс`);
ok(t1.data.ticket !== token, "тикет не равен токену сессии");

const noAuth = await api("POST", "/api/ws-ticket");
ok(noAuth.status === 401, "без сессии тикет не выдаётся");

/* ── апгрейд ─────────────────────────────────────────────────────── */

// Минимальный клиент RFC 6455: нужен только код ответа на апгрейд,
// поэтому обходимся сырым сокетом без библиотеки.
function upgrade(query) {
  return new Promise((resolve) => {
    const url = new URL(BASE);
    const socket = net.connect(Number(url.port || 80), url.hostname, () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        `GET /ws${query} HTTP/1.1\r\n` +
        `Host: ${url.host}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let buf = "";
    socket.on("data", (c) => {
      buf += c.toString("latin1");
      if (buf.includes("\r\n")) {
        socket.destroy();
        resolve(parseInt(buf.split(" ")[1], 10));
      }
    });
    socket.on("error", () => resolve(0));
    socket.on("close", () => resolve(parseInt((buf.split(" ")[1] || "0"), 10)));
  });
}

const good = await upgrade(`?ticket=${encodeURIComponent(t1.data.ticket)}`);
ok(good === 101, `апгрейд по тикету принят (${good})`);

const replay = await upgrade(`?ticket=${encodeURIComponent(t1.data.ticket)}`);
ok(replay === 401, `повторное использование тикета отклонено (${replay})`);

const bySessionToken = await upgrade(`?token=${encodeURIComponent(token)}`);
ok(bySessionToken === 400,
  `токен сессии в query-строке отвергнут (${bySessionToken}) — старый способ закрыт`);

const noTicket = await upgrade("");
ok(noTicket === 401, `апгрейд без тикета отклонён (${noTicket})`);

/* ── история и раунд ─────────────────────────────────────────────── */

const spin = await api("POST", "/api/spin", { token, body: { bet: 1, requestId: crypto.randomUUID() } });
ok(spin.status === 200, "спин проходит");

const detail = await api("GET", `/api/round/${spin.data.roundId}`, { token });
ok(detail.status === 200 && detail.data.id === spin.data.roundId, "раунд отдаётся по номеру");
ok(Array.isArray(detail.data.spins) && detail.data.spins[0].screen?.length === 3,
  "в раунде есть экран каждого спина");
ok(typeof detail.data.rngDraws === "number" && detail.data.rngDraws > 0,
  `в раунде есть счётчик обращений к ГПСЧ (${detail.data.rngDraws})`);

const other = await api("POST", "/api/session", { body: {} });
const stolen = await api("GET", `/api/round/${spin.data.roundId}`, { token: other.data.sessionToken });
ok(stolen.status === 404, "чужой раунд не отдаётся");

const anon = await api("GET", `/api/round/${spin.data.roundId}`);
ok(anon.status === 401, "раунд не отдаётся без сессии");

/* ── ставки ──────────────────────────────────────────────────────── */

const badBet = await api("POST", "/api/spin", { token, body: { bet: 7.77, requestId: crypto.randomUUID() } });
ok(badBet.status === 400, "ставка вне списка уровней отклоняется");

console.log(failures ? `\n✗ провалов: ${failures}` : "\n✓ все проверки пройдены");
process.exit(failures ? 1 : 0);
