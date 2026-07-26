// Точка входа клиента: загрузка ассетов, открытие сессии, запуск игры.

import { Loader } from "./engine/loader.js";
import { AudioManager } from "./audio/audio.js";
import { GameApi } from "./game/api.js";
import { I18n } from "./game/i18n.js";
import { Game } from "./game/game.js";
import { GameSocket } from "./game/socket.js";
import { LobbyBridge } from "./game/lobby.js";

const els = {
  container: document.getElementById("game-container"),
  canvas: document.getElementById("game-canvas"),
  loader: document.getElementById("loader"),
  progressFill: document.getElementById("progress-fill"),
  status: document.getElementById("loader-status"),
  error: document.getElementById("error-screen"),
  errorText: document.getElementById("error-text"),
  errorRetry: document.getElementById("error-retry")
};

function setProgress(value, label) {
  els.progressFill.style.width = `${Math.round(value * 100)}%`;
  if (label) els.status.textContent = label;
}

function showError(message, retryLabel) {
  els.loader.classList.add("hidden");
  els.error.classList.remove("hidden");
  els.errorText.textContent = message;
  els.errorRetry.textContent = retryLabel;
  els.errorRetry.onclick = () => location.reload();
}

async function boot() {
  const i18n = new I18n(I18n.detect());
  const params = new URLSearchParams(location.search);

  document.documentElement.lang = i18n.lang;
  setProgress(0.02, i18n.t("loadingConnect"));

  const api = new GameApi({ baseUrl: params.get("api") || "" });
  const audio = new AudioManager({ enabled: localStorage.getItem("sochi.muted") !== "1" });
  audio.attachUnlock(window);
  audio.attachVisibility();

  try {
    // Конфиг и сессия — параллельно: это два независимых запроса,
    // и последовательное ожидание удлиняло бы старт вдвое.
    const [config, session] = await Promise.all([
      api.loadConfig(),
      api.openSession({ launchToken: params.get("token") })
    ]);
    setProgress(0.1, i18n.t("loadingAssets"));

    const loader = new Loader("assets/");
    loader.onProgress.add((p) => setProgress(0.1 + p * 0.75, i18n.t("loadingAssets")));
    const store = await loader.loadAll();

    setProgress(0.88, i18n.t("loadingAudio"));
    // Звук грузится, но не блокирует старт: играть можно и без него.
    audio.version = store.manifest.version || "";
    audio.load((p) => setProgress(0.88 + p * 0.12));

    // Уведомления от сервера. Игра работает и без них — это отдельный
    // канал, а не транспорт для ставок.
    // Тикет запрашивается заново перед каждым подключением: он одноразовый
    // и живёт секунды, поэтому в URL сокета нечего компрометировать.
    const socket = new GameSocket({
      url: params.get("ws") || null,
      getTicket: () => api.wsTicket()
    });
    socket.connect();

    // Мост с лобби оператора. Список origin задаётся параметром запуска;
    // "*" допустим только при локальной разработке.
    const lobbyOrigins = (params.get("lobby_origin") || "").split(",").filter(Boolean);
    const lobby = new LobbyBridge({
      allowedOrigins: lobbyOrigins.length ? lobbyOrigins : (location.hostname === "localhost" ? ["*"] : []),
      gameId: config.game?.id || "sochi-sunset"
    });

    const game = new Game({
      canvas: els.canvas,
      socket,
      lobby,
      container: els.container,
      store,
      audio,
      api,
      i18n,
      // RTP берётся из сертифицированной модели, а не из круглого числа:
      // именно эта цифра показывается игроку на заставке и в правилах.
      config: { ...config, rtp: 96.01 },
      session
    });

    setProgress(1, "");
    await new Promise((r) => setTimeout(r, 220));
    els.loader.classList.add("hidden");
    game.start();

    // Отдаём наружу для отладки и автотестов.
    window.__game = game;
    window.__gameReady = true;

    if (params.get("debug") === "1") attachDebugOverlay(game);
  } catch (err) {
    console.error(err);
    const message = err?.code === "DEMO_DISABLED"
      ? "Демо-режим отключён. Запустите игру через оператора."
      : `${i18n.t("genericError")}: ${err?.message || err}`;
    showError(message, i18n.t("retry"));
  }
}

/**
 * Панель диагностики по ?debug=1.
 *
 * Нужна прежде всего для разбора жалоб на «мигание» и рывки: показывает,
 * сколько раз в секунду реально идёт отрисовка, какой devicePixelRatio
 * выбран и не пересоздаётся ли холст (частая причина мерцания —
 * бесконечный цикл изменения размера).
 */
function attachDebugOverlay(game) {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:8px;top:8px;z-index:99;padding:8px 12px;
    background:rgba(0,0,0,.72);color:#8CFFB0;font:12px/1.5 monospace;
    border-radius:8px;pointer-events:none;white-space:pre`;
  document.body.appendChild(el);

  let renders = 0;
  let resizes = 0;
  const origRender = game.renderer.render.bind(game.renderer);
  game.renderer.render = () => { renders++; return origRender(); };
  game.renderer.onResize.add(() => resizes++);

  setInterval(() => {
    const r = game.renderer;
    el.textContent =
      `fps        ${Math.round(game.ticker.fps)}\n` +
      `отрисовок  ${renders}/с\n` +
      `resize     ${resizes}/с  ${resizes > 2 ? "← ЦИКЛ!" : ""}\n` +
      `dpr        ${r.dpr}  scale ${r.scale.toFixed(3)}\n` +
      `холст      ${r.canvas.width}×${r.canvas.height}\n` +
      `draw calls ${r.drawCalls}\n` +
      `текстур    ${r.textures.map.size}\n` +
      `состояние  ${game.state}`;
    renders = 0;
    resizes = 0;
  }, 1000);
}

boot();
