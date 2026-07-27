// Сборка слота: сцена, слои, раскладка и проводка всего со всем.
//
// Здесь НЕТ правил раунда (они в machine.js), нет физики барабанов
// (reels/), нет подсчёта выигрышей (mechanics/) и нет знания о Сочи —
// тема приходит параметром. Осталось ровно то, что и должно быть в сборке:
// кто кого создаёт, кто в каком слое лежит и кто на чей сигнал отвечает.
//
// Проводка сигналов занимает половину файла и это нормально: раньше она
// была размазана по девяти обязанностям одного класса на 945 строк, и,
// чтобы понять, почему при закрытии сессии не гаснет автоигра, приходилось
// читать его целиком.

import { Application } from "../engine/app.js";
import { Container, Sprite } from "../engine/display.js";

import { Grid } from "./grid.js";
import { Money } from "./money.js";
import { RoundMachine, RoundState } from "./machine.js";
import { Autoplay } from "./autoplay.js";
import { Shaker } from "./camera.js";
import { resolveMechanic } from "./mechanics/index.js";
import { SymbolTextures } from "./reels/symbolTextures.js";
import { ReelsView } from "./reels/reelsView.js";
import { WinPresenter } from "./presentation/winPresenter.js";
import { ControlPanel } from "./ui/controlPanel.js";
import { FreeSpinBadge } from "./ui/freeSpinBadge.js";
import { StartScreen } from "./ui/startScreen.js";
import { bindKeyboard } from "./ui/keyboard.js";
import { PaytableModal } from "./ui/modals/paytable.js";
import { AutoplayModal } from "./ui/modals/autoplay.js";
import { HistoryModal } from "./ui/modals/history.js";
import { Toast } from "./ui/modals/toast.js";
import { GameEvent, LobbyCommand } from "./net/lobby.js";

/** Слои сцены снизу вверх. Порядок отрисовки задаётся здесь и только здесь. */
const LAYER = {
  BACKGROUND: "background",
  AMBIENT: "ambient",
  BOARD: "board",
  HUD: "hud",
  MODAL: "modal",
  TOAST: "toast",
  INTRO: "intro"
};

export class SlotGame {
  constructor({ canvas, container, store, audio, api, i18n, theme, config, session, socket, lobby }) {
    this.store = store;
    this.audio = audio;
    this.api = api;
    this.i18n = i18n;
    this.theme = theme;
    this.config = config;
    this.session = session;
    this.socket = socket || null;
    this.lobby = lobby || null;

    // Валюта приходит из сессии: её задаёт кошелёк оператора, а не игра.
    this.money = new Money(session.currency || { code: session.player?.currency }, i18n.lang);
    this.mechanic = resolveMechanic(config);
    this.grid = new Grid(config.reels, config.rows);

    this.turbo = localStorage.getItem(this._key("turbo")) === "1";

    /* ── движок ─────────────────────────────────────────────────── */
    const size = { reels: config.reels, rows: config.rows };
    // Раскладка до первого измерения экрана: настоящую построит ViewportManager.
    this.layout = theme.layout.build(1920, 1080, size);
    this.grid.apply(this.layout);

    this.app = new Application({
      canvas,
      container,
      designWidth: this.layout.width,
      designHeight: this.layout.height,
      backgroundColor: theme.palette.stage,
      buildLayout: (vw, vh) => theme.layout.build(vw, vh, size),
      layers: Object.values(LAYER)
    });

    // Короткие ссылки на подсистемы движка: их читают стенды и панель
    // диагностики, и через них же ходит игровой код.
    this.renderer = this.app.renderer;
    this.ticker = this.app.ticker;
    this.tweens = this.app.tweens;
    this.timeline = this.app.timeline;
    this.input = this.app.input;
    this.viewport = this.app.viewport;

    this._buildScene();

    this.machine = new RoundMachine({
      api, config, money: this.money,
      mechanic: this.mechanic,
      timeline: this.timeline,
      timings: theme.timings,
      grid: this.grid,
      reels: this.reelSet,
      presenter: this.winPresenter
    });
    this.machine.turbo = this.turbo;
    this.autoplay = new Autoplay({
      machine: this.machine, timeline: this.timeline, timings: theme.timings
    });

    this._bindMachine();
    this._bindAutoplay();
    this._bindSocket();
    this._bindLobby();
    this._bindKeyboard();
    this._bindScreen();

    this.viewport.apply();
    this._rebuildTextures();
    this.app.onUpdate.add((dt) => this._update(dt));
  }

