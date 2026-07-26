// Оркестратор игры: сборка сцены, конечный автомат раунда, автоигра,
// фриспины, обработка ошибок и смена ориентации.

import { Container, Sprite, Text, Custom } from "../engine/display.js";
import { Renderer, ViewportManager } from "../engine/renderer.js";
import { Ticker, Easing, formatMoney, clamp } from "../engine/core.js";
import { TweenManager } from "../engine/tween.js";
import { InputManager } from "../engine/input.js";

import { LAYOUTS, buildLayout, gridMetrics } from "./layout.js";
import { ReelSet, SymbolTextures } from "./reels.js";
import { WinPresenter, winTier } from "./winPresenter.js";
import { ControlPanel, FreeSpinBadge } from "./ui.js";
import { PaytableModal, AutoplayModal, HistoryModal, Toast } from "./overlays.js";
import { BackgroundLayer } from "./background.js";
import { ParticleSystem, drawParticles } from "../engine/particles.js";
import { ApiError } from "./api.js";
import { GameSocket } from "./socket.js";
import { LobbyBridge, GameEvent, LobbyCommand } from "./lobby.js";
import { Money } from "./money.js";
import { StartScreen } from "./startScreen.js";

const STATE = {
  IDLE: "idle",
  SPINNING: "spinning",
  PRESENTING: "presenting",
  FREESPINS: "freespins",
  ERROR: "error"
};

export class Game {
  constructor({ canvas, container, store, audio, api, i18n, config, session, socket, lobby }) {
    this.store = store;
    this.audio = audio;
    this.api = api;
    this.i18n = i18n;
    this.config = config;
    this.session = session;

    // Валюта приходит из сессии: её задаёт кошелёк оператора, а не игра.
    // Всё, что видит игрок, форматируется через этот объект.
    this.money = new Money(session.currency || { code: session.player?.currency }, i18n.lang);

    this.state = STATE.IDLE;
    this.balance = session.balance;
    // Уровни ставок режутся лимитами оператора для этой валюты: 100 монет
    // в рублях и в иенах — совершенно разные деньги.
    this.betLevels = this.money.filterLevels(config.betLevels);
    const wanted = this.betLevels.indexOf(config.defaultBet);
    this.betIndex = wanted >= 0 ? wanted : Math.floor(this.betLevels.length / 3);
    this.turbo = localStorage.getItem("sochi.turbo") === "1";
    this.autoplayLeft = 0;
    this.autoplayStopOnFeature = true;
    this.lastWin = 0;
    this.freeMode = false;
    this.currentRound = null;
    this.pendingRequestId = null;

    // Тряска камеры: применяется к корню сцены, поэтому трясётся всё
    // сразу и без пересчёта раскладки.
    this._shake = { amp: 0, time: 0, duration: 0 };
    this._ambientTimer = 0;
    // Первая чайка не сразу: на старте у игрока и так шумно от загрузки.
    this._seaTimer = 9 + Math.random() * 10;

    /* ── движок ─────────────────────────────────────────────────── */
    this.renderer = new Renderer(canvas, {
      designWidth: LAYOUTS.landscape.width,
      designHeight: LAYOUTS.landscape.height,
      backgroundColor: "#07020F"
    });
    this.backgroundLayer = new BackgroundLayer(store);
    this.ticker = new Ticker();
    this.tweens = new TweenManager();
    this.input = new InputManager(this.renderer);

    this.viewport = new ViewportManager(this.renderer, {
      build: (vw, vh) => buildLayout(vw, vh),
      container
    });

    this.layout = LAYOUTS.landscape;
    this.metrics = gridMetrics(this.layout, config.reels, config.rows);

    this._buildScene();

    this.viewport.onOrientationChange.add((orientation, layout) => this._applyLayout(layout));

    // Текстуры символов и фон зависят от итогового размера на экране.
    // Пересборка отложена: во время перетаскивания границы окна событий
    // приходят десятки, а собирать два десятка текстур каждый раз — рывок.
    this.renderer.onResize.add(() => {
      this.backgroundLayer.resize(this.renderer.canvas.width, this.renderer.canvas.height);
      clearTimeout(this._texTimer);
      this._texTimer = setTimeout(() => this._rebuildTextures(), 140);
    });

    this.viewport.apply();
    this._rebuildTextures();

    this.ticker.onTick.add((dt) => this._update(dt));
    this._bindKeyboard();

    // Полный экран можно выйти клавишей Esc или жестом системы —
    // значок обязан это отражать, иначе он врёт о состоянии.
    for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) {
      document.addEventListener(ev, () => {
        this.panel.setFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
      });
    }

