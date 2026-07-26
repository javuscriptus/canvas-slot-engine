// Звук на Web Audio API.
//
// Три вещи, которые ломают звук в казино-играх на мобильных, и как они решены:
//   1. iOS/Android не дают запустить контекст без жеста пользователя →
//      unlock() навешивается на первый touch/click и возобновляет контекст.
//   2. Отдельные файлы на каждый эффект дают задержку и десятки запросов →
//      все SFX лежат в одном спрайте и декодируются один раз.
//   3. Переключение базовой игры и фриспинов рывком слышно →
//      музыка меняется кроссфейдом.

const SPRITE_GUARD = 0.012;   // подрезаем хвост, чтобы не цеплять соседний эффект

export class AudioManager {
  constructor({ baseUrl = "assets/audio/", enabled = true, version = "" } = {}) {
    this.baseUrl = baseUrl;
    this.version = version;
    this.ctx = null;
    this.ready = false;
    this.unlocked = false;

    this.sprite = null;
    this.spriteBuffer = null;
    this.musicBuffers = new Map();

    this.volumes = { master: 0.8, sfx: 1.0, music: 0.45 };
    this.muted = !enabled;

    this._nodes = {};
    this._music = null;           // {source, gain, name}
    this._loading = null;
    this._pendingMusic = null;
    this._failed = false;
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

    // Лёгкая компрессия: при совпадении фанфары, монет и музыки
    // суммарный сигнал уходит в клиппинг и начинает хрипеть.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    sfx.connect(master);
    music.connect(master);
    master.connect(comp);
    comp.connect(this.ctx.destination);

    this._nodes = { master, sfx, music, comp };
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
        if (this._pendingMusic) {
          const name = this._pendingMusic;
          this._pendingMusic = null;
          this.playMusic(name);
        }
      }
    };
    element.addEventListener("pointerdown", unlock);
    element.addEventListener("touchend", unlock);
    element.addEventListener("keydown", unlock);
  }

  /* ──────────────────────────── загрузка ────────────────────────── */

  /** Формат выбирается один раз: Opus меньше, но старые iOS его не играют. */
  _ext() {
    const a = document.createElement("audio");
    return a.canPlayType('audio/webm; codecs="opus"') ? "webm" : "mp3";
  }

  async load(onProgress = () => {}) {
    if (this._loading) return this._loading;
    this._loading = this._doLoad(onProgress);
    return this._loading;
  }

  async _doLoad(onProgress) {
    this._createContext();
    if (!this.ctx) return;

    const ext = this._ext();
    try {
      const v = this.version ? `?v=${this.version}` : "";
      const spriteMeta = await fetch(`${this.baseUrl}sfx.json${v}`).then((r) => r.json());
      this.sprite = spriteMeta.sprite;

      const files = [
        ["sfx", `${this.baseUrl}sfx.${ext}${v}`],
        ["music_base", `${this.baseUrl}music_base.${ext}${v}`],
        ["music_free", `${this.baseUrl}music_free.${ext}${v}`]
      ];

      let done = 0;
      await Promise.all(files.map(async ([key, url]) => {
        const buf = await fetch(url).then((r) => r.arrayBuffer());
        const decoded = await this._decode(buf);
        if (key === "sfx") this.spriteBuffer = decoded;
        else this.musicBuffers.set(key, decoded);
        done++;
        onProgress(done / files.length);
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

  /* ─────────────────────────── воспроизведение ──────────────────── */

  /**
   * Проигрывает эффект из спрайта.
   * @param {string} name
   * @param {{volume?:number, rate?:number, delay?:number}} opts
   */
  play(name, opts = {}) {
    if (!this.ready || this.muted || this._failed || !this.ctx) return null;
    if (this.ctx.state !== "running") return null;

    const entry = this.sprite?.[name];
    if (!entry) return null;

    const [startMs, durMs] = entry;
    const src = this.ctx.createBufferSource();
    src.buffer = this.spriteBuffer;
    src.playbackRate.value = opts.rate ?? 1;

    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain);
    gain.connect(this._nodes.sfx);

    const when = this.ctx.currentTime + (opts.delay ?? 0);
    const duration = Math.max(0.02, durMs / 1000 - SPRITE_GUARD) / (opts.rate ?? 1);
    src.start(when, startMs / 1000, duration);
    return src;
  }

  /** Останавливает конкретный источник, полученный из play(). */
  stopSource(src) {
    if (!src) return;
    try { src.stop(); } catch { /* уже завершился */ }
  }

  /* ──────────────────────────── музыка ──────────────────────────── */

  playMusic(name, { fade = 0.8 } = {}) {
    if (this._failed) return;
    if (!this.ready || !this.ctx || this.ctx.state !== "running") {
      this._pendingMusic = name;   // доиграем, как только контекст разблокируют
      return;
    }
    if (this._music?.name === name) return;

    const buffer = this.musicBuffers.get(name);
    if (!buffer) return;

    const now = this.ctx.currentTime;
    const old = this._music;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    gain.connect(this._nodes.music);
    src.start(now);

    this._music = { source: src, gain, name };

    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
      setTimeout(() => {
        try { old.source.stop(); } catch { /* уже остановлен */ }
      }, fade * 1000 + 120);
    }
  }

  stopMusic({ fade = 0.5 } = {}) {
    if (!this._music || !this.ctx) return;
    const now = this.ctx.currentTime;
    const m = this._music;
    this._music = null;
    m.gain.gain.cancelScheduledValues(now);
    m.gain.gain.setValueAtTime(m.gain.gain.value, now);
    m.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
    setTimeout(() => {
      try { m.source.stop(); } catch { /* уже остановлен */ }
    }, fade * 1000 + 120);
  }

  /* ──────────────────────────── громкость ───────────────────────── */

  setVolume(channel, value) {
    this.volumes[channel] = Math.max(0, Math.min(1, value));
    this._applyVolumes();
  }

  setMuted(muted) {
    this.muted = muted;
    this._applyVolumes();
    if (muted) this.stopMusic({ fade: 0.25 });
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

  /** Пауза при уходе со вкладки — иначе музыка играет в фоне и злит игрока. */
  attachVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.ctx.suspend().catch(() => {});
      } else if (!this.muted) {
        this.ctx.resume().catch(() => {});
      }
    });
  }
}
