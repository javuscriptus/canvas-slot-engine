// Точка входа: выбрать тему, поднять слот, показать ошибку, если не вышло.
//
// Всё, что знает эта страница о конкретной игре, — какие темы существуют.
// Сборка слота живёт в slot/boot.js, диагностика — в engine/debug.js.

import { bootSlot } from "./slot/boot.js";
import { I18n } from "./slot/i18n.js";
import { attachDebugOverlay } from "./engine/debug.js";

/** Темы грузятся по требованию: вторая игроку первой не нужна. */
const THEMES = {
  sochi: () => import("./themes/sochi/theme.js"),
  neon: () => import("./themes/neon/theme.js")
};

const el = (id) => document.getElementById(id);
const els = {
  container: el("game-container"), canvas: el("game-canvas"), loader: el("loader"),
  progressFill: el("progress-fill"), status: el("loader-status"),
  error: el("error-screen"), errorText: el("error-text"), errorRetry: el("error-retry")
};

function setProgress(value, label) {
  els.progressFill.style.width = `${Math.round(value * 100)}%`;
  if (label) els.status.textContent = label;
}

async function boot() {
  const params = new URLSearchParams(location.search);
  let i18n = null;
  try {
    const theme = (await (THEMES[params.get("theme")] || THEMES.sochi)()).default;
    i18n = new I18n(I18n.detect(theme.strings), {
      strings: theme.strings, symbols: theme.symbols
    });
    document.documentElement.lang = i18n.lang;

    const game = await bootSlot({
      theme, i18n, canvas: els.canvas, container: els.container, onProgress: setProgress
    });

    // Пауза перед снятием экрана загрузки: без неё первый кадр приходит
    // одновременно с исчезновением полосы, и переход читается как рывок.
    await new Promise((r) => setTimeout(r, 220));
    els.loader.classList.add("hidden");
    game.start();

    window.__game = game;          // наружу для отладки и автотестов
    window.__gameReady = true;

    if (params.get("debug") === "1") {
      attachDebugOverlay({
        renderer: game.renderer, ticker: game.ticker, status: () => game.state
      });
    }
  } catch (err) {
    console.error(err);
    els.loader.classList.add("hidden");
    els.error.classList.remove("hidden");
    els.errorText.textContent = err?.code === "DEMO_DISABLED"
      ? "Демо-режим отключён. Запустите игру через оператора."
      : `${i18n?.t("genericError") || "Что-то пошло не так"}: ${err?.message || err}`;
    els.errorRetry.textContent = i18n?.t("retry") || "…";
    els.errorRetry.onclick = () => location.reload();
  }
}

boot();