    this.api.onConnectionChange = (online) => {
      this.toast.show(online ? i18n.t("connectionRestored") : i18n.t("connectionLost"), online ? 2 : 6);
    };

    this.socket = socket || null;
    this.lobby = lobby || null;
    this._paused = false;
    this._bindSocket();
    this._bindLobby();
  }

  /* ───────────────── канал уведомлений от сервера ───────────────── */

  _bindSocket() {
    if (!this.socket) return;

    this.socket.onEvent.add((type, msg) => {
      switch (type) {
        case "balance":
          // Баланс мог измениться вне игры — например, депозитом в
          // соседней вкладке. В простое подхватываем сразу; во время
          // спина ждём его окончания, иначе счётчик прыгнет посреди показа.
          if (this.state === STATE.IDLE) {
            this.balance = msg.balance;
            this.panel.balanceMeter.setValue(msg.balance);
          } else {
            this._pendingBalance = msg.balance;
          }
          break;

        case "session.closed":
          this.stopAutoplay();
          this.toast.show(this.i18n.t("sessionClosed"), 8);
          this.state = STATE.ERROR;
          this.panel.setSpinning(false);
          this.lobby?.emit(GameEvent.ERROR, { code: "SESSION_CLOSED" });
          break;

        case "maintenance":
          this.stopAutoplay();
          this.toast.show(msg.message || this.i18n.t("maintenance"), 10);
          break;

        case "reality-check":
          this.stopAutoplay();
          this.toast.show(msg.message || this.i18n.t("realityCheck"), 8);
          break;

        case "promo":
          if (msg.message) this.toast.show(msg.message, 6);
          break;
      }
    });
  }

  /* ─────────────────────── связь с лобби ────────────────────────── */

  _bindLobby() {
    if (!this.lobby) return;

    this.lobby.onCommand.add((command, payload) => {
      switch (command) {
        case LobbyCommand.PAUSE:
          this.setPaused(true);
          break;
        case LobbyCommand.RESUME:
          this.setPaused(false);
          break;
        case LobbyCommand.MUTE:
          this.audio.setMuted(true);
          this.panel.setSoundOn(false);
          break;
        case LobbyCommand.UNMUTE:
          this.audio.setMuted(false);
          this.panel.setSoundOn(true);
          this.audio.playMusic(this.freeMode ? "music_free" : "music_base");
          break;
        case LobbyCommand.SET_VOLUME:
          if (typeof payload.value === "number") this.audio.setVolume("master", payload.value);
          break;
        case LobbyCommand.REALITY_CHECK:
          this.stopAutoplay();
          this.toast.show(payload.message || this.i18n.t("realityCheck"), 8);
          break;
        case LobbyCommand.CLOSE:
          this.stopAutoplay();
          this.audio.stopMusic();
          break;
      }
    });

    this.lobby.emit(GameEvent.LOADED, {
      currency: this.money.code,
      balance: this.balance,
      betLevels: this.betLevels.map((c) => this.money.fromCoins(c))
    });
  }

  /**
   * Пауза по команде лобби: оно показывает своё модальное окно.
   * Автоигра останавливается, но текущий раунд не прерывается —
   * ставка уже списана, и он обязан быть доигран.
   */
  setPaused(paused) {
    if (this._paused === paused) return;
    this._paused = paused;
    this.input.enabled = !paused;
    if (paused) {
      this.stopAutoplay();
      this.audio.setMuted(true);
    } else if (localStorage.getItem("sochi.muted") !== "1") {
      this.audio.setMuted(false);
    }
  }

  /* ─────────────────────────── сборка сцены ─────────────────────── */

  _buildScene() {
    const { store, audio, i18n, config } = this;
    const stage = this.renderer.stage;

    this.frame = new Sprite(store.frame("reel_frame"), 2);
    this.logo = new Sprite(store.frame("logo"), 2);
    this.logo.setAnchor(0.5);

    const symbolIds = config.symbolKeys.map((_, i) => i);
    this.symbolTextures = new SymbolTextures(store, symbolIds, this.layout.cell);

    this.reelSet = new ReelSet({
      textures: this.symbolTextures,
      store,
      metrics: this.metrics,
      reels: config.reels,
      symbolPool: symbolIds.filter((id) => id !== config.wild)   // дикий не сыплется в холостую
    });

    this.winPresenter = new WinPresenter({
      store, audio, i18n, money: this.money,
      tweens: this.tweens,
      metrics: this.metrics,
      paylines: config.paylines,
      reelSet: this.reelSet,
      layout: this.layout,
      onShake: (amp, dur) => this.shake(amp, dur)
    });

    this.freeSpinBadge = new FreeSpinBadge(store, i18n);

    this.panel = new ControlPanel({
      store, audio, i18n, config, money: this.money,
      callbacks: {
        onSpin: () => this.requestSpin(),
        onStop: () => this.requestStop(),
        onBetChange: (d) => this.changeBet(d),
        onToggleTurbo: () => this.toggleTurbo(),
        onAutoplay: () => this.toggleAutoplay(),
        onToggleSound: () => this.toggleSound(),
        onInfo: () => this.paytable.show(),
        onHistory: () => this.showHistory(),
        onToggleFullscreen: () => this.toggleFullscreen(),
        onMenu: () => this.paytable.show()
      }
    });

    const rtp = (config.rtp ?? 96.0).toFixed(2);
    this.paytable = new PaytableModal({ store, audio, i18n, layout: this.layout, config, rtp, money: this.money });
    this.autoplayModal = new AutoplayModal({
      store, audio, i18n, layout: this.layout, config, money: this.money,
      getBet: () => this.betMoney,
      onStart: (n, limits) => this.startAutoplay(n, limits)
    });
    this.historyModal = new HistoryModal({
      store, audio, i18n, layout: this.layout, config, money: this.money,
      onOpenRound: (id) => this.showRoundDetail(id)
    });
    this.toast = new Toast({ store, layout: this.layout });

    // Заставка живёт поверх всей сцены и перехватывает нажатия,
    // пока игрок не нажмёт «Играть».
    this.startScreen = new StartScreen({
      store, audio, i18n, layout: this.layout, config,
      rtp: (config.rtp ?? 96.0).toFixed(2),
      money: this.money,
      onPlay: () => this._leaveIntro()
    });
    this.startScreen.visible = StartScreen.shouldShow();

    // Фон выводится первым узлом, одним копированием без масштабирования.
    this.backgroundNode = new Custom((ctx) => this.backgroundLayer.blit(ctx),
      this.layout.width, this.layout.height);

    // Тряска применяется только к игровому полю. Трясти вместе с ним
    // панель управления, счётчики и фон — верный способ сделать
    // интерфейс дешёвым: настоящие автоматы дрожат барабанами,
    // а корпус стоит на месте.
    this.shakeGroup = new Container();

    // Золотая пыль, медленно плывущая над сценой: дешёвый слой,
    // который убирает ощущение статичной картинки в простое.
    this.ambient = new ParticleSystem(90);
    this.ambientView = new Custom((ctx) => drawParticles(ctx, this.ambient),
      this.layout.width, this.layout.height);

    this.shakeGroup.add(this.frame, this.reelSet, this.winPresenter);

    stage.add(
      this.backgroundNode,
      this.ambientView,
      this.shakeGroup,
      this.logo, this.freeSpinBadge,
      this.panel,
      this.paytable, this.autoplayModal, this.historyModal,
      this.toast,
      this.startScreen
    );

    this.panel.balanceMeter.setValue(this.balance, true);
    this.panel.betMeter.setValue(this.bet, true);
    this.panel.winMeter.setValue(0, true);
    this.panel.setTurbo(this.turbo);
    this.panel.setSoundOn(!audio.muted);
  }

  _applyLayout(layout) {
    this.layout = layout;
    this.metrics = gridMetrics(layout, this.config.reels, this.config.rows);

    this.backgroundLayer.setThemes(layout.background, layout.backgroundFree);
    this.backgroundLayer.resize(this.renderer.canvas.width, this.renderer.canvas.height);

    const f = this.metrics.frame;
    this.frame.setSize(f.width, f.height).setPosition(f.x, f.y);

    this.logo.setPosition(layout.logo.x, layout.logo.y);
    this.logo.scaleX = this.logo.scaleY = layout.logo.scale;

    this.freeSpinBadge.setPosition(layout.freeSpinBadge.x, layout.freeSpinBadge.y);

    // Барабаны пересобираются под новый размер ячейки.
    this.reelSet.metrics = this.metrics;
    this.reelSet.view.x = this.metrics.x;
    this.reelSet.view.y = this.metrics.y;
    this.reelSet.view.width = this.metrics.width;
    this.reelSet.view.height = this.metrics.height;
    this.reelSet.clipper.clip = {
      x: this.metrics.x, y: this.metrics.y,
      width: this.metrics.width, height: this.metrics.height
    };

    this.ambientView.width = layout.width;
    this.ambientView.height = layout.height;
    this.winPresenter.applyLayout(layout, this.metrics);
    this.panel.applyLayout(layout);
    this.paytable.applyLayout(layout);
    this.autoplayModal.applyLayout(layout);
    this.historyModal.applyLayout(layout);
    this.toast.applyLayout(layout);
    this.startScreen.applyLayout(layout);
  }

  /**
   * Уход с заставки.
   *
   * Музыка запускается именно здесь. Нажатие «Играть» — первый жест
   * пользователя на странице, и только после него браузер разрешает
   * звук; запуск на загрузке молча отклоняется, и игрок решает,
   * что звука в игре нет вообще.
   */
  _leaveIntro() {
    this._introDone = true;
    // attachUnlock уже возобновил контекст на этом же нажатии,
    // поэтому музыку можно запускать сразу.
    this.audio.playMusic(this.freeMode ? "music_free" : "music_base");
  }

  /** Пересобирает текстуры символов под текущий масштаб экрана. */
  _rebuildTextures() {
    const pixelScale = this.renderer.scale * this.renderer.dpr;
    this.symbolTextures.rebuild(pixelScale, this.layout.cell);
  }

  /* ────────────────────────────── старт ─────────────────────────── */

  start() {
    this.ticker.start();
    // Музыку включает уход с заставки: до жеста пользователя браузер
    // всё равно её не пустит. Если заставка отключена игроком —
    // включаем сразу, первый же тап по игре разблокирует звук.
    if (!this.startScreen.visible) this._leaveIntro();

    if (this.session.resume) {
      this._resumeRound(this.session.resume);
    } else {
      // Первый экран не должен быть пустым: раскладываем случайную картинку.
      const screen = this._randomScreen();
      this.reelSet.setVisibleScreen(screen);
    }
  }

  _randomScreen() {
    const ids = this.config.symbolKeys.map((_, i) => i).filter((i) => i !== this.config.wild);
    return Array.from({ length: this.config.rows }, () =>
      Array.from({ length: this.config.reels }, () => ids[Math.floor(Math.random() * ids.length)])
    );
  }

  /** Восстановление незакрытого бонусного раунда после обрыва связи. */
  async _resumeRound(resume) {
    this.currentRound = resume;
    const last = resume.spins[resume.spins.length - 1];
    if (last?.screen) this.reelSet.setVisibleScreen(last.screen);

    if (resume.state === "free" && resume.freeSpins.left > 0) {
      this.toast.show(this.i18n.t("freeSpins"), 2.5);
      await this._enterFreeMode();
      this.freeSpinBadge.show(resume.freeSpins.left, resume.freeSpins.total);
      this._runFreeSpins(resume);
    }
  }

  /* ──────────────────────────── параметры ───────────────────────── */

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
    this.panel.betMeter.setValue(this.betMoney);
  }

  toggleTurbo() {
    this.turbo = !this.turbo;
    localStorage.setItem("sochi.turbo", this.turbo ? "1" : "0");
    this.panel.setTurbo(this.turbo);
  }

  /**
   * Полноэкранный режим.
   *
   * На телефоне это не украшение: адресная строка съедает до пятой части
   * высоты, а при прокрутке ещё и меняет её на лету, дёргая раскладку.
   *
   * Обращение к API обязано идти прямо из обработчика нажатия — браузеры
   * пускают в полный экран только по жесту пользователя. Отложенный
   * вызов молча отклоняется.
   *
   * Safari на iPhone полноэкранного режима для элементов не даёт вообще;
   * там кнопка прячется, потому что кнопка, которая ничего не делает,
   * хуже её отсутствия.
   */
  toggleFullscreen() {
    const el = document.documentElement;
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (active) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: "hide" });
      }
    } catch {
      // Отказ браузера — не повод падать: игра работает и в окне.
    }
  }

  static fullscreenSupported() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  toggleSound() {
    const muted = this.audio.toggleMute();
    this.panel.setSoundOn(!muted);
    localStorage.setItem("sochi.muted", muted ? "1" : "0");
    if (!muted) this.audio.playMusic(this.freeMode ? "music_free" : "music_base");
  }

  async showHistory() {
    try {
      const data = await this.api.history(20);
      this.historyModal.setRounds(data.rounds);
      this.historyModal.show();
    } catch {
      this.toast.show(this.i18n.t("genericError"));
    }
  }

  /** Полный разбор одного раунда: экран каждого спина и вклад каждой линии. */
  async showRoundDetail(id) {
    try {
      const detail = await this.api.round(id);
      this.historyModal.showDetail(detail);
    } catch {
      this.toast.show(this.i18n.t("roundLoadFailed"));
    }
  }

  /* ──────────────────────────── автоигра ────────────────────────── */

  toggleAutoplay() {
    if (this.autoplayLeft > 0) {
      this.stopAutoplay();
    } else {
      this.autoplayModal.show();
    }
  }

  /**
   * @param opts.lossLimit — серия останавливается, когда суммарный минус
   *   за неё достигает этой суммы. 0 — без лимита.
   * @param opts.winLimit  — останов при выигрыше за один раунд не меньше
   *   этой суммы. 0 — без лимита.
   *
   * Оба ограничителя обязательны в ряде юрисдикций (UKGC, MGA, Швеция):
   * автоигру нельзя выпускать без возможности задать предел потерь.
   */
  startAutoplay(count, { lossLimit = 0, winLimit = 0 } = {}) {
    this.autoplayLeft = count;
    this.autoplayLossLimit = lossLimit;
    this.autoplayWinLimit = winLimit;
    // Считаем от начала серии, а не от начала сессии: игрок задаёт лимит
    // именно на эту серию, и накопленный ранее минус в него не входит.
    this.autoplayNet = 0;
    this.panel.setAutoplay(count);
    if (this.state === STATE.IDLE) this.requestSpin();
  }

  stopAutoplay() {
    this.autoplayLeft = 0;
    this.panel.setAutoplay(0);
  }

  /* ─────────────────────────── цикл раунда ──────────────────────── */

  requestStop() {
    // «Стоп» не отменяет спин — результат уже определён сервером.
    // Он лишь ускоряет показ.
    this.reelSet.hurry();
  }

  async requestSpin() {
    if (this.state === STATE.PRESENTING) {
      // Нетерпеливый игрок: прерываем показ и сразу крутим дальше.
      this.winPresenter.clear();
      this.state = STATE.IDLE;
    }
    if (this.state !== STATE.IDLE) return;

    if (this.betMoney > this.balance) {
      this.audio.play("error");
      this.toast.show(this.i18n.t("insufficientFunds"));
      this.stopAutoplay();
      // Лобби само решит, показывать ли кассу: у оператора своя логика
      // депозитов и свои ограничения ответственной игры.
      this.lobby?.emit(GameEvent.CASHIER, { required: this.betMoney, balance: this.balance });
      return;
    }

    this.state = STATE.SPINNING;
    this.panel.setSpinning(true);
    this.winPresenter.clear();
    this.lastWin = 0;
    this.panel.winMeter.setValue(0, true);

    this.audio.play("spin_start");
    this.reelSet.startSpin({ turbo: this.turbo });
    this.lobby?.emit(GameEvent.ROUND_START, { bet: this.bet, balance: this.balance });

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
      return this._handleSpinError(err);
    }

    this.balance = result.balance;
    this.currentRound = result;

    const spin = result.spins[0];
    await this._spinReels(spin, result.bet);

    this.panel.balanceMeter.setValue(this.balance);

    if (result.state === "free") {
      await this._startFreeSpins(result);
    } else {
      await this._finishBaseSpin(result, spin);
    }
  }

  /** Прокрутка и остановка барабанов под конкретный результат. */
  async _spinReels(spin, bet) {
    const anticipation = this._anticipationReels(spin.screen);

    await this.reelSet.stopAll(spin.screen, {
      turbo: this.turbo,
      anticipationReels: anticipation,
      onReelStop: (index) => {
        // Небольшой сдвиг высоты тона по барабанам — приём из «живых»
        // автоматов, делает остановку ритмичной, а не механической.
        this.audio.play("reel_stop", { rate: 0.94 + index * 0.035 });
        // Удар при остановке каждого барабана намеренно НЕ трясёт сцену:
        // пять толчков подряд за спин превращаются в постоянную дрожь.
        // Импульс приземления уже есть в самих символах — они сплющиваются.
        const hasScatter = spin.screen.some((row) => row[index] === this.config.scatter);
        if (hasScatter) {
          this.audio.play("scatter", { volume: 0.8 });
          this.shake(5, 0.3);
        }
      }
    });
  }

  /**
   * Барабаны, которые стоит «потомить».
   * Если на уже остановившихся барабанах два скаттера, следующий барабан
   * решает судьбу бонуса — именно этот момент и нужно растянуть.
   */
  _anticipationReels(screen) {
    const need = this.config.freespins.triggerScatters;
    const result = [];
    let count = 0;
    for (let reel = 0; reel < this.config.reels; reel++) {
      if (count >= need - 1 && reel < this.config.reels) result.push(reel);
      for (let row = 0; row < this.config.rows; row++) {
        if (screen[row][reel] === this.config.scatter) count++;
      }
    }
    return result.slice(0, 2);
  }

  async _finishBaseSpin(result, spin) {
    if (result.totalWin > 0) {
      this.state = STATE.PRESENTING;
      this.lastWin = result.totalWin;
      this.panel.winMeter.setValue(result.totalWin);
      this._playWinSound(result.totalWin, result.bet);
      await this.winPresenter.present(spin.wins, {
        bet: result.bet,
        totalWin: result.totalWin
      });
    }

    this._applyPendingBalance();
    this.lobby?.emit(GameEvent.ROUND_END, {
      bet: result.bet, win: result.totalWin, balance: this.balance
    });

    this.state = STATE.IDLE;
    this.panel.setSpinning(false);
    this._continueAutoplay({ bet: result.bet, win: result.totalWin });
  }

  /** Применяет баланс, пришедший по сокету во время спина. */
  _applyPendingBalance() {
    if (this._pendingBalance == null) return;
    this.balance = this._pendingBalance;
    this._pendingBalance = null;
    this.panel.balanceMeter.setValue(this.balance);
    this.lobby?.emit(GameEvent.BALANCE, { balance: this.balance });
  }

  _playWinSound(win, bet) {
    const x = win / bet;
    if (x >= 15) return;                       // крупный выигрыш озвучит баннер
    if (x >= 5) this.audio.play("win_medium");
    else this.audio.play("win_small");
  }

  /* ─────────────────────────── фриспины ─────────────────────────── */

  async _startFreeSpins(result) {
    const spin = result.spins[0];

    // Скаттеры подсвечиваются до объявления бонуса — игрок должен увидеть,
    // за что именно ему дали фриспины.
    const scatterWin = spin.wins.find((w) => w.type === "scatter");
    if (scatterWin) {
      this.reelSet.showWinningCells(scatterWin.positions, { dim: true });
      await this._sleep(1.1);
    }

    if (result.totalWin > 0) {
      this.panel.winMeter.setValue(result.totalWin);
    }

    this.lobby?.emit(GameEvent.FEATURE_START, { spins: result.freeSpins.total });
    await this.winPresenter.announceFreeSpins(result.freeSpins.total);
    await this._enterFreeMode();
    this._runFreeSpins(result);
  }

  async _enterFreeMode() {
    this.freeMode = true;
    this.audio.playMusic("music_free");
    this.tweens.to(this.backgroundLayer, { freeAlpha: 1 }, { duration: 0.8 });
    this.reelSet.freeMode = true;
  }

  async _exitFreeMode() {
    this.freeMode = false;
    this.audio.playMusic("music_base");
    this.tweens.to(this.backgroundLayer, { freeAlpha: 0 }, { duration: 0.8 });
    this.reelSet.freeMode = false;
    this.freeSpinBadge.hide();
  }

  /** Последовательность фриспинов: спины идут сами, без участия игрока. */
  async _runFreeSpins(round) {
    this.state = STATE.FREESPINS;
    this.panel.setSpinning(true, { canStop: true });

    let current = round;
    let guard = 0;

    while (current.state === "free" && guard++ < 500) {
      this.freeSpinBadge.show(current.freeSpins.left, current.freeSpins.total);
      await this._sleep(this.turbo ? 0.25 : 0.6);

      this.winPresenter.clear();
      this.audio.play("spin_start", { volume: 0.7 });
      this.reelSet.startSpin({ turbo: this.turbo });

      let next;
      try {
        next = await this.api.freeSpin(current.roundId, crypto.randomUUID());
      } catch (err) {
        return this._handleSpinError(err, { duringFreeSpins: true, round: current });
      }

      const spin = next.spins[0];
      await this._spinReels(spin, next.bet);

      this.balance = next.balance;
      this.panel.balanceMeter.setValue(this.balance);

      if (spin.retrigger > 0) {
        this.shake(6, 0.4);
        this.audio.play("scatter");
        this.toast.show(this.i18n.t("retrigger", spin.retrigger), 2);
      }

      if (spin.win > 0) {
        this.panel.winMeter.setValue(next.freeSpins.win);
        this._playWinSound(spin.win, next.bet);
        await this.winPresenter.present(spin.wins, {
          bet: next.bet,
          totalWin: spin.win,
          skipCycle: true
        });
        await this._sleep(this.turbo ? 0.3 : 0.9);
      }

      current = { ...next, roundId: current.roundId };
      this.currentRound = current;
    }

    this.freeSpinBadge.hide();
    if (current.freeSpins.win > 0) {
      await this.winPresenter.announceBonusTotal(current.freeSpins.win);
    }
    await this._exitFreeMode();

    this.lobby?.emit(GameEvent.FEATURE_END, {
      win: current.freeSpins.win, total: current.totalWin, balance: this.balance
    });
    this.lobby?.emit(GameEvent.ROUND_END, {
      bet: current.bet, win: current.totalWin, balance: this.balance
    });

    this.panel.winMeter.setValue(current.totalWin);
    this.state = STATE.IDLE;
    this.panel.setSpinning(false);
    this._continueAutoplay({
      afterFeature: true, bet: current.bet, win: current.totalWin
    });
  }

  /* ──────────────────────────── ошибки ──────────────────────────── */

  _handleSpinError(err, { duringFreeSpins = false } = {}) {
    this.stopAutoplay();
    this.reelSet.hurry();

    const known = {
      INSUFFICIENT_FUNDS: this.i18n.t("insufficientFunds"),
      ROUND_IN_PROGRESS: this.i18n.t("roundInProgress"),
      NETWORK: this.i18n.t("connectionLost"),
      SESSION_EXPIRED: this.i18n.t("genericError")
    };
    const message = known[err.code] || err.message || this.i18n.t("genericError");
    this.lobby?.emit(GameEvent.ERROR, { code: err.code, message });

    this.audio.play("error");
    this.toast.show(message, 5);

    // Сессия истекла — единственный корректный выход это перезапуск.
    if (err.code === "SESSION_EXPIRED" || err.code === "NO_SESSION") {
      setTimeout(() => location.reload(), 2500);
      this.state = STATE.ERROR;
      return;
    }

    // Барабаны докручиваем до нейтральной картинки, чтобы игра
    // не осталась «зависшей» в движении.
    const screen = this.currentRound?.spins?.[0]?.screen || this._randomScreen();
    this.reelSet.stopAll(screen, { turbo: true }).then(async () => {
      // Пересинхронизация: после сбоя локальное представление о балансе
      // и незакрытом раунде может разойтись с сервером.
      try {
        const state = await this.api.getState();
        this.balance = state.balance;
        this.panel.balanceMeter.setValue(state.balance);
        if (state.resume && state.resume.state === "free") {
          this.state = STATE.IDLE;
          await this._resumeRound(state.resume);
          return;
        }
      } catch {
        // Связи по-прежнему нет — оставляем игру в простое,
        // игрок сможет повторить вручную.
      }
      this.state = STATE.IDLE;
      this.panel.setSpinning(false);
    });
  }

  _continueAutoplay({ afterFeature = false, bet = 0, win = 0 } = {}) {
    if (this.autoplayLeft <= 0) return;

    // Учёт ведётся по завершённому раунду: у бонусного раунда ставка одна,
    // а выигрыш приходит после всех фриспинов, поэтому считать по спинам
    // было бы неверно.
    // Округление до копейки на каждом шаге: без него сумма сотен раундов
    // накапливает погрешность double и лимит срабатывает не там, где надо.
    this.autoplayNet = Math.round((this.autoplayNet + win - bet) * 100) / 100;

    const stop = (message) => {
      this.stopAutoplay();
      this.toast.show(message, 4);
    };

    if (this.autoplayWinLimit > 0 && win >= this.autoplayWinLimit) {
      stop(this.i18n.t("autoplayStoppedWin", this.money.format(win)));
      return;
    }
    if (this.autoplayLossLimit > 0 && -this.autoplayNet >= this.autoplayLossLimit) {
      stop(this.i18n.t("autoplayStoppedLoss", this.money.format(-this.autoplayNet)));
      return;
    }
    if (afterFeature && this.autoplayStopOnFeature) {
      stop(this.i18n.t("autoplayStoppedFeature"));
      return;
    }

    this.autoplayLeft--;
    this.panel.setAutoplay(this.autoplayLeft);
    if (this.autoplayLeft >= 0) {
      setTimeout(() => {
        if (this.state === STATE.IDLE && this.autoplayLeft >= 0) this.requestSpin();
      }, this.turbo ? 180 : 520);
    }
  }

  /* ──────────────────────────── прочее ──────────────────────────── */

  _bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (this.state === STATE.SPINNING) this.requestStop();
        else this.requestSpin();
      }
      if (e.code === "ArrowUp") this.changeBet(1);
      if (e.code === "ArrowDown") this.changeBet(-1);
      if (e.code === "KeyM") this.toggleSound();
      if (e.code === "KeyT") this.toggleTurbo();
      if (e.code === "Escape") {
        this.paytable.hide();
        this.autoplayModal.hide();
        this.historyModal.hide();
      }
    });
  }

  /**
   * Короткий толчок камеры. Используется на крупных выигрышах и
   * на антисипации — там, где нужно физически почувствовать событие.
   */
  shake(amp = 10, duration = 0.4) {
    this._shake.amp = Math.max(this._shake.amp, amp);
    this._shake.duration = duration;
    this._shake.time = 0;
  }

  _updateShake(dt) {
    const s = this._shake;
    const g = this.shakeGroup;
    if (s.amp <= 0) {
      if (g.x !== 0 || g.y !== 0) { g.x = 0; g.y = 0; }
      return;
    }
    s.time += dt;
    const k = Math.min(1, s.time / s.duration);
    const falloff = (1 - k) * (1 - k);
    const a = s.amp * falloff;
    // Толчок преимущественно вертикальный: барабан падает сверху вниз,
    // и боковая болтанка выглядела бы неестественно.
    g.x = Math.sin(s.time * 41) * a * 0.35;
    g.y = Math.cos(s.time * 33) * a;
    if (k >= 1) {
      s.amp = 0;
      g.x = 0;
      g.y = 0;
    }
  }

  /**
   * Фоновые звуки набережной: чайки и редкий накат волны.
   *
   * В музыкальную петлю их класть нельзя — она повторяется каждые
   * 19 секунд, и любой узнаваемый звук в ней превращается в навязчивый
   * тик. Поэтому они живут отдельно и запускаются по случайному
   * расписанию: ухо не находит период и принимает их за среду.
   */
  _updateAmbientSound(dt) {
    if (this._paused) return;
    this._seaTimer -= dt;
    if (this._seaTimer > 0) return;

    // Во фриспинах набережная затихает: там своя, более плотная музыка.
    const quiet = this.freeMode || this.state !== STATE.IDLE;
    if (Math.random() < 0.55) {
      this.audio.play("gull", { volume: quiet ? 0.16 : 0.34, rate: 0.9 + Math.random() * 0.25 });
    } else {
      this.audio.play("wave", { volume: quiet ? 0.12 : 0.26, rate: 0.92 + Math.random() * 0.16 });
    }
    this._seaTimer = 11 + Math.random() * 17;
  }

  _updateAmbient(dt) {
    this.ambient.update(dt);
    this._updateAmbientSound(dt);
    this._ambientTimer -= dt;
    if (this._ambientTimer > 0) return;
    this._ambientTimer = 0.5;

    const L = this.layout;
    this.ambient.emit({
      frame: this.store.frame("p_glow"),
      x: Math.random() * L.width,
      y: L.height * (0.25 + Math.random() * 0.55),
      count: 1,
      angle: [-Math.PI * 0.62, -Math.PI * 0.38],
      speed: [8, 26],
      life: [4.5, 8],
      size: [5, 16],
      sizeEnd: 0.5,
      gravity: -2,
      drag: 0.999,
      alpha: 0.5,
      alphaEnd: 0,
      blend: "lighter"
    });
  }

  _update(dt) {
    // На паузе сцена продолжает рисоваться, но время не идёт:
    // анимации не «проматываются» за спиной у модального окна лобби.
    if (this._paused) dt = 0;
    this.tweens.update(dt);
    this.backgroundLayer.update();
    this._updateShake(dt);
    this._updateAmbient(dt);
    this.reelSet.update(dt);
    this.winPresenter.update(dt);
    this.panel.update(dt);
    this.freeSpinBadge.update(dt);
    this.toast.update(dt);
    this.paytable.update(dt);
    this.autoplayModal.update(dt);
    this.historyModal.update(dt);
    this.startScreen.update(dt);
    this.renderer.render();
  }

  _sleep(seconds) {
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }
}
