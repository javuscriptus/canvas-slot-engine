// Звуковая шина на Web Audio API.
//
// Здесь всё, что не музыка: контекст и его разблокировка, спрайт
// одноразовых эффектов, бесшовные лупы, панорама, ограничение голосов
// и боковая цепь, приседающая под важными эффектами. Послойная музыка
// живёт отдельно, в stems.js, и получает отсюда только готовую точку
// подключения.
//
// Пять вещей, которые ломают звук в слотах, и как они решены:
//   1. iOS/Android не дают запустить контекст без жеста пользователя →
//      unlock() навешивается на первый touch/click и возобновляет контекст.
//   2. Отдельные файлы на каждый эффект дают задержку и десятки запросов →
//      все одноразовые эффекты лежат в одном спрайте и декодируются разом.
//   3. Вращение длится 1.2–3 секунды, а звук старта — полсекунды →
//      между ними играет бесшовный луп, а не тишина.
//   4. Пять барабанов, встающих подряд, дают пять наложенных ударов и
//      клиппинг → на каждое логическое имя разрешено ограниченное
//      число одновременных голосов.
//   5. Фанфара поверх музыки в полный уровень звучит кашей →
//      музыка приседает под эффектом и возвращается сама.

import { MusicDirector } from "./stems.js";

const SPRITE_GUARD = 0.012;   // подрезаем хвост, чтобы не цеплять соседний эффект

// Сколько голосов допускается на одно логическое имя. Значения не с потолка:
// это ровно то количество, после которого наложение перестаёт читаться как
// «много» и начинает читаться как «громко». Приземления символов приходят
// пачкой по пять, тики счётчика — десятками.
const VOICE_LIMITS = {
  symbol_land: 2,
  tick: 3,
  click: 2,
  hover: 1,
  coins: 2,
  gull: 1,
  wave: 1,
};
const DEFAULT_VOICES = 4;

// Насколько музыка приседает под эффектом, 0…1. Отсутствие имени в таблице
// означает «не приседать»: щелчок по кнопке не событие, и дёргать под него
// весь микс — верный способ получить дышащую, «накачанную» музыку.
const DUCK = {
  anticipation: 0.45,
  anticipation_hit: 0.55,
  anticipation_miss: 0.30,
  scatter_1: 0.26,
  scatter_2: 0.34,
  scatter_3: 0.44,
  scatter_4: 0.55,
  win_big: 0.50,
  win_mega: 0.62,
  win_epic: 0.70,
  fanfare: 0.62,
  freespins: 0.58,
  buy_bonus: 0.50,
  transition: 0.45,
  count_end: 0.22,
  error: 0.25,
};

/** Крупные выигрыши: свой звук на каждый тир, а не один на всех. */
const TIER_SOUND = { big: "win_big", mega: "win_mega", epic: "win_epic" };

export class AudioManager {
  constructor({ baseUrl = "assets/audio/", enabled = true, version = "" } = {}) {
    this.baseUrl = baseUrl;
    this.version = version;
    this.ctx = null;
    this.ready = false;
    this.unlocked = false;

    this.sprite = null;
    this.spriteBuffer = null;
    this.loops = new Map();       // имя лупа → AudioBuffer

    this.volumes = { master: 0.8, sfx: 1.0, music: 0.45 };
    this.muted = !enabled;

    this.music = null;            // MusicDirector, появляется вместе с контекстом
    this._nodes = {};
    this._chains = [];            // пул «гейн + панорама», чтобы не мусорить в кадре
    this._voices = new Map();     // имя → активные голоса
    this._activeLoops = new Map();
    this._music = null;           // {name} — что играет сейчас
    this._pendingMusic = null;    // что заиграет, как только разблокируют контекст
    this._loading = null;
    this._failed = false;
    this._duck = { level: 1, until: 0 };
  }

  /* ───────────────────────────── запуск ─────────────────────────── */

