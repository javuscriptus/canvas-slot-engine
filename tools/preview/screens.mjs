// Снимки новых экранов: разбор раунда и автоигра с лимитами.
// Проверяем не «красиво», а «нарисовалось и не упало».

import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:3111/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
  // только мешала бы: её затемнение перехватывает нажатия.
  try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
});

const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });

// Немного раундов, чтобы истории было что показывать.
await page.evaluate(async () => {
  for (let i = 0; i < 5; i++) {
    await window.__game.requestSpin();
    await new Promise((r) => setTimeout(r, 120));
  }
});

/* ── автоигра ─────────────────────────────────────────────────── */
await page.evaluate(() => window.__game.autoplayModal.show());
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/scr-autoplay.png" });

const auto = await page.evaluate(() => {
  const m = window.__game.autoplayModal;
  const rows = m.rows.map((r) => ({
    key: r.key,
    chips: r.chips.length,
    labels: r.chips.map((c) => c.text.text)
  }));
  return { rows, visible: m.visible };
});
console.log("автоигра: рядов", auto.rows.length,
  auto.rows.map((r) => `${r.key}(${r.chips})`).join(" "));
console.log("  лимит проигрыша:", auto.rows[1].labels.join(" | "));

// Настраиваем автоигру НАСТОЯЩИМИ кликами мышью, а не вызовом
// обработчиков. Прошлая версия этого теста дёргала onTap напрямую
// и не заметила, что ни одна фишка вообще не нажимается.
const at = await page.evaluate(() => {
  const g = window.__game, m = g.autoplayModal;
  const canvas = g.renderer.canvas, r = canvas.getBoundingClientRect();
  const pos = (node) => {
    const s = node.getLocalSize();
    const p = node.worldMatrix.apply(s.width * (0.5 - (node.anchorX || 0)),
                                     s.height * (0.5 - (node.anchorY || 0)));
    return { x: r.left + p.x * (r.width / canvas.width),
             y: r.top + p.y * (r.height / canvas.height) };
  };
  const row = (k) => m.rows.find((x) => x.key === k);
  return {
    spins10: pos(row("spins").chips[0]),
    loss50: pos(row("loss").chips[2]),
    win100: pos(row("win").chips[3]),
    start: pos(m.startButton)
  };
});

for (const key of ["spins10", "loss50", "win100"]) {
  await page.mouse.click(at[key].x, at[key].y);
  await page.waitForTimeout(120);
}
const chosen = await page.evaluate(() => {
  const m = window.__game.autoplayModal;
  return Object.fromEntries(m.rows.map((r) => [r.key, r.selected]));
});
console.log("выбрано кликами:", JSON.stringify(chosen));

await page.mouse.click(at.start.x, at.start.y);
await page.waitForTimeout(200);
const limits = await page.evaluate(() => {
  const g = window.__game;
  const out = {
    left: g.autoplayLeft, loss: g.autoplayLossLimit,
    win: g.autoplayWinLimit, net: g.autoplayNet, bet: g.betMoney,
    closed: !g.autoplayModal.visible
  };
  g.stopAutoplay();
  return out;
});
console.log("лимиты приняты:", JSON.stringify(limits));
const okLimits = chosen.spins === 10 && chosen.loss === 50 && chosen.win === 100
  && limits.left === 10 && limits.loss === 50 && limits.win === 100;
console.log(okLimits ? "✓ автоигра настраивается мышью" : "✗ настройка автоигры мышью не работает");

/* ── история и разбор раунда ──────────────────────────────────── */
await page.evaluate(() => window.__game.autoplayModal.hide());
await page.waitForTimeout(300);
await page.evaluate(() => window.__game.showHistory());
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/scr-history.png" });

// Настоящий клик мышью, а не вызов метода: попадание по строке считается
// обратной матрицей узла, и ошибиться в ней проще всего.
await page.mouse.click(600, 255);
await page.waitForTimeout(600);
const byClick = await page.evaluate(() => !!window.__game.historyModal.detail);
console.log(byClick ? "✓ строка истории открывается кликом" : "✗ клик по строке не сработал");
await page.evaluate(() => window.__game.historyModal.showList());
await page.waitForTimeout(200);

const opened = await page.evaluate(async () => {
  const g = window.__game;
  const id = g.historyModal.rounds[0]?.id;
  await g.showRoundDetail(id);
  await new Promise((r) => setTimeout(r, 300));
  const d = g.historyModal.detail;
  return d && {
    id: d.id, bet: d.bet, win: d.win, spins: d.spins.length,
    rngDraws: d.rngDraws, hasScreen: Array.isArray(d.spins[0]?.screen),
    detailVisible: g.historyModal.detailView.visible,
    backVisible: g.historyModal.backButton.visible
  };
});
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/scr-round.png" });
console.log("разбор раунда:", JSON.stringify(opened));

// Возврат к списку
const back = await page.evaluate(() => {
  window.__game.historyModal.backButton.onTap();
  const m = window.__game.historyModal;
  return { list: m.list.visible, detail: m.detailView.visible };
});
console.log("возврат к списку:", JSON.stringify(back));

await browser.close();
console.log(errs.length ? "⚠ ошибки: " + errs.slice(0, 5).join(" | ") : "✓ ошибок в консоли нет");
process.exit(errs.length || !opened || !back.list || !byClick || !okLimits ? 1 : 0);
