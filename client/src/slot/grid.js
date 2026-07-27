// Геометрия игрового поля.
//
// Здесь нет ни одного числа, описывающего размер сетки: сколько барабанов
// и сколько рядов — приходит с сервера в /api/config. До этого 5 и 3 были
// вписаны в восьми местах кода барабанов и ещё дважды в разборе раунда,
// и «сделать 6×5» означало найти их все — включая те, где тройка выглядела
// как случайная константа.
//
// Grid — единственный источник ответов на вопросы «где ячейка», «какого она
// размера» и «куда встаёт оправа». Всё остальное этими ответами пользуется.

export class Grid {
  /**
   * @param {number} reels барабанов (колонок)
   * @param {number} rows  видимых рядов
   */
  constructor(reels, rows) {
    this.reels = reels;
    this.rows = rows;

    this.cell = 0;
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    this.centerX = 0;
    this.centerY = 0;
    this.frame = { x: 0, y: 0, width: 0, height: 0 };
  }

  /**
   * Пересчёт под раскладку.
   *
   * Раскладка задаёт размер ячейки и левый верхний угол поля; всё остальное
   * выводится отсюда. Обратной зависимости нет: раскладка не обязана знать,
   * сколько барабанов в игре, — ей достаточно получить их число параметром.
   */
  apply(layout) {
    const w = layout.cell * this.reels;
    const h = layout.cell * this.rows;
    const inset = layout.frameInset;

    this.cell = layout.cell;
    this.x = layout.grid.x;
    this.y = layout.grid.y;
    this.width = w;
    this.height = h;
    this.centerX = this.x + w / 2;
    this.centerY = this.y + h / 2;

    this.frame.x = this.x - inset;
    this.frame.y = this.y - inset;
    this.frame.width = w + inset * 2;
    this.frame.height = h + inset * 2;

    return this;
  }

  /** Центр ячейки в координатах сцены. */
  cellCenter(reel, row, out = { x: 0, y: 0 }) {
    out.x = this.x + this.cell * (reel + 0.5);
    out.y = this.y + this.cell * (row + 0.5);
    return out;
  }

  /** Центр ячейки в координатах самого поля — для узлов внутри окна. */
  localCellCenter(reel, row, out = { x: 0, y: 0 }) {
    out.x = this.cell * (reel + 0.5);
    out.y = this.cell * (row + 0.5);
    return out;
  }

  /** Прямоугольник окна барабанов — им же режется всё, что вылезает. */
  get clipRect() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  /**
   * Экран сервера приходит рядами: screen[row][reel]. Барабану нужна
   * колонка — вот она, без предположений о её длине.
   */
  column(screen, reel) {
    const out = new Array(this.rows);
    for (let row = 0; row < this.rows; row++) out[row] = screen[row][reel];
    return out;
  }

  /** Есть ли символ на этом барабане. Нужно для антисипации и звука. */
  columnHas(screen, reel, symbolId) {
    for (let row = 0; row < this.rows; row++) {
      if (screen[row][reel] === symbolId) return true;
    }
    return false;
  }
}
