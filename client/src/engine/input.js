// Ввод: pointer-события поверх графа сцены.
//
// Отдельная задача — «нажатие» на мобильном: браузер шлёт click с задержкой
// и иногда дублирует его после touch. Поэтому работаем только с Pointer Events
// и сами гасим повторы.

import { Signal } from "./core.js";
import { Container } from "./display.js";

export class InputManager {
  constructor(renderer) {
    this.renderer = renderer;
    this.canvas = renderer.canvas;
    this.enabled = true;

    this.onPointerDown = new Signal();
    this.onPointerUp = new Signal();
    this.onPointerMove = new Signal();

    this._point = { x: 0, y: 0 };
    this._hover = null;
    this._pressed = null;
    this._activePointerId = null;

    this._down = this._down.bind(this);
    this._up = this._up.bind(this);
    this._move = this._move.bind(this);
    this._cancel = this._cancel.bind(this);

    this.canvas.addEventListener("pointerdown", this._down, { passive: false });
    window.addEventListener("pointerup", this._up);
    window.addEventListener("pointermove", this._move);
    window.addEventListener("pointercancel", this._cancel);

    // Слот — не документ: контекстное меню и выделение только мешают.
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.style.touchAction = "none";
    this.canvas.style.userSelect = "none";
  }

  _hit(clientX, clientY) {
    const p = this.renderer.toStage(clientX, clientY, this._point);
    return this._hitTest(this.renderer.stage, p.x, p.y);
  }

  /**
   * Обход сверху вниз: последний нарисованный узел получает событие первым.
   *
   * Контейнер проверяется и САМ, после своих детей. Раньше этой проверки
   * не было, и любой составной элемент управления оказывался недоступен:
   * попадание искалось только среди листьев. Кнопки работали лишь потому,
   * что Button — это спрайт. А фишка автоигры или кнопка «к списку» —
   * контейнер из подложки и надписи, и по ним нельзя было кликнуть вообще.
   *
   * Проверка безопасна: у обычного контейнера getLocalSize возвращает
   * нулевой размер, поэтому в попадание он не попадёт при всём желании.
   * Реагируют только те, кому размер задали явно.
   */
  _hitTest(node, x, y) {
    if (!node.visible || node.worldAlpha <= 0.01) return null;

    if (node instanceof Container) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const hit = this._hitTest(node.children[i], x, y);
        if (hit) return hit;
      }
      if (node.interactive && node.containsPoint(x, y)) return node;
      return null;
    }

    if (node.interactive && node.containsPoint(x, y)) return node;
    return null;
  }

  _down(e) {
    if (!this.enabled) return;
    if (this._activePointerId !== null) return;   // мультитач игнорируем
    this._activePointerId = e.pointerId;
    e.preventDefault();

    const target = this._hit(e.clientX, e.clientY);
    this._pressed = target;
    if (target) {
      target._isPressed = true;
      if (target.onDown) target.onDown(target);
    }
    this.onPointerDown.emit(this._point.x, this._point.y, target);
  }

  _up(e) {
    if (!this.enabled) return;
    if (e.pointerId !== this._activePointerId) return;
    this._activePointerId = null;

    const target = this._hit(e.clientX, e.clientY);
    const pressed = this._pressed;
    this._pressed = null;

    if (pressed) {
      pressed._isPressed = false;
      if (pressed.onUp) pressed.onUp(pressed);
      // Тап засчитывается, только если палец отпустили на том же узле.
      // Координаты передаются в системе сцены: узлам вроде списка истории
      // нужно знать, по какой именно строке попали.
      if (pressed === target && pressed.onTap) {
        pressed.onTap(pressed, this._point.x, this._point.y);
      }
    }
    this.onPointerUp.emit(this._point.x, this._point.y, target);
  }

  _move(e) {
    if (!this.enabled) return;
    const target = e.pointerType === "mouse" ? this._hit(e.clientX, e.clientY) : null;

    if (target !== this._hover) {
      if (this._hover && this._hover.onOut) this._hover.onOut(this._hover);
      if (this._hover) this._hover._isHover = false;
      this._hover = target;
      if (target) {
        target._isHover = true;
        if (target.onOver) target.onOver(target);
      }
      this.canvas.style.cursor = target ? "pointer" : "default";
    }
    this.onPointerMove.emit(this._point.x, this._point.y, target);
  }

  _cancel(e) {
    if (e.pointerId !== this._activePointerId) return;
    this._activePointerId = null;
    if (this._pressed) {
      this._pressed._isPressed = false;
      if (this._pressed.onUp) this._pressed.onUp(this._pressed);
      this._pressed = null;
    }
  }

  destroy() {
    this.canvas.removeEventListener("pointerdown", this._down);
    window.removeEventListener("pointerup", this._up);
    window.removeEventListener("pointermove", this._move);
    window.removeEventListener("pointercancel", this._cancel);
  }
}
