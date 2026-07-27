// Автомат раунда: простой → спин → показ → фриспины → простой, плюс ошибка.
//
// Здесь живёт ВЕСЬ цикл денежного раунда и больше ничего: ни сборки сцены,
// ни звука, ни лобби, ни клавиатуры. Всё, что происходит по ходу раунда,
// автомат объявляет сигналом, а кто на него подпишется — панель, звук или
// мост с лобби — его не касается. Раньше это был один класс на 945 строк
// с девятью несвязанными обязанностями, и любая правка в нём задевала
// остальные восемь.
//
// Автомат распоряжается барабанами и показом выигрыша напрямую: раунд —
// это и есть последовательность «крути → останови на этом экране → покажи»,
// и разрывать её сигналами значило бы прятать порядок действий.

import { StateMachine } from "../engine/fsm.js";
import { Signal, clamp } from "../engine/core.js";

export const RoundState = {
  IDLE: "idle",
  SPINNING: "spinning",
  PRESENTING: "presenting",
  FREESPINS: "freespins",
  ERROR: "error"
};

/**
 * Разрешённые переходы раунда, целиком и без подстановок.
 *
 * Читается как правила игры: из простоя можно уйти в спин или сразу
 * в фриспины (восстановление незакрытого бонуса после обрыва связи);
 * из показа выигрыша — либо в простой, либо в следующий спин, если игрок
 * нетерпелив; из ошибки — только назад в простой, и только после
 * пересинхронизации с сервером.
 */
const TRANSITIONS = {
  [RoundState.IDLE]: [RoundState.SPINNING, RoundState.FREESPINS, RoundState.ERROR],
  [RoundState.SPINNING]: [RoundState.PRESENTING, RoundState.FREESPINS, RoundState.IDLE, RoundState.ERROR],
  [RoundState.PRESENTING]: [RoundState.SPINNING, RoundState.IDLE, RoundState.ERROR],
  [RoundState.FREESPINS]: [RoundState.PRESENTING, RoundState.IDLE, RoundState.ERROR],
  [RoundState.ERROR]: [RoundState.IDLE]
};

/** Паузы между попытками достучаться до сервера после сбоя, секунды. */
const RESYNC_BACKOFF = [2, 4, 8, 16, 30];

/**
 * Сколько раз подряд можно пытаться доиграть незакрытый бонус.
 *
 * Восстановление устроено как цикл: сбой → /api/state → сервер отвечает
 * «раунд ещё бонусный» → продолжаем фриспины. Если фриспин падает каждый
 * раз, цикл не кончится сам. После этого предела игра возвращается
 * в простой; незакрытый раунд подхватится при следующем входе — это
 * штатный путь восстановления, тот же, что после закрытия вкладки.
 */
const MAX_RESUME_ATTEMPTS = 3;

export class RoundMachine {
  constructor({ api, config, mechanic, money, timeline, timings, grid, reels, presenter }) {
    this.api = api;
    this.config = config;
    this.mechanic = mechanic;
    this.money = money;
    this.timeline = timeline;
    // Паузы внутри раунда — это темп показа, а не правило игры: их задаёт
    // тема. Паузы переподключения (RESYNC_BACKOFF) остаются здесь —
    // они про сеть, и оформление на них не влияет.
    this.timings = timings;
    this.grid = grid;
    this.reels = reels;
    this.presenter = presenter;

    this.fsm = new StateMachine({
      name: "раунд",
      initial: RoundState.IDLE,
      transitions: TRANSITIONS
    });

    this.balance = 0;
    this.lastWin = 0;
    this.currentRound = null;
    this.turbo = false;
    this.freeMode = false;
    this.pendingRequestId = null;
    this._pendingBalance = null;
    this._resumeAttempts = 0;

    // Уровни ставок режутся лимитами оператора для этой валюты: 100 монет
    // в рублях и в иенах — совершенно разные деньги.
    this.betLevels = money.filterLevels(config.betLevels);
    const wanted = this.betLevels.indexOf(config.defaultBet);
    this.betIndex = wanted >= 0 ? wanted : Math.floor(this.betLevels.length / 3);

    this.onStateChange = new Signal();     // (state, previous)
    this.onBalance = new Signal();         // (balance, снаружи ли изменение)
    this.onBetChange = new Signal();       // (betCoins, betMoney)
    this.onSpinStart = new Signal();       // ({ bet, balance, free })
    this.onReelStop = new Signal();        // (index, { scatter })
    this.onWin = new Signal();             // ({ win, bet, total })
    this.onRoundEnd = new Signal();        // ({ bet, win, balance })
    this.onFeatureStart = new Signal();    // ({ spins })
    this.onFeatureProgress = new Signal(); // ({ left, total })
    this.onFeatureEnd = new Signal();      // ({ win, total, balance })
    this.onFreeMode = new Signal();        // (free)
    this.onRetrigger = new Signal();       // (count)
    this.onInsufficient = new Signal();    // ({ required, balance })
    this.onError = new Signal();           // ({ code, message, fatal })
    this.onDesync = new Signal();          // ({ expected, actual, screen })

    this.fsm.onChange.add((to, from) => this.onStateChange.emit(to, from));
  }

