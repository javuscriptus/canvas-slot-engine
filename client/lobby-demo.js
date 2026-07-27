// Логика демо-лобби: приём событий игры и отправка команд в iframe.
// Вынесено из HTML по той же причине, что и стили: script-src 'self'
// не выполняет инлайновые скрипты, а демо обязано работать под тем же
// заголовком, что и боевая страница.

const PROTOCOL = "rgs-game";
const frame = document.getElementById("game");
const log = document.getElementById("log");
const bal = document.getElementById("bal");
const roundEl = document.getElementById("round");

const fmt = (n) => Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = () => new Date().toLocaleTimeString("ru-RU", { hour12: false });

function add(kind, key, data) {
  const row = document.createElement("div");
  row.className = "row " + kind;
  row.innerHTML = `<span class="t">${time()}</span><span class="k">${key}</span>` +
    (data && Object.keys(data).length ? `<pre>${JSON.stringify(data)}</pre>` : "");
  log.prepend(row);
  while (log.children.length > 120) log.lastChild.remove();
}

// Игра → лобби. В бою здесь обязательна проверка event.origin
// по домену, с которого отдаётся игра.
window.addEventListener("message", (e) => {
  const m = e.data;
  if (!m || m.protocol !== PROTOCOL || !m.event) return;
  add("in", m.event, m.payload);

  const p = m.payload || {};
  if (p.balance !== undefined) bal.textContent = fmt(p.balance);

  if (m.event === "round.start") roundEl.textContent = "идёт";
  if (m.event === "round.end") {
    roundEl.textContent = p.win > 0 ? `выигрыш ${fmt(p.win)}` : "без выигрыша";
  }
  if (m.event === "lobby.cashier") {
    roundEl.textContent = "нужен депозит";
    // Настоящее лобби здесь открыло бы кассу.
  }
});

// Лобби → игре
for (const btn of document.querySelectorAll("[data-cmd]")) {
  btn.addEventListener("click", () => {
    const command = btn.dataset.cmd;
    const payload = command === "reality-check"
      ? { message: "Вы играете уже 30 минут" } : {};
    frame.contentWindow.postMessage({ protocol: PROTOCOL, command, payload }, "*");
    add("out", command, payload);
  });
}
