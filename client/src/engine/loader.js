// Загрузка ассетов с прогрессом и хранилище кадров.
//
// Прогресс считается по «весу» задач, а не по их количеству: фон весит
// в сотни раз больше, чем JSON, и равномерный счётчик врал бы игроку.

import { Signal } from "./core.js";

export class AssetStore {
  constructor() {
    this.images = new Map();     // name → HTMLImageElement
    this.frames = new Map();     // name → {image, x, y, w, h, slice?, scaleFactor}
    this.json = new Map();
    this.manifest = null;
  }

  frame(name) {
    const f = this.frames.get(name);
    if (!f) throw new Error(`Кадр не найден: ${name}`);
    return f;
  }

  has(name) {
    return this.frames.has(name);
  }
}

export class Loader {
  /**
   * @param opts.fonts начертания для прогрева в формате CSS font; список
   *                    приходит из темы, движок гарнитур не знает.
   *   Список приходит снаружи: движок не должен знать имён гарнитур игры —
   *   иначе смена темы требует правки движка.
   */
  constructor(baseUrl = "assets/", { fonts = [] } = {}) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    this.fonts = fonts;
    this.onProgress = new Signal();
    this.store = new AssetStore();
    this._loaded = 0;
    this._total = 0;
  }

  _tick(weight, label) {
    this._loaded += weight;
    this.onProgress.emit(Math.min(1, this._loaded / this._total), label);
  }

  /**
   * Атласы отдаются с длинным кешем (immutable) — иначе каждый заход
   * перекачивал бы мегабайты. Обратная сторона: после пересборки графики
   * браузер продолжит показывать старые картинки. Поэтому ко всем ассетам
   * подставляется версия сборки из манифеста, а сам манифест кешируется
   * только с перепроверкой.
   */
  _url(path) {
    if (!this.version) return this.baseUrl + path;
    return `${this.baseUrl}${path}${path.includes("?") ? "&" : "?"}v=${this.version}`;
  }

  async loadJson(url, { versioned = true } = {}) {
    const res = await fetch(versioned ? this._url(url) : this.baseUrl + url,
      { cache: versioned ? "force-cache" : "no-cache" });
    if (!res.ok) throw new Error(`Не удалось загрузить ${url}: HTTP ${res.status}`);
    return res.json();
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Не удалось загрузить изображение ${url}`));
      img.src = this._url(url);
    });
  }

  /**
   * Полная загрузка по манифесту.
   * Шрифты ждём отдельно: без них первый кадр покажет текст запасной гарнитурой,
   * а потом дёрнется — на экране загрузки это особенно заметно.
   */
  async loadAll() {
    const store = this.store;

    this._total = 100;
    this._loaded = 0;

    const manifest = await this.loadJson("manifest.json", { versioned: false });
    this.version = manifest.version || "";
    store.manifest = manifest;
    this._tick(3, "манифест");

    // Вес: атласы 30, отдельные картинки 45, шрифты 12, звук — грузится фоном
    const atlasNames = Object.keys(manifest.atlases);
    const imageNames = Object.keys(manifest.images);

    // ── атласы ────────────────────────────────────────────────────
    const atlasWeight = 30 / Math.max(1, atlasNames.length);
    await Promise.all(atlasNames.map(async (key) => {
      const entry = manifest.atlases[key];
      const [data, image] = await Promise.all([
        this.loadJson(entry.json),
        this.loadImage(entry.image)
      ]);
      store.images.set(`atlas:${key}`, image);
      const scaleFactor = manifest.scale[key] || 1;
      for (const [name, f] of Object.entries(data.frames)) {
        store.frames.set(name, {
          image, x: f.x, y: f.y, w: f.w, h: f.h,
          slice: f.slice || null,
          scaleFactor
        });
      }
      this._tick(atlasWeight, `атлас ${key}`);
    }));

    // ── отдельные изображения ────────────────────────────────────
    const imgWeight = 45 / Math.max(1, imageNames.length);
    const scaleImages = manifest.scale.images || 1;
    await Promise.all(imageNames.map(async (name) => {
      const entry = manifest.images[name];
      const image = await this.loadImage(entry.file);
      store.images.set(name, image);
      store.frames.set(name, {
        image, x: 0, y: 0, w: entry.w, h: entry.h,
        slice: null,
        scaleFactor: scaleImages
      });
      this._tick(imgWeight, name);
    }));

    // ── шрифты ────────────────────────────────────────────────────
    await this.loadFonts();
    this._tick(12, "шрифты");

    // остаток отдаём звуку, который догружается уже после старта
    this._loaded = Math.max(this._loaded, 90);
    this.onProgress.emit(0.9, "звук");

    return store;
  }

  /**
   * Прогрев начертаний. Без него первый кадр рисуется запасной гарнитурой,
   * а потом весь текст дёргается — на экране загрузки это особенно заметно.
   */
  async loadFonts() {
    if (!document.fonts) return;
    try {
      await document.fonts.ready;
      await Promise.all(this.fonts.map((f) => document.fonts.load(f)));
    } catch {
      // Шрифт не загрузился — не повод ронять игру: сработает запасная гарнитура.
    }
  }
}
