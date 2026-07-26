// Проверка, что по элементам интерфейса можно НАЖАТЬ.
//
// Стенд появился после конкретного провала. Прошлая проверка модальных
// окон дёргала обработчики напрямую — `modal.startButton.onTap()` — и
// показывала зелёные галочки. При этом ни одна фишка автоигры не
// нажималась: попадание указателя искалось только среди листьев графа
// сцены, а фишка — контейнер из подложки и надписи. Тест проверял
// проводку обработчиков и ровно не проверял единственное, что сломалось.
//
// Поэтому здесь настоящие клики мышью. Два разных вопроса:
//   1. каждый орган управления нажимается сам по себе;
//   2. ни одно нажатие по окну не проваливается на игру под ним.
//
//   node tools/preview/clickable.mjs

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

// Немного истории, чтобы в списке было что нажимать.
await page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await window.__game.requestSpin();
});
await page.waitForTimeout(300);

await page.addScriptTag({
  content: `
// Центр узла в клиентских координатах.
//
// Якорь обязателен в расчёте: у спрайта с anchor 0.5 область попадания
// лежит в локальных координатах от -w/2 до +w/2, а не от 0 до w. Формула
// «apply(w/2, h/2)» для такой кнопки указывает в её угол — на этом
// первая версия стенда и ошиблась, обвинив исправный движок.
window.__centerOf = function (node) {
  const g = window.__game;
  const s = node.getLocalSize();
  if (!(s.width > 0 && s.height > 0)) return null;
  const ax = node.anchorX || 0;
  const ay = node.anchorY || 0;
  const p = node.worldMatrix.apply(s.width * (0.5 - ax), s.height * (0.5 - ay));
  const canvas = g.renderer.canvas;
  const r = canvas.getBoundingClientRect();
  return {
    x: r.left + p.x * (r.width / canvas.width),
    y: r.top + p.y * (r.height / canvas.height),
    w: Math.round(s.width), h: Math.round(s.height)
  };
};

window.__interactiveIn = function (root) {
  const out = [];
  (function walk(n) {
    if (!n.visible) return;
    if (n.interactive) out.push(n);
    (n.children || []).forEach(walk);
  })(root);
  return out;
};

window.__belongsTo = function (node, root) {
  for (let n = node; n; n = n.parent) if (n === root) return true;
  return false;
};`
});

let failures = 0;
const report = (ok, text) => { console.log((ok ? "✓ " : "✗ ") + text); if (!ok) failures++; };

/**
 * Органы управления перечислены явно, а не выведены эвристикой.
 * Затемнение и подложка окна тоже интерактивны, но они не органы
 * управления, а перехватчики: их задача — не пропустить нажатие дальше.
 */
const MODALS = [
  {
    label: "таблица выплат", key: "paytable",
    controls: (m) => [["закрыть", m.closeButton]]
  },
  {
    label: "автоигра", key: "autoplayModal",
    controls: (m) => [
      ...m.rows.flatMap((row) => row.chips.map((c, i) => [`${row.key}[${i}]`, c])),
      ["старт", m.startButton],
      ["закрыть", m.closeButton]
    ]
  },
  {
    label: "история", key: "historyModal",
    // Окно надо открывать штатным путём: showHistory() ещё и загружает
    // список раундов, без которого в нём нечего нажимать.
    open: async (p) => { await p.evaluate(() => window.__game.showHistory()); },
    controls: (m) => [["список", m.list], ["закрыть", m.closeButton]]
  },
  {
    // Разбор раунда: кнопки «к списку» и перелистывание спинов — тоже
    // контейнеры из подложки и надписи, то есть ровно тот случай,
    // который был недоступен.
    label: "разбор раунда", key: "historyModal",
    open: async (p) => { await p.evaluate(() => window.__game.showHistory()); },
    prepare: async (p) => {
      await p.evaluate(async () => {
        const g = window.__game;
        const id = g.historyModal.rounds[0]?.id;
        if (id) await g.showRoundDetail(id);
      });
      await p.waitForTimeout(400);
    },
    controls: (m) => [
      ["к списку", m.backButton],
      ["предыдущий спин", m.prevButton],
      ["следующий спин", m.nextButton],
      ["закрыть", m.closeButton]
    ].filter(([, n]) => n && n.visible)
  }
];