  _key(name) {
    return `${this.theme.id}.${name}`;
  }

  /* ─────────────────────────── сборка сцены ─────────────────────── */

  _buildScene() {
    const { store, audio, i18n, theme, config } = this;
    const layers = this.app.layers;

    this.backgroundNode = theme.createBackground(store, this.layout);
    this.frame = new Sprite(store.frame(theme.atlas.reelFrame), 2);
    this.logo = new Sprite(store.frame(theme.atlas.logo), 2);
    this.logo.setAnchor(0.5);

    // Соответствие «id символа из математики → картинка» задаёт тема:
    // ни движок, ни слот про якоря и шашлык не знают.
    const symbolIds = config.symbolKeys.map((_, i) => i);
    this.symbolTextures = new SymbolTextures(
      (id) => store.frame(config.symbolKeys[id]), symbolIds, this.layout.cell);

    this.reelSet = new ReelsView({
      grid: this.grid,
      textures: this.symbolTextures,
      timings: theme.timings,
      anticipationFill: theme.palette.anticipation,
      // Дикий не сыплется в холостую: на настоящей ленте его нет
      // на первом и последнем барабанах, и в прокрутке он мозолил глаз.
      symbolPool: symbolIds.filter((id) => id !== config.wild),
      frames: {
        cellGlow: store.frame(theme.atlas.cellGlow),
        winFrame: store.frame(theme.atlas.winFrame),
        rays: store.has(theme.atlas.winRays) ? store.frame(theme.atlas.winRays) : null
      }
    });

    // Тряска применяется только к игровому полю.
    this.board = new Container();
    this.shaker = new Shaker(this.board);

    this.winPresenter = new WinPresenter({
      store, audio, i18n, theme,
      money: this.money,
      tweens: this.tweens,
      timeline: this.timeline,
      grid: this.grid,
      paylines: config.paylines,
      reels: this.reelSet,
      mechanic: this.mechanic,
      onShake: (amp, dur) => this.shaker.kick(amp, dur)
    });

    this.freeSpinBadge = new FreeSpinBadge(store, i18n, theme);

    this.panel = new ControlPanel({
      store, audio, i18n, theme, money: this.money,
      callbacks: {
        onSpin: () => this.requestSpin(),
        onStop: () => this.requestStop(),
        onBetChange: (d) => this.machine.changeBet(d),
        onToggleTurbo: () => this.toggleTurbo(),
        onAutoplay: () => this.toggleAutoplay(),
        onToggleSound: () => this.toggleSound(),
        onInfo: () => this.paytable.show(),
        onHistory: () => this.showHistory(),
        onToggleFullscreen: () => this.toggleFullscreen(),
        onMenu: () => this.paytable.show()
      }
    });

    const modalDeps = {
      store, audio, i18n, theme, config,
      tweens: this.tweens,
      layout: this.layout,
      money: this.money
    };
    // Возврат игроку показывается только тот, что пришёл с сервера:
    // круглое число, вписанное в клиент, расходится с сертифицированной
    // моделью, а это претензия регулятора, а не опечатка.
    const rtp = Number.isFinite(config.rtp) ? config.rtp.toFixed(2) : null;

    this.paytable = new PaytableModal({ ...modalDeps, rtp });
    this.autoplayModal = new AutoplayModal({
      ...modalDeps,
      getBet: () => this.betMoney,
      onStart: (n, limits) => this.autoplay.start(n, limits)
    });
    this.historyModal = new HistoryModal({
      ...modalDeps,
      onOpenRound: (id) => this.showRoundDetail(id)
    });
    this.toast = new Toast({ store, theme, layout: this.layout });

    // Заставка живёт поверх всей сцены и перехватывает нажатия,
    // пока игрок не нажмёт «Играть».
    this.startScreen = new StartScreen({
      store, audio, i18n, theme, config, rtp,
      layout: this.layout,
      onPlay: () => this._leaveIntro()
    });
    this.startScreen.visible = StartScreen.shouldShow(theme.id);

    this.board.add(this.frame, this.reelSet, this.winPresenter);

    layers.place(LAYER.BACKGROUND, this.backgroundNode);
    layers.place(LAYER.BOARD, this.board);
    layers.place(LAYER.HUD, this.logo, this.freeSpinBadge, this.panel);
    layers.place(LAYER.MODAL, this.paytable, this.autoplayModal, this.historyModal);
    layers.place(LAYER.TOAST, this.toast);
    layers.place(LAYER.INTRO, this.startScreen);

    // Живность сцены — плагин темы: ему выдают слой и подписку на кадр,
    // дальше он живёт сам. Игра не знает ни про чаек, ни про прибой,
    // ни про то, что над набережной вообще что-то летает.
    this.ambient = theme.createAmbient({
      app: this.app,
      layer: layers.get(LAYER.AMBIENT),
      store, audio, theme,
      getState: () => ({
        idle: this.machine?.state === RoundState.IDLE,
        free: !!this.machine?.freeMode
      })
    }) || null;

    this.panel.winMeter.setValue(0, true);
    this.panel.setTurbo(this.turbo);
    this.panel.setSoundOn(!audio.muted);
  }

