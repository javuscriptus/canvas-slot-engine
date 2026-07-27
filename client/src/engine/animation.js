// Покадровая анимация: спрайт-листы, клипы, AnimatedSprite.
//
// Движок умел двигать узлы твинами и не умел ничего покадрового. Всё
// «живое» — блик на воде, взмах крыла, мигание рамки — приходилось
// изображать твинами прозрачности, и это видно: твин даёт плавность там,
// где рисованная анимация даёт характер.
//
// Клип не хранит картинок — только ссылки на кадры атласа. Поэтому
// анимация ничего не стоит по памяти и переключается без пересборки.

import { Signal } from "./core.js";
import { Sprite } from "./display.js";
import { NodeType } from "./render/drawables.js";

/**
 * Спрайт-лист: упорядоченный набор кадров.
 *
 * Кадр — тот же объект {image, x, y, w, h}, что отдаёт загрузчик, поэтому
 * анимацию можно собрать и из отдельных кадров атласа, и нарезкой одной
 * большой картинки.
 */
export class SpriteSheet {
  constructor(frames, { scaleFactor = 1 } = {}) {
    if (!frames.length) throw new Error("SpriteSheet: пустой набор кадров");
    this.frames = frames;
    this.scaleFactor = scaleFactor;
  }

  get length() {
    return this.frames.length;
  }

  frame(index) {
    return this.frames[index];
  }

  /**
   * Нарезка равномерной сетки из одного кадра атласа.
   * @param count сколько кадров реально занято — последний ряд обычно неполный.
   */
  static fromGrid(frame, cols, rows, count = cols * rows, scaleFactor = frame.scaleFactor || 1) {
    const w = Math.floor(frame.w / cols);
    const h = Math.floor(frame.h / rows);
    const frames = [];
    for (let i = 0; i < count; i++) {
      frames.push({
        image: frame.image,
        x: frame.x + (i % cols) * w,
        y: frame.y + Math.floor(i / cols) * h,
        w, h
      });
    }
    return new SpriteSheet(frames, { scaleFactor });
  }

  /** Кадры по именам в атласе: «gull_1» … «gull_8». */
  static fromNames(store, names, scaleFactor = 1) {
    return new SpriteSheet(names.map((n) => store.frame(n)), { scaleFactor });
  }
}

/**
 * Клип: диапазон кадров листа, скорость и режим зацикливания.
 *
 * `events` привязывает имена к номерам кадров: звук удара обязан звучать
 * ровно на том кадре, где удар нарисован, а не через фиксированную
 * задержку от начала — иначе при смене скорости они разъезжаются.
 */
export class Clip {
  constructor(name, { sheet, from = 0, to = sheet.length - 1, fps = 24, loop = true, events = null } = {}) {
    this.name = name;
    this.sheet = sheet;
    this.from = from;
    this.to = to;
    this.fps = fps;
    this.loop = loop;
    this.events = events;         // { номер кадра: имя события }
  }

  get length() {
    return this.to - this.from + 1;
  }
}

/**
 * Спрайт, кадр которого меняется по времени.
 *
 * Обновляется не сам: как и твины, он живёт в наборе, который двигают
 * с общим dt. Из-за этого он бесплатно уважает паузу и турбо-режим —
 * ускорять анимации отдельным механизмом не нужно.
 */
export class AnimatedSprite extends Sprite {
  constructor({ clips = [], manager = null, autoPlay = null, speed = 1 } = {}) {
    super(null, 1);
    this.nodeType = NodeType.ANIMATED_SPRITE;

    this.clips = new Map();
    for (const clip of clips) this.clips.set(clip.name, clip);

    this.clip = null;
    this.frameIndex = 0;
    this.speed = speed;
    this.playing = false;
    this.manager = manager;

    this.onFrame = new Signal();       // (номер кадра, имя клипа)
    this.onEvent = new Signal();       // (имя события, номер кадра)
    this.onComplete = new Signal();    // (имя клипа) — только для незацикленных

    this._acc = 0;
    if (manager) manager.add(this);
    if (autoPlay) this.play(autoPlay);
  }

  addClip(clip) {
    this.clips.set(clip.name, clip);
    return this;
  }

  /** @param restart false — повторный play того же клипа не сбрасывает кадр. */
  play(name, { restart = true } = {}) {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Клип не найден: ${name}`);
    if (this.clip === clip && !restart) {
      this.playing = true;
      return this;
    }
    this.clip = clip;
    this.playing = true;
    this._acc = 0;
    this._applyFrame(0);
    return this;
  }

  stop() {
    this.playing = false;
    return this;
  }

  /** Останов на конкретном кадре — для «замороженных» состояний. */
  gotoAndStop(index) {
    this.playing = false;
    this._applyFrame(index);
    return this;
  }

  update(dt) {
    if (!this.playing || !this.clip) return;
    const clip = this.clip;
    this._acc += dt * clip.fps * this.speed;
    if (this._acc < 1) return;

    const advance = Math.floor(this._acc);
    this._acc -= advance;
    let next = this.frameIndex + advance;

    if (next >= clip.length) {
      if (clip.loop) {
        next %= clip.length;
      } else {
        next = clip.length - 1;
        this.playing = false;
        this._applyFrame(next);
        this.onComplete.emit(clip.name);
        return;
      }
    }
    this._applyFrame(next);
  }

  _applyFrame(index) {
    const clip = this.clip;
    if (!clip) return;
    this.frameIndex = index;
    const frame = clip.sheet.frame(clip.from + index);
    if (frame) this.setFrame(frame, clip.sheet.scaleFactor);
    this.onFrame.emit(index, clip.name);
    const event = clip.events?.[index];
    if (event) this.onEvent.emit(event, index);
  }
}

/**
 * Набор анимаций, который двигают одним вызовом.
 *
 * Тот же приём, что у TweenManager: обход дерева сцены ради поиска
 * анимированных узлов стоил бы дороже самой анимации.
 */
export class AnimationSet {
  constructor() {
    this.items = [];
  }

  add(sprite) {
    if (!this.items.includes(sprite)) this.items.push(sprite);
    return sprite;
  }

  remove(sprite) {
    const i = this.items.indexOf(sprite);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear() {
    this.items.length = 0;
  }

  update(dt) {
    if (dt <= 0) return;
    for (let i = 0; i < this.items.length; i++) this.items[i].update(dt);
  }
}
