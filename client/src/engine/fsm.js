// Конечный автомат с ЯВНОЙ таблицей разрешённых переходов.
//
// Раньше состояние игры было обычным полем, которому присваивали строку
// в одиннадцати местах. Такая конструкция не запрещает ничего: спин из
// состояния ошибки, второй показ выигрыша поверх первого, возврат в простой
// из уже закрытой сессии — всё проходит молча и всплывает у игрока как
// «списало ставку, а барабаны не крутились».
//
// Поэтому недопустимый переход БРОСАЕТ. Ошибка в разработке видна сразу
// и на первом же прогоне стенда, а не через месяц в отчёте поддержки.

import { Signal } from "./core.js";

export class StateMachine {
  /**
   * @param opts.initial      начальное состояние
   * @param opts.transitions  { состояние: [куда можно] } — без подстановок
   *                          и без «*»: список пишется целиком, потому что
   *                          именно его и приходится читать при разборе
   *                          инцидента.
   * @param opts.name         имя автомата в тексте ошибки
   */
  constructor({ initial, transitions, name = "fsm" }) {
    this.name = name;
    this.onChange = new Signal();

    this.table = new Map();
    for (const [from, list] of Object.entries(transitions)) {
      this.table.set(from, new Set(list));
    }

    // Опечатка в правой части таблицы иначе живёт до того редкого перехода,
    // на который она приходится, — то есть до продакшена.
    for (const [from, list] of this.table) {
      for (const to of list) {
        if (!this.table.has(to)) {
          throw new Error(`${name}: переход ${from} → ${to} ведёт в состояние, которого нет в таблице`);
        }
      }
    }
    if (!this.table.has(initial)) {
      throw new Error(`${name}: начальное состояние ${initial} отсутствует в таблице`);
    }

    this.current = initial;
    this.previous = null;
  }

  is(state) {
    return this.current === state;
  }

  /** Разрешён ли переход. Переход в текущее состояние разрешён всегда. */
  can(to) {
    if (to === this.current) return true;
    return this.table.get(this.current).has(to);
  }

  /**
   * Выполняет переход.
   *
   * Переход в то же самое состояние — не переход: он ничего не меняет
   * и сигнал не рассылает. Иначе повторное «сессия закрыта» по сокету
   * валило бы игру там, где корректно ничего не делать.
   *
   * @throws если переход не описан в таблице
   */
  to(state, payload = null) {
    if (state === this.current) return this.current;
    if (!this.table.has(state)) {
      throw new Error(`${this.name}: неизвестное состояние ${state}`);
    }
    if (!this.table.get(this.current).has(state)) {
      throw new Error(`${this.name}: запрещённый переход ${this.current} → ${state}`);
    }
    this.previous = this.current;
    this.current = state;
    this.onChange.emit(state, this.previous, payload);
    return state;
  }
}