  _applyLayout(layout) {
    this.layout = layout;
    this.grid.apply(layout);

    this.backgroundNode.applyLayout(layout);

    const f = this.grid.frame;
    this.frame.setSize(f.width, f.height).setPosition(f.x, f.y);

    this.logo.setPosition(layout.logo.x, layout.logo.y);
    this.logo.scaleX = this.logo.scaleY = layout.logo.scale;
    this.freeSpinBadge.setPosition(layout.freeSpinBadge.x, layout.freeSpinBadge.y);

    this.reelSet.applyGrid(this.grid);
    this.ambient?.applyLayout(layout);
    this.winPresenter.applyLayout(layout, this.grid);
    this.panel.applyLayout(layout);
    this.paytable.applyLayout(layout);
    this.autoplayModal.applyLayout(layout);
    this.historyModal.applyLayout(layout);
    this.toast.applyLayout(layout);
    this.startScreen.applyLayout(layout);
  }

  /** Пересобирает текстуры символов под текущий масштаб экрана. */
  _rebuildTextures() {
    this.symbolTextures.rebuild(this.renderer.scale * this.renderer.dpr, this.layout.cell);
  }

  _bindScreen() {
    this.app.onLayout.add((layout) => this._applyLayout(layout));

    // Текстуры символов и фон зависят от итогового размера на экране.
    // Пересборка отложена: во время перетаскивания границы окна событий
    // приходят десятки, а собирать два десятка текстур каждый раз — рывок.
    this.renderer.onResize.add(() => {
      clearTimeout(this._texTimer);
      this._texTimer = setTimeout(() => this._rebuildTextures(), 140);
    });

    // Полный экран можно выйти клавишей Esc или жестом системы —
    // значок обязан это отражать, иначе он врёт о состоянии.
    for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) {
      document.addEventListener(ev, () => {
        this.panel.setFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
      });
    }

