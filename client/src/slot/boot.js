// Подъём слота: конфиг, сессия, ассеты, звук, сеть — и сборка игры.
//
// Всё это одинаково для любой темы и для любой игры на этом слоте, поэтому
// живёт здесь, а не в точке входа. main.js остаётся тем, чем и должен быть:
// выбором темы и связью с разметкой страницы.
//
// Порядок здесь не случайный и переставлять его нельзя:
//   конфиг и сессия параллельно → ассеты → проверка темы → звук → сцена.
// Тема проверяется ПОСЛЕ загрузки ассетов и ДО сборки сцены — только в этой
// точке видно и то, чего не хватает в теме, и то, чего не хватает в атласе.

import { Loader } from "../engine/loader.js";
import { AudioManager } from "../audio/audio.js";
import { GameApi } from "./net/api.js";
import { GameSocket } from "./net/socket.js";
import { LobbyBridge } from "./net/lobby.js";
import { SlotGame } from "./game.js";
import { validateTheme } from "./theme/validate.js";

/**
 * @param opts.theme      тема игры
 * @param opts.i18n       локализация: её заводит точка входа, потому что
 *                        сообщение об ошибке нужно и тогда, когда подъём
 *                        не дошёл даже до конфига
 * @param opts.onProgress (доля, подпись) — экран загрузки
 * @returns собранная, но ещё не запущенная игра
 */
export async function bootSlot({ theme, i18n, canvas, container, onProgress = () => {} }) {
  const params = new URLSearchParams(location.search);

  onProgress(0.02, i18n.t("loadingConnect"));

  // Адрес API — относительный, из того же origin, откуда загружена игра.
  // Брать его из ?api= нельзя: ссылка на запуск приходит игроку от кого
  // угодно, а ?api=//злой.хост уводит туда launch-токен оператора вместе
  // со всей сессией. Параметр остаётся только для стенда разработчика.
  // Флаг ?mock=1 явно переключает в мок-режим (автономный клиентский RGS).
  const devHost = location.hostname === "localhost";
  const isStaticHost = location.hostname.endsWith("github.io") || location.protocol === "file:";
  const forceMock = params.get("mock") === "1" || params.get("mock") === "true" || isStaticHost;
  const api = new GameApi({
    baseUrl: devHost ? (params.get("api") || "") : "",
    forceMock
  });

  const audio = new AudioManager({ enabled: localStorage.getItem(`${theme.id}.muted`) !== "1" });
  audio.attachUnlock(window);
  audio.attachVisibility();

  // Конфиг и сессия — параллельно: это два независимых запроса,
  // и последовательное ожидание удлиняло бы старт вдвое.
  const [config, session] = await Promise.all([
    api.loadConfig(),
    api.openSession({ launchToken: params.get("token") })
  ]);
  onProgress(0.1, i18n.t("loadingAssets"));

  // Начертания перечисляет тема: список гарнитур — часть оформления,
  // и движок про Poppins знать не обязан.
  const assetBase = params.get("assets") || (location.pathname.includes("/client/") ? "assets/" : "client/assets/");
  const loader = new Loader(assetBase, { fonts: theme.fonts.preload });
  loader.onProgress.add((p) => onProgress(0.1 + p * 0.75, i18n.t("loadingAssets")));
  const store = await loader.loadAll();

  // Полнота темы проверяется до сборки сцены и разом: недостающий кадр
  // иначе всплывает посреди спина, а не на запуске.
  validateTheme(theme, store);

  onProgress(0.88, i18n.t("loadingAudio"));
  // Звук грузится, но не блокирует старт: играть можно и без него.
  audio.version = store.manifest.version || "";
  audio.load((p) => onProgress(0.88 + p * 0.12));

  // Уведомления от сервера. Игра работает и без них — это отдельный
  // канал, а не транспорт для ставок.
  // Тикет запрашивается заново перед каждым подключением: он одноразовый
  // и живёт секунды, поэтому в URL сокета нечего компрометировать.
  const socket = new GameSocket({
    // Тот же запрет, что и на ?api=: чужой адрес сокета — это чужой
    // сервер, которому уходят тикеты и события сессии.
    url: devHost ? params.get("ws") : null,
    getTicket: () => api.wsTicket()
  });
  socket.connect();

  // Мост с лобби оператора. Список origin приходит с сервера в /api/config:
  // из URL его брать нельзя — ?lobby_origin=https://злой.хост заставил бы
  // игру саму отправить туда события раунда и данные сессии.
  const lobby = new LobbyBridge({
    allowedOrigins: resolveLobbyOrigins(config.lobby?.origins, devHost ? params : null),
    gameId: config.game?.id || theme.id
  });

  const game = new SlotGame({
    canvas, container, socket, lobby, store, audio, api, i18n, theme, config, session
  });

  onProgress(1, "");
  return game;
}

/**
 * Кому игра вправе слать postMessage.
 *
 * Сервер отдаёт список в терминах CSP, где 'self' означает собственный
 * домен игры; в postMessage такого значения нет, поэтому оно разворачивается
 * в конкретный origin. Параметр URL принимается только на стенде
 * разработчика — там lobby-demo.html открывает игру с произвольного порта,
 * и списка на сервере для него нет.
 */
function resolveLobbyOrigins(fromServer, devParams) {
  const fromUrl = devParams?.get("lobby_origin");
  const raw = fromUrl ? fromUrl.split(",") : (fromServer || []);
  const out = [];
  for (const item of raw.map((s) => s.trim()).filter(Boolean)) {
    if (item === "'self'" || item === "self") out.push(location.origin);
    else if (item === "*") { if (devParams) out.push("*"); }
    else out.push(item);
  }
  return out;
}