  _createContext() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this._failed = true;
      return null;
    }
    this.ctx = new AC({ latencyHint: "interactive" });

    const master = this.ctx.createGain();
    const sfx = this.ctx.createGain();
    const music = this.ctx.createGain();
    // Отдельный узел под боковую цепь. Приседание нельзя писать в тот же
    // гейн, что и громкость музыки: игрок в этот момент может двигать
    // ползунок, и две автоматизации на одном параметре затирают друг друга.
    const duck = this.ctx.createGain();

    // Лёгкая компрессия: при совпадении фанфары, монет и музыки
    // суммарный сигнал уходит в клиппинг и начинает хрипеть.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    sfx.connect(master);
    music.connect(duck);
    duck.connect(master);
    master.connect(comp);
    comp.connect(this.ctx.destination);

    this._nodes = { master, sfx, music, duck, comp };
    this.music = new MusicDirector({
      ctx: this.ctx,
      destination: music,
      decode: (buf) => this._decode(buf),
      url: (name) => this._url(name),
    });
    this._applyVolumes();
    return this.ctx;
  }

  /** Навешивается один раз; снимает блокировку автозапуска звука. */
  attachUnlock(element = window) {
    const unlock = async () => {
      this._createContext();
      if (!this.ctx) return;
      if (this.ctx.state === "suspended") {
        try { await this.ctx.resume(); } catch { /* пользователь ушёл со страницы */ }
      }
      if (this.ctx.state === "running") {
        this.unlocked = true;
        element.removeEventListener("pointerdown", unlock);
        element.removeEventListener("touchend", unlock);
        element.removeEventListener("keydown", unlock);
        this._flushPendingMusic();
      }
    };
    element.addEventListener("pointerdown", unlock);
    element.addEventListener("touchend", unlock);
    element.addEventListener("keydown", unlock);
  }

  /* ──────────────────────────── загрузка ────────────────────────── */

  /** Формат выбирается один раз: Opus меньше, но старые iOS его не играют. */
  _ext() {
    if (this._extCache) return this._extCache;
    const a = document.createElement("audio");
    this._extCache = a.canPlayType('audio/webm; codecs="opus"') ? "webm" : "mp3";
    return this._extCache;
  }

  _url(name) {
    const v = this.version ? `?v=${this.version}` : "";
    return `${this.baseUrl}${name}.${this._ext()}${v}`;
  }

  async load(onProgress = () => {}) {
    if (this._loading) return this._loading;
    this._loading = this._doLoad(onProgress);
    return this._loading;
  }

  async _doLoad(onProgress) {
    this._createContext();
    if (!this.ctx) return;

    try {
      const v = this.version ? `?v=${this.version}` : "";
      const meta = await fetch(`${this.baseUrl}sfx.json${v}`).then((r) => r.json());
      this.sprite = meta.sprite;

      const jobs = [
        () => fetch(this._url("sfx")).then((r) => r.arrayBuffer())
          .then((b) => this._decode(b)).then((d) => { this.spriteBuffer = d; }),
      ];
      for (const [key, info] of Object.entries(meta.loops || {})) {
        jobs.push(() => fetch(this._url(info.file)).then((r) => r.arrayBuffer())
          .then((b) => this._decode(b)).then((d) => { this.loops.set(key, d); }));
      }
      jobs.push(() => this.music.load(meta.music));

      let done = 0;
      await Promise.all(jobs.map(async (job) => {
        await job();
        onProgress(++done / jobs.length);
      }));

      this.ready = true;
    } catch (err) {
      // Игра обязана работать и без звука — молча уходим в тихий режим.
      console.warn("[audio] загрузка не удалась, звук отключён:", err);
      this._failed = true;
    }
  }

  _decode(arrayBuffer) {
    return new Promise((resolve, reject) => {
      // Старый колбэчный вариант — единственный, что работает в Safari <14.1
      const p = this.ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    });
  }

  /* ────────────────────── пул узлов и панорама ──────────────────── */

  /**
   * Цепочка «гейн → панорама» из пула.
   *
   * BufferSource переиспользовать нельзя по спецификации, а вот гейн и
   * панораму — можно, и нужно: на спине с пятью барабанами, счётчиком и
   * монетами игра создаёт под сотню узлов в секунду, и каждый из них
   * потом собирает сборщик мусора ровно в кадре анимации выигрыша.
   */
  _acquire() {
    const chain = this._chains.pop() || this._makeChain();
    const t = this.ctx.currentTime;
    chain.gain.gain.cancelScheduledValues(t);
    chain.gain.gain.value = 1;
    chain.out.connect(this._nodes.sfx);
    return chain;
  }

  _release(chain) {
    try { chain.out.disconnect(); } catch { /* уже отключён */ }
    if (this._chains.length < 24) this._chains.push(chain);
  }

  _makeChain() {
    const gain = this.ctx.createGain();
    let panner = null;
    let setPan;

    if (this.ctx.createStereoPanner) {
      panner = this.ctx.createStereoPanner();
      setPan = (v) => { panner.pan.value = v; };
    } else {
      // Safari до 14.1 не знает StereoPannerNode. PannerNode в режиме
      // equalpower даёт ту же картину, если держать источник на дуге
      // единичного радиуса: иначе браузер начинает считать ещё и
      // затухание по расстоянию, и края панорамы проседают по громкости.
      panner = this.ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      setPan = (v) => {
        const x = Math.max(-1, Math.min(1, v));
        const z = Math.sqrt(Math.max(0, 1 - x * x));
        if (panner.positionX) {
          panner.positionX.value = x;
          panner.positionY.value = 0;
          panner.positionZ.value = z;
        } else {
          panner.setPosition(x, 0, z);
        }
      };
    }

    gain.connect(panner);
    return { gain, setPan, out: panner };
  }

  /* ─────────────────────────── воспроизведение ──────────────────── */

  /**
   * Проигрывает эффект из спрайта.
   *
   * @param {string} name логическое имя из sfx.json
   * @param {{volume?:number, rate?:number, delay?:number, pan?:number,
   *          duck?:number, maxVoices?:number}} opts
   * @returns {?{source:AudioBufferSourceNode, stop:function}} голос или null
   */
  play(name, opts = {}) {
    if (!this._playable()) return null;

    const entry = this.sprite?.[name];
    if (!entry) return null;

    const [startMs, durMs] = entry;
    const rate = opts.rate ?? 1;
    const limit = opts.maxVoices ?? VOICE_LIMITS[name] ?? DEFAULT_VOICES;
    this._limitVoices(name, limit);

    const chain = this._acquire();
    chain.setPan(opts.pan ?? 0);
    chain.gain.gain.value = opts.volume ?? 1;

    const src = this.ctx.createBufferSource();
    src.buffer = this.spriteBuffer;
    src.playbackRate.value = rate;
    src.connect(chain.gain);

    const when = this.ctx.currentTime + (opts.delay ?? 0);
    const duration = Math.max(0.02, durMs / 1000 - SPRITE_GUARD) / rate;
    src.start(when, startMs / 1000, duration);

    const voice = {
      source: src,
      name,
      chain,
      stop: (fade = 0.02) => this._stopVoice(voice, fade),
    };
    src.onended = () => this._retire(voice);
    this._track(name, voice);

    const amount = opts.duck ?? DUCK[name];
    if (amount) this.duck(amount, { hold: (durMs / 1000) * 0.7, delay: opts.delay ?? 0 });

    return voice;
  }

  _playable() {
    if (!this.ready || this.muted || this._failed || !this.ctx) return false;
    if (this.ctx.state !== "running") {
      // Контекст мог заснуть сам — на iOS это происходит после звонка
      // или переключения приложения. Молча будим и пропускаем этот звук:
      // проигранный на полсекунды позже, он всё равно уже не к месту.
      this.ctx.resume().catch(() => {});
      return false;
    }
    return true;
  }

  _track(name, voice) {
    let list = this._voices.get(name);
    if (!list) this._voices.set(name, (list = []));
    list.push(voice);
  }

  _untrack(voice) {
    const list = this._voices.get(voice.name);
    if (!list) return;
    const i = list.indexOf(voice);
    if (i >= 0) list.splice(i, 1);
  }

  /**
   * Голос отзвучал: цепочка возвращается в пул.
   *
   * Только по onended, и никогда раньше. Голос, снятый досрочно, ещё
   * доигрывает свой спад — если отдать его цепочку в пул сразу, следующий
   * звук выставит на ней громкость единицу, и умирающий источник допоёт
   * в полный голос через чужой гейн. Слышно это как случайные всплески
   * там, где звуков идёт пачкой, — то есть ровно на остановке барабанов.
   */
  _retire(voice) {
    this._untrack(voice);
    if (voice.chain) {
      this._release(voice.chain);
      voice.chain = null;
    }
  }

  /** Самый старый голос уступает место новому — иначе пачка даёт клиппинг. */
  _limitVoices(name, limit) {
    const list = this._voices.get(name);
    if (!list || list.length < limit) return;
    while (list.length >= limit) this._stopVoice(list[0], 0.03);
  }

  _stopVoice(voice, fade = 0.02) {
    if (!voice || !voice.source) return;
    this._untrack(voice);
    const now = this.ctx.currentTime;
    if (voice.chain && fade > 0) {
      const g = voice.chain.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.0001, now + fade);
    }
    try { voice.source.stop(now + fade); } catch { /* уже завершился */ }
  }

  /** Останавливает голос, полученный из play(). */
  stopSource(voice, fade = 0.02) {
    if (voice && typeof voice.stop === "function") voice.stop(fade);
  }

  /* ─────────────────────────────── лупы ─────────────────────────── */

  /**
   * Запускает бесшовный луп. Повторный вызов с тем же именем не плодит
   * источники — возвращается уже играющий.
   *
   * @param {"spin"|"ambient"} name
   * @param {{volume?:number, rate?:number, pan?:number, fade?:number}} opts
   */
  playLoop(name, opts = {}) {
    if (!this._playable()) return null;
    const existing = this._activeLoops.get(name);
    if (existing) return existing;

    const buffer = this.loops.get(name);
    if (!buffer) return null;

    const chain = this._acquire();
    chain.setPan(opts.pan ?? 0);

    const target = opts.volume ?? 1;
    const fade = opts.fade ?? 0.12;
    const now = this.ctx.currentTime;
    chain.gain.gain.setValueAtTime(0.0001, now);
    chain.gain.gain.linearRampToValueAtTime(target, now + fade);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    src.connect(chain.gain);
    src.start(now);

    const handle = {
      name,
      source: src,
      chain,
      setVolume: (v, ramp = 0.15) => {
        const t = this.ctx.currentTime;
        chain.gain.gain.cancelScheduledValues(t);
        chain.gain.gain.setValueAtTime(chain.gain.gain.value, t);
        chain.gain.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + ramp);
      },
      setRate: (r, ramp = 0.2) => {
        const t = this.ctx.currentTime;
        src.playbackRate.cancelScheduledValues(t);
        src.playbackRate.setValueAtTime(src.playbackRate.value, t);
        src.playbackRate.linearRampToValueAtTime(r, t + ramp);
      },
      setPan: (p) => chain.setPan(p),
      stop: (out = 0.2) => this.stopLoop(name, { fade: out }),
    };
    this._activeLoops.set(name, handle);
    return handle;
  }

  /** Луп всегда уходит на спаде: обрыв бесшовного шума слышен щелчком. */
  stopLoop(name, { fade = 0.2 } = {}) {
    const handle = this._activeLoops.get(name);
    if (!handle) return;
    this._activeLoops.delete(name);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const g = handle.chain.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.0001, now + fade);
    try { handle.source.stop(now + fade + 0.02); } catch { /* уже остановлен */ }
    handle.source.onended = () => this._release(handle.chain);
  }

  /* ──────────────────────── боковая цепь ────────────────────────── */

  /**
   * Приседание музыки под эффектом.
   *
   * Огибающая программируется событием, а не снимается детектором с
   * сигнала: детектор в Web Audio строится только на AudioWorklet, то есть
   * на отдельном файле, отдельной загрузке и отдельном пути отказа —
   * ради результата, который здесь известен заранее. Длина эффекта берётся
   * из спрайта, глубина — из таблицы, приседание получается ровно такое,
   * какое задумано, и одинаковое на всех машинах.
   *
   * @param {number} amount глубина 0…1
   * @param {{attack?:number, hold?:number, release?:number, delay?:number}} opts
   */
  duck(amount, { attack = 0.04, hold = 0.3, release = 0.45, delay = 0 } = {}) {
    if (!this.ctx || !this._nodes.duck) return;
    const now = this.ctx.currentTime + delay;
    const g = this._nodes.duck.gain;

    // Совпавшие эффекты не складывают приседания: берётся самое глубокое,
    // а отпускание отодвигается на самое позднее. Сложение давало бы
    // полную тишину на фанфаре с монетами — музыка просто пропадала.
    const level = now < this._duck.until
      ? Math.min(this._duck.level, 1 - amount)
      : 1 - amount;
    const until = Math.max(this._duck.until, now + attack + hold);
    this._duck = { level, until };

    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(level, now + attack);
    g.setValueAtTime(level, until);
    g.linearRampToValueAtTime(1, until + release);
  }

  /* ──────────────────────────── музыка ──────────────────────────── */

  /**
   * Включает музыкальную тему. Имена "base"/"free" и старые
   * "music_base"/"music_free" равнозначны.
   */
  playMusic(name, { fade = 0.8 } = {}) {
    if (this._failed) return;
    const theme = name === "music_free" || name === "free" ? "free" : "base";
    if (!this.ready || !this.ctx || this.ctx.state !== "running" || this.muted) {
      this._pendingMusic = theme;   // доиграем, как только контекст разблокируют
      return;
    }
    this._music = { name: theme };
    this.music.setTheme(theme, { fade });
  }

  stopMusic({ fade = 0.5 } = {}) {
    this._music = null;
    this._pendingMusic = null;
    if (this.music) this.music.stop({ fade });
  }

  /**
   * Состояние музыки: какие слои звучат прямо сейчас.
   *
   * @param {{spinning?:boolean, win?:boolean, tension?:boolean}} state
   */
  setMusicState(state) {
    if (this.music) this.music.setState(state);
  }

  /* ──────────────────────────── громкость ───────────────────────── */

  setVolume(channel, value) {
    this.volumes[channel] = Math.max(0, Math.min(1, value));
    this._applyVolumes();
  }

  setMuted(muted) {
    this.muted = muted;
    this._applyVolumes();
    if (muted) {
      const playing = this._music?.name || this._pendingMusic;
      this.stopMusic({ fade: 0.25 });
      for (const name of [...this._activeLoops.keys()]) this.stopLoop(name);
      this._pendingMusic = playing || null;
    } else {
      // Звук включают тем же нажатием, что и разбудило контекст, поэтому
      // будить его надо здесь же: иначе включённый звук остаётся немым
      // до следующего клика по игре. Музыка возвращается только ПОСЛЕ
      // пробуждения — resume() асинхронный, и вызванный сразу за ним
      // playMusic увидел бы контекст ещё спящим и снова отложил бы тему.
      this._resumeContext().then(() => this._flushPendingMusic());
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _applyVolumes() {
    if (!this._nodes.master) return;
    const t = this.ctx ? this.ctx.currentTime : 0;
    const m = this.muted ? 0 : this.volumes.master;
    this._nodes.master.gain.setTargetAtTime(m, t, 0.02);
    this._nodes.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.02);
    this._nodes.music.gain.setTargetAtTime(this.volumes.music, t, 0.02);
  }

  /* ─────────────────── вкладка на фоне и в фокусе ───────────────── */

  /**
   * Пауза при уходе со вкладки — иначе музыка играет в фоне и злит игрока.
   *
   * Здесь была ошибка, которую стоит помнить: возобновление стояло под
   * условием «если не выключен звук». Игрок, свернувший вкладку с
   * выключённым звуком, получал навсегда усыплённый контекст — включение
   * звука меняло громкость на узле, который больше не тикал, и игра
   * оставалась немой до перезагрузки страницы. Глушение и сон контекста —
   * разные вещи: первое отвечает за громкость, второе за то, идёт ли
   * вообще время. Смешивать их нельзя.
   */
  attachVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else this._resumeContext().then(() => this._flushPendingMusic());
    });
  }

  _resumeContext() {
    if (!this.ctx || !this.unlocked || this.ctx.state === "running") {
      return Promise.resolve();
    }
    return this.ctx.resume().catch(() => {});
  }

  /** Тема, отложенная на время сна контекста, доигрывается при пробуждении. */
  _flushPendingMusic() {
    const pending = this._pendingMusic;
    if (!pending || this.muted) return;
    this._pendingMusic = null;
    this.playMusic(pending);
  }

  /* ───────────────── удобные вызовы для игрового слоя ───────────── */

  /**
   * Панорама по номеру барабана: крайние разведены на ±0.55.
   *
   * Шире делать нельзя — на наушниках барабан начинает звучать сбоку от
   * головы, а он находится на экране перед игроком. Задача панорамы здесь
   * не «стерео», а совпадение слуха с глазами.
   */
  panForReel(index, reels = 5) {
    if (reels <= 1) return 0;
    return ((index / (reels - 1)) * 2 - 1) * 0.55;
  }

  /** Старт вращения: удар и следом бесшовный луп на всё время спина. */
  spinStart({ turbo = false, volume = 1 } = {}) {
    this.play("spin_start", { volume: turbo ? volume * 0.7 : volume });
    this.playLoop("spin", {
      volume: turbo ? 0.34 : 0.42,
      rate: turbo ? 1.18 : 1,
      fade: 0.18,
    });
  }

  /** Конец вращения: луп уходит, воздух стравливается вниз. */
  spinEnd({ volume = 0.7 } = {}) {
    this.stopLoop("spin", { fade: 0.14 });
    this.play("spin_end", { volume });
  }

  /**
   * Барабан встал. index — номер слева направо, от него и высота, и панорама.
   * hard=true для барабана, закрывшего антисипацию.
   */
  reelStop(index, { reels = 5, hard = false, volume = 1 } = {}) {
    const name = hard ? "reel_stop_hard" : `reel_stop_${Math.min(index + 1, 5)}`;
    return this.play(name, { pan: this.panForReel(index, reels), volume });
  }

  /** Символ лёг в ячейку: тот же принцип панорамы, что у барабанов. */
  symbolLand(reel, { reels = 5, volume = 0.5 } = {}) {
    return this.play("symbol_land", { pan: this.panForReel(reel, reels), volume });
  }

  /**
   * Скаттер: count — какой он по счёту в этом спине, начиная с единицы.
   * Каждый следующий выше и тяжелее предыдущего.
   */
  scatter(count = 1, { reel = null, reels = 5, volume = 1 } = {}) {
    const step = Math.max(1, Math.min(4, count));
    return this.play(`scatter_${step}`, {
      volume,
      pan: reel == null ? 0 : this.panForReel(reel, reels) * 0.7,
    });
  }

  /** Барабан пошёл на томление: нарастание плюс музыкальный слой напряжения. */
  anticipationStart({ volume = 1 } = {}) {
    this.setMusicState({ tension: true });
    return this.play("anticipation", { volume });
  }

  /** Томление разрешилось: hit — скаттер сел, иначе барабан встал пустым. */
  anticipationEnd(hit, { volume = 1 } = {}) {
    this.setMusicState({ tension: false });
    return this.play(hit ? "anticipation_hit" : "anticipation_miss", { volume });
  }

  /**
   * Тик счётчика выигрыша. progress 0…1 — доля докрученной суммы.
   * Высота растёт вместе с ней; это и есть «ускорение» на слух.
   */
  countTick(progress = 0, { volume = 0.35 } = {}) {
    const k = Math.max(0, Math.min(1, progress));
    return this.play("tick", { volume, rate: 0.92 + k * 0.95 });
  }

  /** Точка в конце докрутки: без неё счётчик звучит оборванным. */
  countEnd({ volume = 0.6 } = {}) {
    return this.play("count_end", { volume });
  }

  /** Крупный выигрыш: у каждого тира собственный звук. */
  bigWin(tierKey, opts = {}) {
    return this.play(TIER_SOUND[tierKey] || "win_big", opts);
  }

  /** Фоновый шум моря. Включается один раз и живёт, пока не выключат. */
  ambient(on, { volume = 0.22 } = {}) {
    if (on) this.playLoop("ambient", { volume, fade: 1.2 });
    else this.stopLoop("ambient", { fade: 1.2 });
  }
}
