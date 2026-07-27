// Application: владелец холста, тикера, рендера, ввода, времени и сцен.
//
// До этого кадровый цикл был методом игрового класса: он же держал тикер,
// он же вызывал render(), он же решал, что значит «пауза». Любая вторая
// игра на этом движке начиналась с копирования сорока строк оркестровки —
// то есть движка в ней не было, был исходник, который правят под себя.
//
// Здесь собрано ровно то, что одинаково у любой игры, и ничего сверх.
// Порядок кадра фиксирован и объяснён в _frame.

import { Ticker, Signal } from "./core.js";
import { Renderer, ViewportManager } from "./render/renderer.js";
import { InputManager } from "./input.js";
import { TweenManager } from "./tween.js";
import { Timeline } from "./timeline.js";
import { AnimationSet } from "./animation.js";
import { SceneManager } from "./scene.js";
import { LayerStack } from "./layers.js";

export class Application {
  /**
   * @param opts.canvas        холст игры
   * @param opts.container     элемент, по размеру которого живёт холст
   * @param opts.buildLayout   (vw, vh) => layout; без него ресайзом
   *                           управляет вызывающий
   * @param opts.layers        имена слоёв сцены снизу вверх
   * @param opts.backend       "auto" | "canvas2d"
   */
  constructor({
    canvas,
    container = null,
    designWidth,
    designHeight,
    backgroundColor = null,
    transparent = false,
    maxDPR = 2,
    backend = "auto",
    buildLayout = null,
    layers = []
  }) {
    this.renderer = new Renderer(canvas, {
      designWidth, designHeight, maxDPR, backgroundColor, transparent, backend
    });
    this.ticker = new Ticker();
    this.input = new InputManager(this.renderer);
    this.tweens = new TweenManager();
    this.timeline = new Timeline();
    this.animations = new AnimationSet();
    // Заслонка переходов красится тем же цветом, что и подложка холста:
    // это единственный цвет, который движку сообщают снаружи.
    this.scenes = new SceneManager(this, backgroundColor);

    // Слои создаются, только если их заказали: игра вправе строить граф
    // руками, и пустая стопка контейнеров ей не нужна.
    this.layers = layers.length ? new LayerStack(layers) : null;
    if (this.layers) this.stage.add(this.layers);
    this.stage.add(this.scenes.root);

    this.viewport = buildLayout && container
      ? new ViewportManager(this.renderer, { build: buildLayout, container })
      : null;
    if (this.viewport) {
      this.viewport.onOrientationChange.add((_o, layout) => {
        this.scenes.onLayout(layout);
        this.onLayout.emit(layout);
      });
    }

    this.paused = false;
    this.onUpdate = new Signal();       // (dt игры, dt реального времени)
    this.onLayout = new Signal();
    this.onPauseChange = new Signal();

    this._frame = this._frame.bind(this);
    this.ticker.onTick.add(this._frame);
  }

  get stage() {
    return this.renderer.stage;
  }

  get layout() {
    return this.viewport?.layout || null;
  }

  /** Применяет текущий размер окна и запускает кадровый цикл. */
  start() {
    if (this.viewport) this.viewport.apply();
    this.ticker.start();
    return this;
  }

  stop() {
    this.ticker.stop();
    return this;
  }

  /**
   * Пауза.
   *
   * Тикер продолжает идти и сцена продолжает рисоваться — иначе окно
   * лобби показывалось бы поверх замёрзшего последнего кадра, а при
   * возврате картинка дёргалась бы. Останавливается ВРЕМЯ: твины,
   * таймлайн, анимации и обновление игры получают нулевой dt.
   */
  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.input.enabled = !paused;
    this.onPauseChange.emit(paused);
  }

  _frame(rawDt) {
    const dt = this.paused ? 0 : rawDt;

    // Порядок важен: таймлайн может запустить твин, твин — досчитать
    // значение, которое читает игра, и только потом игра решает, что
    // показывать. Отрисовка последняя и одна на кадр.
    this.timeline.update(dt);
    this.tweens.update(dt);
    this.animations.update(dt);
    this.scenes.update(dt);
    this.onUpdate.emit(dt, rawDt);
    this.renderer.render();
  }

  destroy() {
    this.ticker.stop();
    this.ticker.onTick.remove(this._frame);
    this.input.destroy();
    this.viewport?.destroy();
    this.tweens.cancelAll();
    this.timeline.cancelAll();
    this.animations.clear();
    this.renderer.destroy();
  }
}