  get state() {
    return this.fsm.current;
  }

  _to(state) {
    return this.fsm.to(state);
  }

  /** Ставка в МОНЕТАХ — в этом виде она уходит на сервер. */
  get bet() {
    return this.betLevels[this.betIndex];
  }

  /** Та же ставка в деньгах игрока — в этом виде её видит игрок. */
  get betMoney() {
    return this.money.fromCoins(this.bet);
  }

  changeBet(direction) {
    const next = clamp(this.betIndex + direction, 0, this.betLevels.length - 1);
    if (next === this.betIndex) return;
    this.betIndex = next;
    this.onBetChange.emit(this.bet, this.betMoney);
  }

  /* ──────────────────────────── запуск ──────────────────────────── */

  /**
   * Начальное состояние из ответа /api/session.
   * Незакрытый бонусный раунд обязан быть доигран: ставка за него уже снята.
   */
  async start(session) {
    this.balance = session.balance;
    this.onBalance.emit(this.balance);

    if (session.resume) {
      await this.resume(session.resume);
    } else {
      // Первый экран не должен быть пустым: раскладываем случайную картинку.
      this.reels.setVisibleScreen(this.randomScreen());
    }
  }

  async resume(resume) {
    this.currentRound = resume;
    const last = resume.spins[resume.spins.length - 1];
    if (last?.screen) this.reels.setVisibleScreen(last.screen);

    if (resume.state === "free" && resume.freeSpins.left > 0) {
      // Восстановленный бонус объявляется иначе, чем выигранный: баннера
      // не было, и игрок обязан понять, почему барабаны крутятся сами.
      await this._enterFreeMode(true);
      this.onFeatureProgress.emit({ left: resume.freeSpins.left, total: resume.freeSpins.total });
      this._runFreeSpins(resume);
    }
  }

  /** Случайное поле для первого показа — реальных денег за ним нет. */
  randomScreen() {
    const ids = this.config.symbolKeys
      .map((_, i) => i)
      .filter((i) => i !== this.config.wild);
    return Array.from({ length: this.config.rows }, () =>
      Array.from({ length: this.config.reels }, () => ids[Math.floor(Math.random() * ids.length)])
    );
  }

  /* ─────────────────────────── цикл раунда ──────────────────────── */

  /** «Стоп» не отменяет спин — результат уже определён сервером. */
  stop() {
    this.reels.hurry();
  }

  async spin() {
    if (this.state === RoundState.PRESENTING) {
      // Нетерпеливый игрок: прерываем показ и сразу крутим дальше.
      this.presenter.clear();
      this._to(RoundState.IDLE);
    }
    if (this.state !== RoundState.IDLE) return;

    if (this.betMoney > this.balance) {
      this.onInsufficient.emit({ required: this.betMoney, balance: this.balance });
      return;
    }

    this._to(RoundState.SPINNING);
    this.presenter.clear();
    this.lastWin = 0;
    this.onSpinStart.emit({ bet: this.bet, balance: this.balance, free: false });
    this.reels.startSpin({ turbo: this.turbo });

    let result;
    try {
      // requestId сохраняется: если ответ потеряется, повтор вернёт
      // тот же раунд, а не спишет ставку второй раз.
      this.pendingRequestId = this.pendingRequestId || crypto.randomUUID();
      result = await this.api.spin(this.bet, this.pendingRequestId);
      this.pendingRequestId = null;
    } catch (err) {
      // При обрыве сети requestId НЕ сбрасывается: спин мог дойти до сервера,
      // и повтор с тем же ключом вернёт уже сыгранный раунд вместо
      // повторного списания ставки.
      if (err.code !== "NETWORK") this.pendingRequestId = null;
      return this._handleError(err);
    }

    this.balance = result.balance;
    this.currentRound = result;
    this._resumeAttempts = 0;

    const spin = result.spins[0];
    await this._spinReels(spin);
    this.onBalance.emit(this.balance);
    this._verify(spin, result.bet);

    if (result.state === "free") {
      await this._startFreeSpins(result);
    } else {
      await this._finishBaseSpin(result, spin);
    }
  }