for (const { label, key, controls, prepare, open } of MODALS) {
  await page.evaluate(({ k, hasOpen }) => {
    for (const m of ["paytable", "autoplayModal", "historyModal"]) window.__game[m].visible = false;
    if (!hasOpen) window.__game[k].show();
  }, { k: key, hasOpen: !!open });
  if (open) await open(page);
  await page.waitForTimeout(400);
  if (prepare) await prepare(page);

  const empty = await page.evaluate((k) => !window.__game[k].visible, key);
  if (empty) { report(false, `${label}: окно не открылось`); continue; }

  const list = await page.evaluate(({ k, src }) => {
    const m = window.__game[k];
    // eslint-disable-next-line no-new-func
    const items = new Function("m", "return (" + src + ")(m)")(m);
    window.__ctl = items.map(([name, node]) => ({ name, node }));
    return window.__ctl.map(({ name, node }, i) => ({ name, i, at: window.__centerOf(node) }));
  }, { k: key, src: controls.toString() });

  // Обработчики подменяются: нужен факт доставки события, а не побочные
  // эффекты вроде запуска автоигры или закрытия окна.
  await page.evaluate(() => {
    window.__orig = window.__ctl.map(({ node }) => node.onTap);
    window.__ctl.forEach(({ node }) => { node.__hit = false; node.onTap = () => { node.__hit = true; }; });
  });

  const dead = [];
  for (const it of list) {
    if (!it.at) { dead.push(`${it.name} — нулевой размер`); continue; }
    await page.mouse.click(it.at.x, it.at.y);
    const ok = await page.evaluate((i) => window.__ctl[i].node.__hit, it.i);
    if (!ok) dead.push(`${it.name} (${it.at.w}×${it.at.h} в ${Math.round(it.at.x)},${Math.round(it.at.y)})`);
  }

  await page.evaluate(() => {
    window.__ctl.forEach(({ node }, i) => { node.onTap = window.__orig[i]; });
  });

  report(dead.length === 0, `${label}: органов управления ${list.length}, недоступно ${dead.length}`);
  dead.slice(0, 8).forEach((d) => console.log("     не нажимается: " + d));

  // ── ни одно нажатие по площади окна не должно уходить в игру ──────
  const leaks = await page.evaluate((k) => {
    const g = window.__game;
    const modal = g[k];
    const canvas = g.renderer.canvas;
    const r = canvas.getBoundingClientRect();
    const bad = [];
    // Сетка точек по всему экрану: окно обязано ловить их все.
    for (let gx = 0.05; gx < 1; gx += 0.1) {
      for (let gy = 0.05; gy < 1; gy += 0.1) {
        const pt = g.renderer.toStage(r.left + gx * r.width, r.top + gy * r.height, { x: 0, y: 0 });
        const hit = g.input._hitTest(g.renderer.stage, pt.x, pt.y);
        if (!hit || !window.__belongsTo(hit, modal)) {
          bad.push(`${gx.toFixed(2)},${gy.toFixed(2)} → ${hit ? hit.constructor.name : "мимо"}`);
        }
      }
    }
    return bad;
  }, key);

  report(leaks.length === 0, `${label}: нажатий, проходящих сквозь окно — ${leaks.length}`);
  leaks.slice(0, 4).forEach((l) => console.log("     утечка: " + l));

  await page.evaluate((k) => window.__game[k].hide(), key);
  await page.waitForTimeout(250);
}

/* ── панель управления доступна, когда окон нет ───────────────────── */

const panelDead = await page.evaluate(async () => {
  const g = window.__game;
  const names = ["spinButton", "minusButton", "plusButton", "turboButton",
                 "autoButton", "menuButton", "soundButton", "infoButton", "historyButton"];
  window.__pctl = names.map((n) => ({ name: n, node: g.panel[n] })).filter((x) => x.node && x.node.visible);
  window.__porig = window.__pctl.map(({ node }) => node.onTap);
  window.__pctl.forEach(({ node }) => { node.__hit = false; node.onTap = () => { node.__hit = true; }; });
  return window.__pctl.map(({ name, node }, i) => ({ name, i, at: window.__centerOf(node) }));
});

const panelBad = [];
for (const it of panelDead) {
  if (!it.at) { panelBad.push(`${it.name} — нулевой размер`); continue; }
  await page.mouse.click(it.at.x, it.at.y);
  const ok = await page.evaluate((i) => window.__pctl[i].node.__hit, it.i);
  if (!ok) panelBad.push(it.name);
}
await page.evaluate(() => window.__pctl.forEach(({ node }, i) => { node.onTap = window.__porig[i]; }));
report(panelBad.length === 0, `панель управления: кнопок ${panelDead.length}, недоступно ${panelBad.length}`);
panelBad.forEach((d) => console.log("     не нажимается: " + d));

await browser.close();
if (errs.length) { console.log("⚠ ошибки: " + errs.slice(0, 4).join(" | ")); failures++; }
console.log(failures ? `\n✗ провалов: ${failures}` : "\n✓ весь интерфейс доступен указателю");
process.exit(failures ? 1 : 0);
