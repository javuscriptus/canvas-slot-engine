// Проверка, что игра действительно проигрывает звук: считаем запуски
// источников в WebAudio. Без этого «звук готов» — утверждение на веру.
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  await p.addInitScript(() => {
    // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
    // только мешала бы: её затемнение перехватывает нажатия.
    try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
  });

await p.addInitScript(() => {
  window.__sfx = [];
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    window.__sfx.push({ offset: a[1], dur: a[2] });
    return orig.apply(this, a);
  };
});
await p.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
await p.waitForTimeout(1500);

const sprite = await p.evaluate(() => window.__game.audio.sprite);
console.log("эффектов в спрайте:", Object.keys(sprite).length, "→", Object.keys(sprite).join(", "));
const missing = ["click","button","error","spin_start","reel_stop","scatter","win_small",
                 "win_medium","win_big","coins","fanfare","freespins","tick","gull","wave"]
  .filter((k) => !sprite[k]);
console.log(missing.length ? "✗ нет в спрайте: " + missing.join(", ") : "✓ все нужные эффекты на месте");

await p.evaluate(async () => { for (let i=0;i<3;i++) await window.__game.requestSpin(); });
await p.waitForTimeout(500);
const n = await p.evaluate(() => window.__sfx.length);
// Музыка не заиграет, пока браузер не увидит жест пользователя, —
// это его правило, а не ошибка игры. Поэтому сначала кликаем, потом
// проверяем: до клика в очереди лежит _pendingMusic, после — _music.
await p.mouse.click(300, 300);
await p.waitForTimeout(600);
const music = await p.evaluate(() => ({
  playing: !!window.__game.audio._music,
  queued: !!window.__game.audio._pendingMusic,
  unlocked: !!window.__game.audio.unlocked
}));
console.log(`запусков звука за 3 спина: ${n}`, n > 5 ? "✓" : "✗ звук молчит");
console.log(`музыка: играет ${music.playing ? "✓" : "✗"}, контекст разблокирован ${music.unlocked ? "✓" : "✗"}`);
await b.close();
process.exit(missing.length || n <= 5 || !music.playing ? 1 : 0);