  /** Прокрутка и остановка барабанов под конкретный результат. */
  async _spinReels(spin) {
    await this.reels.stopAll(spin.screen, {
      turbo: this.turbo,
      anticipationReels: this._anticipationReels(spin.screen),
      onReelStop: (index) => {
        this.onReelStop.emit(index, {
          scatter: this.grid.columnHas(spin.screen, index, this.config.scatter)
        });
      }
    });
  }

  /**
   * Барабаны, которые стоит «потомить».
   * Если на уже остановившихся барабанах не хватает одного скаттера до
   * бонуса, следующий барабан решает его судьбу — именно этот момент
   * и нужно растянуть.
   */
  _anticipationReels(screen) {
    const need = this.config.freespins.triggerScatters;
    const result = [];
    let count = 0;
    for (let reel = 0; reel < this.config.reels; reel++) {
      if (count >= need - 1) result.push(reel);
      for (let row = 0; row < this.config.rows; row++) {
        if (screen[row][reel] === this.config.scatter) count++;
      }
    }
    return result.slice(0, 2);
  }

  async _finishBaseSpin(result, spin) {
    if (result.totalWin > 0) {
      this._to(RoundState.PRESENTING);
      this.lastWin = result.totalWin;
      this.onWin.emit({ win: result.totalWin, bet: result.bet, total: result.totalWin });
      await this.presenter.present(spin.wins, {
        bet: result.bet,
        totalWin: result.totalWin,
        cascades: spin.cascades
      });
    }

    this._applyPendingBalance();
    this._to(RoundState.IDLE);
    this.onRoundEnd.emit({ bet: result.bet, win: result.totalWin, balance: this.balance });
  }

  /** Применяет баланс, пришедший по сокету во время спина. */
  _applyPendingBalance() {
    if (this._pendingBalance == null) return;
    this.balance = this._pendingBalance;
    this._pendingBalance = null;
    this.onBalance.emit(this.balance, true);
  }

  /**
   * Баланс мог измениться вне игры — например, депозитом в соседней вкладке.
   * В простое подхватываем сразу; во время спина ждём его окончания, иначе
   * счётчик прыгнет посреди показа.
   */
  applyExternalBalance(balance) {
    if (this.state === RoundState.IDLE) {
      this.balance = balance;
      this.onBalance.emit(balance, true);
    } else {
      this._pendingBalance = balance;
    }
  }

  /* ─────────────────────────── фриспины ─────────────────────────── */

  async _startFreeSpins(result) {
    const spin = result.spins[0];

    // Скаттеры подсвечиваются до объявления бонуса — игрок должен увидеть,
    // за что именно ему дали фриспины.
    const scatterWin = spin.wins.find((w) => w.type === "scatter");
    if (scatterWin) {
      this.reels.showWinningCells(scatterWin.positions, { dim: true });
      await this.timeline.wait(this.timings.scatterHold);
    }

    if (result.totalWin > 0) {
      this.onWin.emit({ win: result.totalWin, bet: result.bet, total: result.totalWin, silent: true });
    }

    this.onFeatureStart.emit({ spins: result.freeSpins.total });
    await this.presenter.announceFreeSpins(result.freeSpins.total);
    await this._enterFreeMode();
    this._runFreeSpins(result);
  }

  async _enterFreeMode(resumed = false) {
    if (this.freeMode) return;
    this.freeMode = true;
    this.onFreeMode.emit(true, resumed);
  }

  async _exitFreeMode() {
    if (!this.freeMode) return;
    this.freeMode = false;
    this.onFreeMode.emit(false);
  }

  /** Последовательность фриспинов: спины идут сами, без участия игрока. */
  async _runFreeSpins(round) {
    this._to(RoundState.FREESPINS);

    const t = this.timings;
    let current = round;
    // Ограничитель на случай, если сервер перестанет закрывать бонус:
    // бесконечный цикл спинов на настоящие деньги хуже отказа.
    let guard = 0;

    while (current.state === "free" && guard++ < 500) {
      this.onFeatureProgress.emit({
        left: current.freeSpins.left,
        total: current.freeSpins.total
      });
      await this.timeline.wait(this.turbo ? t.freeSpinGapTurbo : t.freeSpinGap);

      this.presenter.clear();
      this.onSpinStart.emit({ bet: current.bet, balance: this.balance, free: true });
      this.reels.startSpin({ turbo: this.turbo });

      let next;
      try {
        next = await this.api.freeSpin(current.roundId, crypto.randomUUID());
        this._resumeAttempts = 0;
      } catch (err) {
        return this._handleError(err);
      }

      const spin = next.spins[0];
      await this._spinReels(spin);

      this.balance = next.balance;
      this.onBalance.emit(this.balance);

      if (spin.retrigger > 0) this.onRetrigger.emit(spin.retrigger);

      if (spin.win > 0) {
        this.onWin.emit({ win: spin.win, bet: next.bet, total: next.freeSpins.win });
        await this.presenter.present(spin.wins, {
          bet: next.bet,
          totalWin: spin.win,
          cascades: spin.cascades,
          skipCycle: true
        });
        await this.timeline.wait(this.turbo ? t.freeSpinAfterWinTurbo : t.freeSpinAfterWin);
      }

      current = { ...next, roundId: current.roundId };
      this.currentRound = current;
    }

    if (current.freeSpins.win > 0) {
      await this.presenter.announceBonusTotal(current.freeSpins.win);
    }
    await this._exitFreeMode();

    this.onFeatureEnd.emit({
      win: current.freeSpins.win, total: current.totalWin, balance: this.balance
    });
    this._to(RoundState.IDLE);
    this.onRoundEnd.emit({
      bet: current.bet, win: current.totalWin, balance: this.balance, afterFeature: true
    });
  }

