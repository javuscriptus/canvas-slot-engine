// Послойная музыка.
//
// Готовый микс умеет ровно две вещи: играть и не играть. Слот требует
// третьей — реагировать на то, что происходит на барабанах. Поэтому тема
// приезжает не одним файлом, а стемами: подложка (гитара, бас, аккордеон,
// море), перкуссия и мелодия. Плюс общий на обе темы слой напряжения.
//
//   ничего не происходит   подложка
//   барабаны крутятся      + перкуссия
//   есть выигрыш           + мелодия
//   антисипация            + напряжение
//   фриспины               другая тема, те же правила
//
// Два условия, без которых это не работает.
//
// Первое: все стемы темы стартуют ОДНОВРЕМЕННО и играют всегда, включаясь
// и выключаясь только громкостью. Запуск источника «когда понадобился»
// попадает в произвольную точку такта, и слой входит мимо доли — слышно
// сразу и звучит как ошибка воспроизведения.
//
// Второе: слой включается на ГРАНИЦЕ ТАКТА. Ровно поэтому синтез отдаёт
// петлю длиной в целое число тактов, а не подрезанную кроссфейдом:
// границу такта надо уметь вычислить, а не угадать.

/** Плавность включения слоя. Меньше — слышен рывок, больше — слой «всплывает». */
const LAYER_FADE = 0.35;

// Стемы моно, ширина собирается здесь. Развести слои по панораме дешевле,
// чем возить стерео с диска: моно-файл вдвое легче, а картина в наушниках
// получается шире, потому что разведение делается осознанно, а не
// задержкой Хааса по всему миксу.
const LAYER_PAN = { bed: 0, perc: -0.16, lead: 0.2, tension: 0 };

export class MusicDirector {
  /**
   * @param {{ctx:AudioContext, destination:AudioNode,
   *          decode:function(ArrayBuffer):Promise<AudioBuffer>,
   *          url:function(string):string}} bus
   */
  constructor(bus) {
    this.bus = bus;
    this.meta = null;
    this.buffers = new Map();     // имя файла → AudioBuffer

    this.theme = null;
    this.state = { spinning: false, win: false, tension: false };

    this._voices = new Map();     // слой → {source, gain, target}
    this._startedAt = 0;          // момент запуска текущего набора
    this._bar = 2.4;
    this._loop = 19.2;
  }

  get playing() {
    return this._voices.size > 0;
  }

  /** Грузит все стемы, описанные в разделе music из sfx.json. */
  async load(meta) {
    if (!meta) return;
    this.meta = meta;
    this._bar = meta.bar || this._bar;
    this._loop = meta.loop || this._loop;

    const files = new Set();
    for (const layers of Object.values(meta.themes || {})) {
      for (const file of Object.values(layers)) files.add(file);
    }
    if (meta.tension) files.add(meta.tension.file);

    await Promise.all([...files].map(async (file) => {
      const raw = await fetch(this.bus.url(file)).then((r) => r.arrayBuffer());
      this.buffers.set(file, await this.bus.decode(raw));
    }));
  }

  /* ─────────────────────────── темы ─────────────────────────────── */

  /**
   * Переключает тему. Новый набор стартует на границе такта старого —
   * так смена базовой игры на фриспины попадает в долю, а не режет фразу
   * посередине. Первая тема стартует немедленно: ждать нечего.
   */
  setTheme(name, { fade = 0.8 } = {}) {
    if (!this.meta || this.theme === name) return;
    const layers = this.meta.themes?.[name];
    if (!layers) return;

    const now = this.bus.ctx.currentTime;
    const at = this.playing ? this._nextBar(now + 0.05) : now + 0.02;

    const old = this._voices;
    const wanted = this._wanted();
    this._voices = new Map();
    this.theme = name;
    this._startedAt = at;

    for (const [layer, file] of Object.entries(layers)) {
      this._start(layer, file, at, this._loop, !!wanted[layer], fade);
    }
    if (this.meta.tension) {
      this._start("tension", this.meta.tension.file, at,
        this.meta.tension.dur, wanted.tension, fade);
    }

    for (const voice of old.values()) this._fadeOut(voice, at, fade);
  }

