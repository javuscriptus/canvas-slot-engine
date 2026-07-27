// Линии выплат.
//
// Линия — это ломаная по центрам ячеек, и ничем, кроме координат, она не
// является. Раньше она рисовалась колбэком на ctx прямо из игрового слоя;
// теперь узел несёт ДАННЫЕ пути, а превращать их в пиксели — дело бэкенда.
//
// Ни одного нового объекта в кадре: и пути, и массивы точек берутся из пула
// и переписываются на месте. Двадцать линий по два пути — сорок объектов
// каждый кадр, которые сборщик мусора вернул бы ровно в момент показа
// выигрыша, то есть на самом заметном месте.

import { Shape } from "../../engine/display.js";

export class PaylinesView extends Shape {
  /**
   * @param opts.drawTime длительность прорисовки линии от первого
   *                      барабана до последнего, из темы
   * @param opts.color    цвет линии
   * @param opts.backing  тёмная подложка: линия обязана читаться
   *                      поверх любого символа
   */
  constructor(grid, paylines, { drawTime, color, backing }) {
    super([], grid.width, grid.height);
    this.grid = grid;
    this.paylines = paylines;
    this.drawTime = drawTime;
    this.color = color;
    this.backing = backing;
    this.active = [];        // [{line, color}]
    this.time = 0;
    this.progress = 1;
    this._pool = [];
    this._geoms = [];
    this.visible = false;
    this.applyGrid(grid);
  }

  applyGrid(grid) {
    this.grid = grid;
    this.width = grid.width;
    this.height = grid.height;
    this.setPosition(grid.x, grid.y);
    return this;
  }

  show(lineIndexes, { color = this.color, animate = true } = {}) {
    this.active = lineIndexes.map((i) => ({ line: i, color }));
    this.time = 0;
    // Линия прорисовывается слева направо — в ту же сторону, в какую
    // считается комбинация. Игрок видит не просто подсветку, а то,
    // как выигрыш «собрался».
    this.progress = animate ? 0 : 1;
    this.visible = this.active.length > 0;
    this._build();
  }

  clear() {
    this.active = [];
    this.progress = 1;
    this.paths.length = 0;
    this.visible = false;
  }

  update(dt) {
    if (!this.active.length) return;
    this.time += dt;
    if (this.progress < 1) this.progress = Math.min(1, this.progress + dt / this.drawTime);
    this._build();
  }

  /** Берёт путь из пула: аллокация на кадр здесь недопустима. */
  _path(index) {
    let p = this._pool[index];
    if (!p) {
      p = { points: null, closed: false, fill: null, stroke: null, strokeWidth: 0,
            dash: null, dashOffset: 0, cap: "round", join: "round", alpha: 1 };
      this._pool[index] = p;
    }
    return p;
  }

  /** Точки линии живут отдельно от стиля: подложка и пунктир идут по одним. */
  _geometry(index) {
    let a = this._geoms[index];
    if (!a) {
      a = [];
      this._geoms[index] = a;
    }
    a.length = 0;
    return a;
  }

  _build() {
    const cell = this.grid.cell;
    // Бегущий пунктир: смещение растёт со временем и заворачивается
    // на длине штриха с пробелом.
    const dash = (this.time * 60) % 24;
    this.paths.length = 0;

    for (let k = 0; k < this.active.length; k++) {
      const item = this.active[k];
      const pattern = this.paylines[item.line];
      if (!pattern) continue;

      const pts = this._geometry(k);
      pts.push(cell * 0.5, cell * (pattern[0] + 0.5));

      // Сколько барабанов уже «пройдено» анимацией
      const reach = this.progress * (pattern.length - 1);
      for (let r = 1; r < pattern.length; r++) {
        const seg = Math.min(1, Math.max(0, reach - (r - 1)));
        if (seg <= 0) break;
        const px = cell * (r - 0.5);
        const py = cell * (pattern[r - 1] + 0.5);
        const nx = cell * (r + 0.5);
        const ny = cell * (pattern[r] + 0.5);
        pts.push(px + (nx - px) * seg, py + (ny - py) * seg);
      }

      const backing = this._path(k * 2);
      backing.points = pts;
      backing.stroke = this.backing;
      backing.strokeWidth = 12;
      backing.dash = null;
      backing.alpha = 0.9;
      this.paths.push(backing);

      // Пунктир идёт по тем же точкам — массив один на обе обводки.
      const top = this._path(k * 2 + 1);
      top.points = pts;
      top.stroke = item.color;
      top.strokeWidth = 6;
      top.dash = DASH;
      top.dashOffset = -dash;
      top.alpha = 1;
      this.paths.push(top);
    }
  }
}

const DASH = [16, 8];