  /* ────────────────────── сверка с математикой ──────────────────── */

  /**
   * Клиентская механика считает тот же экран и обязана сойтись с сервером.
   *
   * Деньги отсюда не берутся: расхождение означает, что игроку ПОКАЗАЛИ
   * не то, за что заплатили, — и это должно быть видно в логе, а не
   * всплыть через месяц в жалобе. Спины с множителями диких пропускаются:
   * множитель разыгрывает сервер, воспроизвести его клиент не может.
   */
  _verify(spin, bet) {
    if (!this.mechanic.evaluate) return;
    const expected = spin.win ?? spin.totalWin ?? 0;
    if ((spin.wins || []).some((w) => w.multiplier > 1)) return;

    let actual;
    try {
      actual = this.mechanic.evaluate(spin.screen, bet, this.config).total;
    } catch (err) {
      console.warn("Механика не смогла посчитать экран", err);
      return;
    }
    if (Math.abs(actual - expected) < 0.005) return;

    console.warn(
      `Расхождение показа с сервером: механика ${actual}, сервер ${expected}`, spin.screen);
    this.onDesync.emit({ expected, actual, screen: spin.screen });
  }

  /* ──────────────────────────── ошибки ──────────────────────────── */

  async _handleError(err) {
    const fatal = err.code === "SESSION_EXPIRED" || err.code === "NO_SESSION";
    if (this.state === RoundState.FREESPINS) this._resumeAttempts++;
    this.onError.emit({ code: err.code, message: err.message, fatal });

    // Сессия истекла — единственный корректный выход это перезапуск,
    // и решает его тот, кто владеет страницей, а не автомат раунда.
    if (fatal) {
      this._to(RoundState.ERROR);
      return;
    }

    // Барабаны докручиваем до нейтральной картинки, чтобы игра
    // не осталась «зависшей» в движении.
    this.reels.hurry();
    const screen = this.currentRound?.spins?.[0]?.screen || this.randomScreen();
    await this.reels.stopAll(screen, { turbo: true });

    await this._resync();
  }

  /**
   * Пересинхронизация с сервером после сбоя.
   *
   * Здесь чинится баг, из-за которого обрыв связи во фриспинах оставлял
   * игру в бонусном режиме НАВСЕГДА: локальный флаг freeMode так и стоял,
   * фон и музыка оставались бонусными, а сервер об этом раунде давно забыл.
   * Режим — это состояние сервера, поэтому он и восстанавливается из
   * /api/state, а не из того, что игра помнит о себе сама.
   */
  async _resync() {
    for (let attempt = 0; attempt <= RESYNC_BACKOFF.length; attempt++) {
      let state;
      try {
        state = await this.api.getState();
      } catch {
        // Связи по-прежнему нет. Ждём и пробуем снова — но не бесконечно:
        // висеть в неопределённости хуже, чем вернуться в простой.
        if (attempt < RESYNC_BACKOFF.length) {
          await this.timeline.wait(RESYNC_BACKOFF[attempt]);
          continue;
        }
        break;
      }

      this.balance = state.balance;
      this.onBalance.emit(this.balance);

      const canResume = state.resume?.state === "free"
        && state.resume.freeSpins.left > 0
        && this._resumeAttempts <= MAX_RESUME_ATTEMPTS;
      if (!canResume) await this._exitFreeMode();
      this._to(RoundState.IDLE);
      if (canResume) await this.resume(state.resume);
      return true;
    }

    // Достучаться не удалось. Из бонусного режима всё равно выходим:
    // доиграть его сейчас нельзя, а оставлять игрока в бонусной оболочке
    // без фриспинов — та самая ошибка, ради которой этот метод и написан.
    await this._exitFreeMode();
    this._to(RoundState.IDLE);
    return false;
  }
}