  stop({ fade = 0.5 } = {}) {
    const now = this.bus.ctx.currentTime;
    for (const voice of this._voices.values()) this._fadeOut(voice, now, fade);
    this._voices = new Map();
    this.theme = null;
  }

  /* ──────────────────────────── слои ────────────────────────────── */

  /**
   * Что звучит сейчас. Поля необязательны: переданные меняются,
   * остальные сохраняются.
   *
   * @param {{spinning?:boolean, win?:boolean, tension?:boolean}} patch
   */
  setState(patch = {}) {
    Object.assign(this.state, patch);
    if (!this.playing) return;
    // Ровно граница такта, без запаса: слой должен войти на долю, а не
    // рядом с ней. Если до границы меньше времени, чем длится кроссфейд,
    // подъём начнётся чуть раньше доли и закончится сразу после неё —
    // на слух это и есть «вошёл вовремя».
    this._applyState(this._nextBar(this.bus.ctx.currentTime), LAYER_FADE);
  }

  _wanted() {
    return {
      bed: true,
      perc: !!(this.state.spinning || this.state.win),
      lead: !!this.state.win,
      tension: !!this.state.tension,
    };
  }

  _applyState(at, fade) {
    const wanted = this._wanted();
    for (const [layer, voice] of this._voices) {
      this._ramp(voice, wanted[layer] ? 1 : 0, at, fade);
    }
  }

  /* ──────────────────────── внутреннее ──────────────────────────── */

  _start(layer, file, at, loopEnd, audible, fade) {
    const buffer = this.buffers.get(file);
    if (!buffer) return;

    const gain = this.bus.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    if (audible) gain.gain.linearRampToValueAtTime(1, at + fade);

    const source = this.bus.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    // Точка петли берётся из метаданных синтеза, а не из длины буфера.
    // MP3-декодер добавляет в конец потока собственный отступ — от
    // десятков до сотен миллисекунд, и у разных слоёв он разный.
    // Петля по длине буфера развела бы слои уже на втором круге.
    source.loopEnd = Math.min(loopEnd, buffer.duration);

    let out = gain;
    const pan = LAYER_PAN[layer] ?? 0;
    if (pan && this.bus.ctx.createStereoPanner) {
      const panner = this.bus.ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      out = panner;
    }
    source.connect(gain);
    out.connect(this.bus.destination);
    source.start(at);

    this._voices.set(layer, { source, gain, out, target: audible ? 1 : 0 });
  }

  /**
   * Кроссфейд слоя.
   *
   * Уровень, от которого начинается подъём, берётся из собственной
   * бухгалтерии, а не из gain.value: значение параметра читается «сейчас»,
   * а рампа планируется на границу такта — до неё ещё до двух с лишним
   * секунд, и прочитанное сейчас значение к тому моменту уже неверно.
   */
  _ramp(voice, target, at, fade) {
    if (voice.target === target) return;
    const from = voice.target;
    voice.target = target;

    const g = voice.gain.gain;
    const start = Math.max(this.bus.ctx.currentTime, at - fade * 0.5);
    g.cancelScheduledValues(start);
    g.setValueAtTime(Math.max(0.0001, from), start);
    g.linearRampToValueAtTime(Math.max(0.0001, target), start + fade);
  }

  _fadeOut(voice, at, fade) {
    const g = voice.gain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(Math.max(0.0001, voice.target), at);
    g.linearRampToValueAtTime(0.0001, at + fade);
    try { voice.source.stop(at + fade + 0.05); } catch { /* уже остановлен */ }
    voice.source.onended = () => {
      try { voice.out.disconnect(); } catch { /* уже отключён */ }
    };
  }

  /** Ближайшая граница такта не раньше момента t. */
  _nextBar(t) {
    if (!this._startedAt) return t;
    const k = Math.ceil((t - this._startedAt) / this._bar);
    return this._startedAt + Math.max(0, k) * this._bar;
  }
}
