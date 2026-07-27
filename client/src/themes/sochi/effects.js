// Рецепты частиц: что именно сыплется на выигрыше, на бонусе и в простое.
//
// Раньше это лежало в engine/particles.js — движок знал про «выигрышный
// символ» и «фонтан монет». Движку положено уметь испускать частицы;
// решать, что искра живёт 0.35 секунды и падает с ускорением 120, —
// оформительское решение, и живёт оно вместе с остальным оформлением.

export const Bursts = {
  /** Искры при появлении выигрышного символа. */
  winSpark(sys, frame, x, y, scale = 1) {
    sys.emit({
      frame, x, y, count: 14,
      speed: [90 * scale, 260 * scale],
      life: [0.35, 0.75],
      size: [14 * scale, 34 * scale],
      sizeEnd: 0.2,
      gravity: 120,
      drag: 0.94,
      blend: "lighter"
    });
  },

  /** Фонтан монет для крупного выигрыша. */
  coinFountain(sys, frame, x, y, count = 30) {
    sys.emit({
      frame, x, y, count,
      spread: [220, 20],
      angle: [-Math.PI * 0.85, -Math.PI * 0.15],
      speed: [520, 1000],
      life: [1.1, 1.9],
      size: [34, 62],
      sizeEnd: 0.9,
      gravity: 1500,
      drag: 0.995,
      spin: [-7, 7],
      alphaEnd: 0.85
    });
  },

  /** Звёздный вихрь при запуске фриспинов. */
  starSwirl(sys, frame, x, y, count = 40) {
    sys.emit({
      frame, x, y, count,
      spread: [40, 40],
      speed: [220, 620],
      life: [0.9, 1.6],
      size: [22, 52],
      sizeEnd: 0.15,
      gravity: -60,
      drag: 0.97,
      spin: [-5, 5],
      blend: "lighter"
    });
  },

  /**
   * Золотая пыль, медленно всплывающая над сценой.
   *
   * Живёт долго и почти не двигается: её задача — убрать ощущение
   * статичной картинки в простое, а не привлечь внимание. Заметная
   * пыль в простое отвлекает от барабанов.
   */
  ambientGlow(sys, frame, x, y) {
    sys.emit({
      frame, x, y, count: 1,
      angle: [-Math.PI * 0.62, -Math.PI * 0.38],
      speed: [8, 26],
      life: [4.5, 8],
      size: [5, 16],
      sizeEnd: 0.5,
      gravity: -2,
      drag: 0.999,
      alpha: 0.5,
      alphaEnd: 0,
      blend: "lighter"
    });
  },

  /**
   * Блик наката у нижнего края.
   *
   * Разлетается почти горизонтально и гаснет за полсекунды: это не эффект,
   * а признак жизни у кромки воды. Заметная пена внизу отвлекала бы
   * от барабанов ровно так же, как заметная пыль наверху.
   */
  surfFoam(sys, frame, x, y) {
    sys.emit({
      frame, x, y, count: 3,
      spread: [90, 4],
      angle: [-Math.PI * 0.06, Math.PI * 0.06],
      speed: [14, 46],
      life: [0.5, 1.1],
      size: [6, 18],
      sizeEnd: 0.3,
      gravity: 6,
      drag: 0.96,
      alpha: 0.32,
      alphaEnd: 0,
      blend: "lighter"
    });
  }
};
