// Именованные слои сцены с фиксированным порядком отрисовки.
//
// До этого порядок задавался одним длинным stage.add(...) в конструкторе
// игры: чтобы понять, окажется ли новый оверлей выше панели управления,
// приходилось искать это перечисление и считать позиции. Любая вставка
// в середину — правка списка, а не объявление намерения.
//
// Слой — это контейнер с именем и местом в стопке. Кто угодно кладёт узел
// в «ui» или «overlay», не зная и не имея возможности сломать соседей.

import { Container } from "./display.js";

export class LayerStack extends Container {
  /** @param {string[]} names снизу вверх: первый слой рисуется первым. */
  constructor(names = []) {
    super();
    // Порядок отрисовки держится на zIndex, а не на порядке в массиве:
    // так он остаётся верным независимо от того, когда слой завели.
    this.sortableChildren = true;
    this.byName = new Map();
    this.order = [];
    for (const name of names) this.define(name);
  }

  /** Заводит новый слой поверх всех существующих. */
  define(name) {
    if (this.byName.has(name)) throw new Error(`Слой ${name} уже определён`);
    const layer = new Container();
    layer.name = name;
    // Шаг в десять оставляет место вставить слой между существующими,
    // не перенумеровывая остальные.
    layer.zIndex = this.order.length * 10;
    this.byName.set(name, layer);
    this.order.push(name);
    super.add(layer);
    return layer;
  }

  get(name) {
    const layer = this.byName.get(name);
    if (!layer) throw new Error(`Слой не определён: ${name}`);
    return layer;
  }

  /** Кладёт узлы в названный слой. Возвращает первый — как Container#add. */
  place(name, ...nodes) {
    return this.get(name).add(...nodes);
  }

  /**
   * Прямое добавление в стопку запрещено: узел мимо слоя оказался бы
   * в порядке отрисовки на случайном месте — ровно то, от чего слои
   * и заводились.
   */
  add() {
    throw new Error("LayerStack: узлы кладутся в слой через place(имя, …)");
  }

  clear(name) {
    this.get(name).removeAll();
  }
}
