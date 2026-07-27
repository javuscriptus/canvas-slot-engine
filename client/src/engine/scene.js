// Сцены и переключение между ними.
//
// Сцена — это кусок игры со своим содержимым и своим временем жизни:
// заставка, игровой экран, экран бонуса. Без неё всё это живёт в одном
// объекте, а «уйти с заставки» превращается в набор ручных visible = false
// по всему графу — и каждый забытый узел остаётся висеть.
//
// Менеджер держит ровно одну активную сцену. Переход между ними —
// затемнение через собственную заслонку: она принадлежит менеджеру,
// чтобы сцена не обязана была знать, кто и как её сменяет.

import { Signal } from "./core.js";
import { Container, Rect } from "./display.js";

export class Scene extends Container {
  constructor(name) {
    super();
    this.name = name;
    this.app = null;
  }

  /** Вызывается после того, как сцена добавлена в граф. */
  onEnter(_params) {}

  /** Вызывается перед удалением из графа: снять подписки, остановить звук. */
  onExit() {}

  /** Игровое время сцены; на паузе dt равен нулю. */
  update(_dt) {}

  /** Смена ориентации или размера окна. */
  onLayout(_layout) {}
}

export class SceneManager {
  /**
   * @param curtainColor цвет заслонки перехода. Своего цвета у менеджера
   *   нет: чёрный занавес поверх светлой игры — такое же оформительское
   *   решение, как и любое другое, и принимать его должна тема.
   */
  constructor(app, curtainColor = null) {
    this.app = app;
    this.root = new Container();
    this.current = null;
    this.onChange = new Signal();
    this._factories = new Map();

    // Заслонка перехода лежит поверх сцены и по умолчанию невидима.
    this.curtain = new Rect(0, 0, curtainColor);
    this.curtain.alpha = 0;
    this.curtain.visible = false;
    this.root.add(this.curtain);
  }

  register(name, factory) {
    this._factories.set(name, factory);
    return this;
  }

  has(name) {
    return this._factories.has(name);
  }

  /**
   * @param opts.fade длительность затемнения в секундах; 0 — мгновенно.
   *
   * Переход именно асинхронный: пока идёт затемнение, старая сцена ещё
   * жива и продолжает обновляться. Сносить её сразу означало бы моргание
   * пустым экраном на всю длительность перехода.
   */
  async goto(name, { params = null, fade = 0 } = {}) {
    const factory = this._factories.get(name);
    if (!factory) throw new Error(`Сцена не зарегистрирована: ${name}`);

    if (fade > 0) await this._fade(1, fade);

    const previous = this.current;
    if (previous) {
      previous.onExit();
      this.root.remove(previous);
      previous.app = null;
    }

    const scene = factory(this.app, params);
    scene.app = this.app;
    this.current = scene;
    // Сцена уходит ПОД заслонку: иначе она проявится поверх затемнения.
    this.root.addAt(scene, 0);
    scene.onEnter(params);
    if (this.app?.viewport?.layout) scene.onLayout(this.app.viewport.layout);
    this.onChange.emit(name, previous?.name || null);

    if (fade > 0) await this._fade(0, fade);
    return scene;
  }

  update(dt) {
    if (this.current) this.current.update(dt);
  }

  onLayout(layout) {
    this.curtain.width = layout.width;
    this.curtain.height = layout.height;
    if (this.current) this.current.onLayout(layout);
  }

  _fade(to, duration) {
    this.curtain.visible = true;
    return new Promise((resolve) => {
      this.app.tweens.to(this.curtain, { alpha: to }, {
        duration,
        onComplete: () => {
          this.curtain.visible = to > 0;
          resolve();
        }
      });
    });
  }
}