    this.api.onConnectionChange = (online) => {
      this.toast.show(
        this.i18n.t(online ? "connectionRestored" : "connectionLost"), online ? 2 : 6);
    };
  }

  /* ──────────────────── проводка автомата раунда ────────────────── */

  _bindMachine() {
    const m = this.machine;
    const panel = this.panel;
    const snd = this.theme.sounds;

    m.onStateChange.add((state) => {
      const busy = state === RoundState.SPINNING
        || state === RoundState.PRESENTING
        || state === RoundState.FREESPINS;
      panel.setSpinning(busy);
    });

    m.onBalance.add((balance, external) => {
      panel.balanceMeter.setValue(balance);
      // Лобби интересует только то, чего оно не знает: результат раунда
      // оно и так получает в round.end.
      if (external) this.lobby?.emit(GameEvent.BALANCE, { balance });
    });

    m.onBetChange.add((_coins, money) => panel.betMeter.setValue(money));

    m.onSpinStart.add(({ bet, balance, free }) => {
      if (free) {
        this.audio.play(snd.spinStart, { volume: 0.7 });
        return;
      }
      panel.winMeter.setValue(0, true);
      this.audio.play(snd.spinStart);
      this.lobby?.emit(GameEvent.ROUND_START, { bet, balance });
    });

    m.onReelStop.add((index, { scatter }) => {
      // Небольшой сдвиг высоты тона по барабанам — приём из «живых»
      // автоматов, делает остановку ритмичной, а не механической.
      this.audio.play(snd.reelStop, { rate: 0.94 + index * 0.035 });
      // Удар при остановке каждого барабана намеренно НЕ трясёт сцену:
      // пять толчков подряд за спин превращаются в постоянную дрожь.
      // Импульс приземления уже есть в самих символах — они сплющиваются.
      if (scatter) {
        this.audio.play(snd.scatter, { volume: 0.8 });
        this.shaker.kick(5, 0.3);
      }
    });

    m.onWin.add(({ win, bet, total, silent }) => {
      panel.winMeter.setValue(total);
      if (silent) return;
      const x = win / bet;
      // Крупный выигрыш озвучит баннер — иначе два звука накладываются.
      if (x >= this.theme.winTiers[0].threshold) return;
      this.audio.play(x >= this.theme.winMediumThreshold ? snd.winMedium : snd.winSmall);
    });

    m.onRetrigger.add((count) => {
      this.shaker.kick(6, 0.4);
      this.audio.play(snd.scatter);
      this.toast.show(this.i18n.t("retrigger", count), 2);
    });

    m.onFreeMode.add((free, resumed) => {
      this.audio.playMusic(free ? this.theme.music.free : this.theme.music.base);
      this.tweens.to(this.backgroundNode, { freeAlpha: free ? 1 : 0 },
        { duration: this.theme.timings.freeModeFade });
      if (!free) this.freeSpinBadge.hide();
      // Выигранный бонус объявляет баннер; восстановленному после обрыва
      // связи объяснить себя нечем, кроме этой плашки.
      if (resumed) this.toast.show(this.i18n.t("freeSpins"), 2.5);
    });

    m.onFeatureStart.add(({ spins }) => this.lobby?.emit(GameEvent.FEATURE_START, { spins }));
    m.onFeatureProgress.add(({ left, total }) => this.freeSpinBadge.show(left, total));
    m.onFeatureEnd.add((payload) => {
      this.freeSpinBadge.hide();
      this.lobby?.emit(GameEvent.FEATURE_END, payload);
    });

    m.onRoundEnd.add(({ bet, win, balance }) => {
      this.lobby?.emit(GameEvent.ROUND_END, { bet, win, balance });
    });

    m.onInsufficient.add(({ required, balance }) => {
      this.audio.play(snd.error);
      this.toast.show(this.i18n.t("insufficientFunds"));
      this.autoplay.stop();
      // Лобби само решит, показывать ли кассу: у оператора своя логика
      // депозитов и свои ограничения ответственной игры.
      this.lobby?.emit(GameEvent.CASHIER, { required, balance });
    });

    m.onError.add(({ code, message, fatal }) => {
      this.autoplay.stop();
      const known = {
        INSUFFICIENT_FUNDS: "insufficientFunds",
        ROUND_IN_PROGRESS: "roundInProgress",
        NETWORK: "connectionLost",
        SESSION_EXPIRED: "genericError"
      };
      const text = known[code] ? this.i18n.t(known[code]) : (message || this.i18n.t("genericError"));
      this.lobby?.emit(GameEvent.ERROR, { code, message: text });
      this.audio.play(snd.error);
      this.toast.show(text, 5);
      // Сессия истекла — единственный корректный выход это перезапуск.
      if (fatal) setTimeout(() => location.reload(), 2500);
    });
  }

  _bindAutoplay() {
    this.autoplay.onCount.add((left) => this.panel.setAutoplay(left));
    this.autoplay.onStopped.add((reason, value) => {
      const text = {
        win: () => this.i18n.t("autoplayStoppedWin", this.money.format(value)),
        loss: () => this.i18n.t("autoplayStoppedLoss", this.money.format(value)),
        feature: () => this.i18n.t("autoplayStoppedFeature")
      }[reason];
      if (text) this.toast.show(text(), 4);
    });
  }

  /* ───────────────── канал уведомлений от сервера ───────────────── */

  _bindSocket() {
    if (!this.socket) return;

    this.socket.onEvent.add((type, msg) => {
      switch (type) {
        case "balance":
          this.machine.applyExternalBalance(msg.balance);
          break;

        case "session.closed":
          this.autoplay.stop();
          this.toast.show(this.i18n.t("sessionClosed"), 8);
          this.machine.fsm.to(RoundState.ERROR);
          this.panel.setSpinning(false);
          this.lobby?.emit(GameEvent.ERROR, { code: "SESSION_CLOSED" });
          break;

        case "maintenance":
          this.autoplay.stop();
          this.toast.show(msg.message || this.i18n.t("maintenance"), 10);
          break;

        case "reality-check":
          this.autoplay.stop();
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
          this.audio.playMusic(this._musicTrack());
          break;
        case LobbyCommand.SET_VOLUME:
          if (typeof payload.value === "number") this.audio.setVolume("master", payload.value);
          break;
        case LobbyCommand.REALITY_CHECK:
          this.autoplay.stop();
          this.toast.show(payload.message || this.i18n.t("realityCheck"), 8);
          break;
        case LobbyCommand.CLOSE:
          this.autoplay.stop();
          this.audio.stopMusic();
          break;
      }
    });

    this.lobby.emit(GameEvent.LOADED, {
      currency: this.money.code,
      balance: this.session.balance,
      betLevels: this.machine.betLevels.map((c) => this.money.fromCoins(c))
    });
  }

  /**
   * Пауза по команде лобби: оно показывает своё модальное окно.
   * Автоигра останавливается, но текущий раунд не прерывается —
   * ставка уже списана, и он обязан быть доигран. Он замирает вместе
   * с игровым временем и продолжится ровно с той же точки: таймлайн,
   * в отличие от setTimeout, на паузе не идёт.
   */
  setPaused(paused) {
    if (this.app.paused === paused) return;
    this.app.setPaused(paused);
    if (paused) {
      this.autoplay.stop();
      this.audio.setMuted(true);
    } else if (localStorage.getItem(this._key("muted")) !== "1") {
      this.audio.setMuted(false);
    }
  }

  get paused() {
    return this.app.paused;
  }

  /* ────────────────────────────── старт ─────────────────────────── */

  start() {
    this.app.start();
    this.panel.balanceMeter.setValue(this.session.balance, true);
    this.panel.betMeter.setValue(this.betMoney, true);
    // Музыку включает уход с заставки: до жеста пользователя браузер
    // всё равно её не пустит. Если заставка отключена игроком —
    // включаем сразу, первый же тап по игре разблокирует звук.
    if (!this.startScreen.visible) this._leaveIntro();
    this.machine.start(this.session);
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
    this.audio.playMusic(this._musicTrack());
  }

  _musicTrack() {
    return this.machine?.freeMode ? this.theme.music.free : this.theme.music.base;
  }

  /* ──────────────────── действия игрока ─────────────────────────── */

  requestSpin() {
    return this.machine.spin();
  }

  requestStop() {
    this.machine.stop();
  }

  /** Вход в бонусный режим руками — им пользуются стенды показа. */
  _enterFreeMode() {
    return this.machine._enterFreeMode();
  }

  toggleTurbo() {
    this.turbo = !this.turbo;
    this.machine.turbo = this.turbo;
    localStorage.setItem(this._key("turbo"), this.turbo ? "1" : "0");
    this.panel.setTurbo(this.turbo);
  }

  toggleSound() {
    const muted = this.audio.toggleMute();
    this.panel.setSoundOn(!muted);
    localStorage.setItem(this._key("muted"), muted ? "1" : "0");
    if (!muted) this.audio.playMusic(this._musicTrack());
  }

  toggleAutoplay() {
    if (this.autoplay.running) this.autoplay.stop();
    else this.autoplayModal.show();
  }

  stopAutoplay() {
    this.autoplay.stop();
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
      this.historyModal.showDetail(await this.api.round(id));
    } catch {
      this.toast.show(this.i18n.t("roundLoadFailed"));
    }
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

  _bindKeyboard() {
    this._unbindKeyboard = bindKeyboard({
      spin: () => this.requestSpin(),
      stop: () => this.requestStop(),
      isSpinning: () => this.state === RoundState.SPINNING,
      betUp: () => this.machine.changeBet(1),
      betDown: () => this.machine.changeBet(-1),
      toggleSound: () => this.toggleSound(),
      toggleTurbo: () => this.toggleTurbo(),
      closeOverlays: () => {
        this.paytable.hide();
        this.autoplayModal.hide();
        this.historyModal.hide();
      }
    });
  }

  /* ─────────────────── состояние наружу и обновление ────────────── */

  get state() {
    return this.machine.state;
  }

  get balance() {
    return this.machine.balance;
  }

  get lastWin() {
    return this.machine.lastWin;
  }

  get freeMode() {
    return this.machine.freeMode;
  }

  get currentRound() {
    return this.machine.currentRound;
  }

  get bet() {
    return this.machine.bet;
  }

  /**
   * Ставку спрашивают ещё на сборке сцены — окно автоигры показывает
   * лимиты в деньгах уже в конструкторе, а автомат раунда создаётся
   * после неё, потому что ему нужны готовые барабаны.
   */
  get betMoney() {
    return this.machine
      ? this.machine.betMoney
      : this.money.fromCoins(this.config.defaultBet);
  }

  get autoplayLeft() {
    return this.autoplay.left;
  }

  get autoplayLossLimit() {
    return this.autoplay.lossLimit;
  }

  get autoplayWinLimit() {
    return this.autoplay.winLimit;
  }

  get autoplayNet() {
    return this.autoplay.net;
  }

  /**
   * Обновление игры. Пауза и отрисовка — забота Application: сюда dt
   * приходит уже игровым, то есть нулевым на паузе.
   */
  _update(dt) {
    // Фон вправе быть живым: узел CoverImage статичен, а будущая
    // многослойная сцена — нет. Контракт темы это допускает.
    this.backgroundNode.update?.(dt);
    this.shaker.update(dt);
    this.reelSet.update(dt);
    this.winPresenter.update(dt);
    this.panel.update(dt);
    this.freeSpinBadge.update(dt);
    this.toast.update(dt);
    this.paytable.update(dt);
    this.autoplayModal.update(dt);
    this.historyModal.update(dt);
    this.startScreen.update(dt);
  }
}
