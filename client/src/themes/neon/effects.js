// Рецепты частиц темы «Неон».
//
// Другая физика при тех же кадрах: искры здесь злее и живут меньше,
// монеты летят выше и падают быстрее, вихрь на бонусе крутится в другую
// сторону. Частица — это набор чисел, а числа принадлежат оформлению.

export const Bursts = {
  /** Разряд при появлении выигрышного символа: коротко и резко. */
  winSpark(sys, frame, x, y, scale = 1) {
    sys.emit({
      frame, x, y, count: 18,
      speed: [160 * scale, 420 * scale],
      life: [0.18, 0.42],
      size: [10 * scale, 26 * scale],
      sizeEnd: 0.05,
      gravity: 40,
      drag: 0.9,
      blend: "lighter"
    });
  },

  /** Фонтан: выше и злее курортного, монеты почти не разлетаются вбок. */
  coinFountain(sys, frame, x, y, count = 30) {
    sys.emit({
      frame, x, y, count,
      spread: [140, 12],
      angle: [-Math.PI * 0.72, -Math.PI * 0.28],
      speed: [700, 1250],
      life: [0.9, 1.5],
      size: [28, 54],
      sizeEnd: 0.8,
      gravity: 2200,
      drag: 0.997,
      spin: [-12, 12],
      alphaEnd: 0.8
    });
  },

  /** Вихрь на бонусе: закрутка в одну сторону, а не веером во все. */
  starSwirl(sys, frame, x, y, count = 40) {
    sys.emit({
      frame, x, y, count,
      spread: [26, 26],
      speed: [380, 900],
      life: [0.6, 1.1],
      size: [16, 40],
      sizeEnd: 0.05,
      gravity: -140,
      drag: 0.955,
      spin: [4, 11],
      blend: "lighter"
    });
  },

  /**
   * Пыль в воздухе: у неона это не золотая взвесь, а редкие частицы,
   * которые сносит вбок сквозняком из подворотни. Она такая же тихая —
   * заметный второй план отвлекает от барабанов в любой теме.
   */
  ambientGlow(sys, frame, x, y) {
    sys.emit({
      frame, x, y, count: 1,
      angle: [-Math.PI * 0.15, Math.PI * 0.02],
      speed: [16, 44],
      life: [3.5, 6.5],
      size: [4, 12],
      sizeEnd: 0.4,
      gravity: 3,
      drag: 0.999,
      alpha: 0.42,
      alphaEnd: 0,
      blend: "lighter"
    });
  },

  /** Мигание вывески: короткая вспышка на месте, без разлёта. */
  signFlicker(sys, frame, x, y) {
    sys.emit({
      frame, x, y, count: 2,
      spread: [30, 12],
      speed: [4, 18],
      life: [0.12, 0.3],
      size: [30, 74],
      sizeEnd: 0.15,
      gravity: 0,
      drag: 0.9,
      alpha: 0.5,
      alphaEnd: 0,
      blend: "lighter"
    });
  }
};
