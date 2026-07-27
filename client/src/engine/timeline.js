// Таймлайн: задержки, последовательности, параллельные группы, отмена.
//
// Единственная причина, по которой это не setTimeout: таймеры браузера
// живут в своём времени. Они не останавливаются, когда лобби прислало
// команду паузы, продолжают тикать в фоновой вкладке (где их ещё и душат
// до одного раза в секунду) и ничего не знают про турбо-режим. Из-за
// этого пауза посреди показа выигрыша раньше замораживала картинку, но
// не последовательность: она доигрывалась «за кадром», и игрок возвращался
// к уже законченной сцене.
//
// Таймлайн двигают снаружи вызовом update(dt) с тем же dt, что получают
// твины. На паузе dt равен нулю — и время просто стоит.

/**
 * Шаг последовательности — одно из трёх:
 *   число      задержка в секундах;
 *   функция    вызывается; если вернула thenable — ожидается;
 *   thenable   ожидается как есть.
 */
export class Timeline {
  constructor() {
    this.time = 0;
    this._waits = [];
  }

  update(dt) {
    if (dt <= 0) return;
    this.time += dt;

    const list = this._waits;
    for (let i = list.length - 1; i >= 0; i--) {
      const w = list[i];
      w.left -= dt;
      if (w.left > 0) continue;
      list.splice(i, 1);
      w.resolve(true);
    }
  }

  /**
   * Пауза в игровом времени.
   *
   * @returns промис, который разрешается `true` по истечении срока и
   *   `false`, если ожидание отменили. У промиса есть метод cancel():
   *   отменённое ожидание разрешается сразу, поэтому await не повисает,
   *   а вызывающий по значению отличает завершение от отмены.
   */
  wait(seconds) {
    if (!(seconds > 0)) return withCancel(Promise.resolve(true), () => {});
    let entry;
    const promise = new Promise((resolve) => {
      entry = { left: seconds, resolve };
      this._waits.push(entry);
    });
    return withCancel(promise, () => this._drop(entry));
  }

  _drop(entry) {
    const i = this._waits.indexOf(entry);
    if (i < 0) return;
    this._waits.splice(i, 1);
    entry.resolve(false);
  }

  /** Шаги идут строго по очереди; отмена прекращает цепочку на текущем шаге. */
  sequence(steps) {
    const scope = { cancelled: false, inner: null };
    const run = async () => {
      for (const step of steps) {
        if (scope.cancelled) return false;
        const ok = await this._step(step, scope);
        if (ok === false || scope.cancelled) return false;
      }
      return true;
    };
    return withCancel(run(), () => cancelScope(scope));
  }

  /** Шаги стартуют разом; группа завершается по самому долгому. */
  parallel(steps) {
    const scope = { cancelled: false, inner: null, all: [] };
    const run = async () => {
      const results = await Promise.all(steps.map((s) => this._step(s, scope)));
      return !scope.cancelled && results.every((r) => r !== false);
    };
    return withCancel(run(), () => cancelScope(scope));
  }

  async _step(step, scope) {
    if (typeof step === "number") {
      const w = this.wait(step);
      scope.inner = w;
      if (scope.all) scope.all.push(w);
      const ok = await w;
      scope.inner = null;
      return ok;
    }
    if (typeof step === "function") {
      const r = step();
      return r && typeof r.then === "function" ? await r : true;
    }
    if (step && typeof step.then === "function") return await step;
    return true;
  }

  /** Снимает все текущие ожидания — например, при уходе со сцены. */
  cancelAll() {
    const list = this._waits.slice();
    this._waits.length = 0;
    for (const w of list) w.resolve(false);
  }
}

function withCancel(promise, cancel) {
  promise.cancel = cancel;
  return promise;
}

function cancelScope(scope) {
  scope.cancelled = true;
  if (scope.inner?.cancel) scope.inner.cancel();
  if (scope.all) for (const w of scope.all) w.cancel?.();
}
