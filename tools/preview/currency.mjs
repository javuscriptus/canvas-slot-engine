// Прогон в валюте, отличной от рубля: launch-токен оператора задаёт JPY,
// где минорных единиц нет вовсе. Именно на этой валюте ломается любой код,
// который делит баланс на 100.
import crypto from "node:crypto";

const BASE = process.env.URL || "http://localhost:3112";
const SECRET = "launch-test";

function launchToken(playerId, currency) {
  const payload = Buffer.from(JSON.stringify({ playerId, currency, exp: Date.now() + 60000 }))
    .toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

async function api(method, path, { body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}),
               ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let bad = 0;
const ok = (c, t) => { console.log(c ? `✓ ${t}` : `✗ ${t}`); if (!c) bad++; };

for (const [currency, expectDecimals, expectUnit] of [["JPY", 0, 20], ["USD", 2, 0.1]]) {
  const s = await api("POST", "/api/session",
    { body: { launchToken: launchToken(`op:${currency}:1`, currency) } });
  ok(s.status === 200, `${currency}: сессия открыта`);
  const c = s.data.currency;
  ok(c.decimals === expectDecimals, `${currency}: знаков после запятой ${c.decimals}`);
  ok(c.unit === expectUnit, `${currency}: номинал монеты ${c.unit}`);
  ok(c.betLevels[0] === Math.round(0.2 * expectUnit * 10 ** expectDecimals) / 10 ** expectDecimals,
    `${currency}: минимальный уровень ставки ${c.betLevels[0]} ${c.symbol}`);
  ok(Number.isInteger(s.data.balance) || expectDecimals > 0,
    `${currency}: баланс ${s.data.balance} без дробной части там, где её нет`);

  // Лимиты оператора для JPY заданы через BET_LIMITS.
  if (currency === "JPY") {
    ok(c.minBet === 2000 && c.maxBet === 200000,
      `JPY: лимиты оператора применены (${c.minBet}…${c.maxBet})`);
  }
}
/* ── настоящий спин в иенах ───────────────────────────────────── */

// Кошелёк локальный и пустой, поэтому сначала кладём деньги напрямую.
const s = await api("POST", "/api/session",
  { body: { launchToken: launchToken("op:JPY:play", "JPY") } });
const token = s.data.sessionToken;

const { execSync } = await import("node:child_process");
execSync(`node -e "
const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync('/tmp/cur.db');
d.prepare('UPDATE players SET balance_minor = ? WHERE external_id = ?').run(500000,'op:JPY:play');
d.close();"`, { stdio: "pipe" });

const spin = await api("POST", "/api/spin",
  { token, body: { bet: 100, requestId: crypto.randomUUID() } });
ok(spin.status === 200, `JPY: спин прошёл, ставка 100 монет = 2000 ¥`);
ok(Number.isInteger(spin.data.balance),
  `JPY: баланс после спина целый — ${spin.data.balance} ¥`);
ok(spin.data.balance === 500000 - 2000 + Math.round(spin.data.totalWin),
  `JPY: списано ровно 2000 ¥ (баланс ${spin.data.balance}, выигрыш ${spin.data.totalWin})`);

const hist = await api("GET", "/api/history?limit=1", { token });
ok(hist.data.rounds[0].bet === 2000, `JPY: в истории ставка 2000 ¥, а не 20.00`);

console.log(bad ? `\n✗ провалов: ${bad}` : "\n✓ валюты в порядке");
process.exit(bad ? 1 : 0);
