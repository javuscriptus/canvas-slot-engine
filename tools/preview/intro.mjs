// Заставка: показывается, кликается, запоминает выбор.
import { chromium } from "playwright";
const URL = process.env.URL || "http://localhost:3111/";
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

async function open(w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
  await p.waitForTimeout(700);
  return { p, errs };
}

const centerOf = `(node) => {
  const g = window.__game, s = node.getLocalSize();
  const pt = node.worldMatrix.apply(s.width * (0.5 - (node.anchorX || 0)),
                                    s.height * (0.5 - (node.anchorY || 0)));
  const c = g.renderer.canvas, r = c.getBoundingClientRect();
  return { x: r.left + pt.x * (r.width / c.width), y: r.top + pt.y * (r.height / c.height) };
}`;

for (const [name, w, h] of [["портрет", 390, 844], ["ландшафт", 1280, 720]]) {
  const { p, errs } = await open(w, h);
  const shown = await p.evaluate(() => window.__game.startScreen.visible);
  console.log(`${name}: заставка показана — ${shown ? "✓" : "✗"}`);
  await p.screenshot({ path: `/tmp/intro-${w}x${h}.png` });

  // нажатие мимо кнопки не должно проваливаться в игру
  const leak = await p.evaluate(() => {
    const g = window.__game, c = g.renderer.canvas, r = c.getBoundingClientRect();
    const pt = g.renderer.toStage(r.left + r.width * 0.1, r.top + r.height * 0.95, { x: 0, y: 0 });
    const hit = g.input._hitTest(g.renderer.stage, pt.x, pt.y);
    let n = hit; while (n && n !== g.startScreen) n = n.parent;
    return { hit: hit ? hit.constructor.name : null, inIntro: n === g.startScreen };
  });
  console.log(`${name}: нажатие мимо кнопки перехвачено — ${leak.inIntro ? "✓" : "✗ (" + leak.hit + ")"}`);

  // галочка
  const box = await p.evaluate(`(${centerOf})(window.__game.startScreen.skip)`);
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(150);
  const checked = await p.evaluate(() => window.__game.startScreen.skipChecked);
  console.log(`${name}: галочка ставится — ${checked ? "✓" : "✗"}`);

  // кнопка «Играть»
  const play = await p.evaluate(`(${centerOf})(window.__game.startScreen.playButton)`);
  await p.mouse.click(play.x, play.y);
  await p.waitForTimeout(700);
  const gone = await p.evaluate(() => !window.__game.startScreen.visible);
  const stored = await p.evaluate(() => localStorage.getItem("sochi.skipIntro"));
  console.log(`${name}: экран закрылся — ${gone ? "✓" : "✗"}, выбор сохранён — ${stored === "1" ? "✓" : "✗ " + stored}`);

  // спин после заставки
  await p.evaluate(() => window.__game.requestSpin());
  await p.waitForTimeout(2600);
  const st = await p.evaluate(() => window.__game.state);
  console.log(`${name}: игра работает после заставки — ${st === "idle" ? "✓" : "✗ " + st}`);

  // повторный вход с сохранённой галочкой
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
  await p.waitForTimeout(500);
  const again = await p.evaluate(() => window.__game.startScreen.visible);
  console.log(`${name}: после галочки заставки нет — ${!again ? "✓" : "✗"}`);
  if (errs.length) console.log("   ⚠ " + errs.slice(0, 3).join(" | "));
  await p.close();
}
await b.close();
