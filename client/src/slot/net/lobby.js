// Мост между игрой и лобби оператора через postMessage.
//
// Игра поставляется как отдельная страница внутри iframe в лобби — это
// стандартный способ доставки контента: у оператора своя авторизация,
// свой кошелёк и своя оболочка, а игра остаётся изолированной.
//
// Из этой изоляции следует единственный способ общения — postMessage.
// Через него лобби узнаёт о ходе раунда (чтобы блокировать выход из игры
// посреди спина или показывать свой счётчик баланса) и управляет игрой
// (пауза при показе своего модального окна, звук, принудительный выход).
//
// Origin проверяется в обе стороны: приём сообщений от произвольного
// окна в игре, которая ходит в кошелёк, недопустим.

import { Signal } from "../../engine/core.js";

const PROTOCOL = "rgs-game";
const VERSION = 1;

export class LobbyBridge {
  /**
   * @param {object} opts
   *   allowedOrigins — список origin лобби. Приходит с сервера в /api/config;
   *                    из параметров URL его брать нельзя — тогда любой,
   *                    кто прислал игроку ссылку, назначает себя лобби
   *                    и получает события сессии. "*" отключает проверку
   *                    и допустим только на стенде разработчика.
   *   gameId         — идентификатор игры в сообщениях
   */
  constructor({ allowedOrigins = [], gameId = "game" } = {}) {
    // Пустой список означает «ни с кем не разговариваем»: неизвестный
    // адресат хуже отсутствующего.
    this.allowed = (Array.isArray(allowedOrigins) ? allowedOrigins : [])
      .map((o) => String(o).trim())
      .filter(Boolean);
    this.gameId = gameId;
    this.onCommand = new Signal();      // (command, payload)

    // Если игра открыта напрямую, а не в iframe, мост просто молчит.
    this.embedded = window.parent && window.parent !== window;

    this._onMessage = this._onMessage.bind(this);
    window.addEventListener("message", this._onMessage);
  }

  _originAllowed(origin) {
    if (this.allowed.includes("*")) return true;
    return this.allowed.includes(origin);
  }

  _onMessage(event) {
    if (!this._originAllowed(event.origin)) return;
    const msg = event.data;
    if (!msg || msg.protocol !== PROTOCOL || !msg.command) return;
    this.onCommand.emit(msg.command, msg.payload || {});
  }

  /** Отправляет событие в лобби. Молча ничего не делает вне iframe. */
  emit(event, payload = {}) {
    if (!this.embedded) return;
    const message = {
      protocol: PROTOCOL,
      version: VERSION,
      gameId: this.gameId,
      event,
      payload,
      ts: Date.now()
    };
    // Конкретный origin предпочтительнее "*": так сообщение не утечёт,
    // если игру встроят в чужую страницу. Отправка в "*" остаётся только
    // для стенда разработчика, где список origin заведомо не настроен.
    const targets = this.allowed.filter((o) => o !== "*");
    if (targets.length) {
      for (const origin of targets) {
        try { window.parent.postMessage(message, origin); } catch { /* origin недоступен */ }
      }
    } else if (this.allowed.includes("*")) {
      window.parent.postMessage(message, "*");
    }
  }

  destroy() {
    window.removeEventListener("message", this._onMessage);
  }
}

/** События, которые игра отправляет в лобби. */
export const GameEvent = {
  LOADED: "game.loaded",           // игра готова к взаимодействию
  ROUND_START: "round.start",      // ставка списана, барабаны крутятся
  ROUND_END: "round.end",          // раунд закрыт, выигрыш зачислен
  BALANCE: "balance.update",
  FEATURE_START: "feature.start",  // начались фриспины
  FEATURE_END: "feature.end",
  BIG_WIN: "win.big",
  ERROR: "game.error",
  EXIT: "lobby.exit",              // игрок нажал «в лобби»
  CASHIER: "lobby.cashier"         // не хватает средств — открыть кассу
};

/** Команды, которые лобби отправляет игре. */
export const LobbyCommand = {
  PAUSE: "pause",
  RESUME: "resume",
  MUTE: "mute",
  UNMUTE: "unmute",
  SET_VOLUME: "volume",
  REALITY_CHECK: "reality-check",   // показать напоминание о времени в игре
  CLOSE: "close"                    // мягко завершить сессию
};
