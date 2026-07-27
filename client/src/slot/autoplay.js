// Автоигра: серия спинов с ограничителями.
//
// Отдельный модуль, а не часть автомата раунда. Автомат отвечает на вопрос
// «что сейчас происходит с деньгами», автоигра — на вопрос «нужно ли
// крутить снова»; смешивать их значит получить состояние «спин, но не по
// нажатию игрока», которого в правилах раунда нет.
//
// Предел потерь и порог выигрыша обязательны в ряде юрисдикций (UKGC, MGA,
// Spelinspektionen): автоигру без возможности задать предел потерь там
// не сертифицируют.

import { Signal } from "../engine/core.js";

export class Autoplay {
  constructor({ machine, timeline, timings }) {
    this.machine = machine;
    this.timeline = timeline;
    this.timings = timings;

    this.left = 0;
    this.lossLimit = 0;
    this.winLimit = 0;
    this.net = 0;
    this.stopOnFeature = true;

    this.onCount = new Signal();     // (осталось)
    this.onStopped = new Signal();   // (причина, значение) — для сообщения игроку

    machine.onRoundEnd.add((round) => this._afterRound(round));
  }

  get running() {
    return this.left > 0;
  }

  /**
   * @param opts.lossLimit серия останавливается, когда суммарный минус
   *   за неё достигает этой суммы. 0 — без лимита.
   * @param opts.winLimit  останов при выигрыше за один раунд не меньше
   *   этой суммы. 0 — без лимита.
   */
  start(count, { lossLimit = 0, winLimit = 0 } = {}) {
    this.left = count;
    this.lossLimit = lossLimit;
    this.winLimit = winLimit;
    // Считаем от начала серии, а не от начала сессии: игрок задаёт лимит
    // именно на эту серию, и накопленный ранее минус в него не входит.
    this.net = 0;
    this.onCount.emit(count);
    if (this.machine.state === "idle") this.machine.spin();
  }

  stop() {
    if (this.left === 0) return;
    this.left = 0;
    this.onCount.emit(0);
  }

  _afterRound({ bet = 0, win = 0, afterFeature = false } = {}) {
    if (this.left <= 0) return;

    // Учёт ведётся по завершённому раунду: у бонусного раунда ставка одна,
    // а выигрыш приходит после всех фриспинов, поэтому считать по спинам
    // было бы неверно.
    // Округление до копейки на каждом шаге: без него сумма сотен раундов
    // накапливает погрешность double и лимит срабатывает не там, где надо.
    this.net = Math.round((this.net + win - bet) * 100) / 100;

    if (this.winLimit > 0 && win >= this.winLimit) return this._halt("win", win);
    if (this.lossLimit > 0 && -this.net >= this.lossLimit) return this._halt("loss", -this.net);
    if (afterFeature && this.stopOnFeature) return this._halt("feature");

    // Раунд, который только что закончился, и есть один из заказанных.
    // Раньше счётчик уменьшался ПОСЛЕ проверки «ещё крутить?», и серия
    // на 10 спинов давала одиннадцать.
    this.left--;
    this.onCount.emit(this.left);
    if (this.left <= 0) return;

    // Пауза от лобби обязана останавливать и промежуток между спинами,
    // иначе серия продолжает крутиться за закрытым модальным окном.
    const gap = this.machine.turbo ? this.timings.autoplayGapTurbo : this.timings.autoplayGap;
    this.timeline.wait(gap).then((ok) => {
      if (!ok || this.left <= 0) return;
      if (this.machine.state === "idle") this.machine.spin();
    });
  }

  _halt(reason, value) {
    this.stop();
    this.onStopped.emit(reason, value);
  }
}
