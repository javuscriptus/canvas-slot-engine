// Палитра темы «Неон».
//
// Другая игра на том же слоте: вместо тёплого заката — ночной город,
// вместо золота — холодный электрический свет. Ни одного цвета из «Сочи»
// здесь нет, и это главное, что тема обязана доказать: игра красится
// целиком из своего файла.
//
// Ассеты пока общие (арт — отдельная задача), поэтому картинки те же;
// всё, что рисует сам движок — текст, подложки, линии, ореолы, — уходит
// в холодную гамму, и на скриншоте это видно с первого взгляда.

/** Опорные краски. Из них выведено всё остальное. */
export const BASE = {
  ink: "#03060F",
  night: "#070C1C",
  steel: "#16203A",

  cyan: "#4DE8FF",
  cyanPale: "#BFF6FF",
  cyanDeep: "#0E7C9B",

  magenta: "#FF3D9A",
  magentaPale: "#FFC2DF",
  magentaDeep: "#8A1150",

  lime: "#9CFF4D",
  amber: "#FFC24F",
  white: "#F2F7FF"
};

export const palette = {
  // Заголовки и счётчики идут по холодному градиенту: от бледной бирюзы
  // через чистый циан к его глубокому оттенку.
  goldGradient: [[0, BASE.cyanPale], [0.5, BASE.cyan], [1, BASE.cyanDeep]],
  meterGradient: [
    [0, BASE.cyanPale], [0.35, BASE.cyan], [0.6, BASE.cyanPale], [1, BASE.cyanDeep]
  ],
  // Баннер крупного выигрыша уходит в маджентовую сторону: он обязан
  // отличаться от обычных счётчиков не только размером.
  bannerGradient: [[0, BASE.white], [0.45, BASE.magentaPale], [1, BASE.magenta]],

  winGlow: BASE.cyan,
  line: BASE.magenta,
  lineBacking: "rgba(0,0,0,0.62)",
  // Обводка не чёрная, а очень тёмная синяя: чёрный контур на цианe
  // выглядит грязным, синий читается как тень от самой вывески.
  stroke: "#041225",
  stage: BASE.ink,
  backdrop: "rgba(3,6,15,0.88)",
  bannerDim: "rgba(3,6,15,1)",

  anticipation: [
    [0, "rgba(77,232,255,0)"],
    [0.5, "rgba(77,232,255,1)"],
    [1, "rgba(77,232,255,0)"]
  ],

  text: "#DCEBFF",
  textWarm: BASE.cyanPale,
  textDim: "#9FB6D8",
  textSoft: "#7C93B8",
  textMuted: "#55688A",
  textFaint: "#3B4A66",
  textBright: BASE.white,
  inkStroke: "#000814",

  positive: BASE.lime,
  warn: BASE.amber,
  wild: BASE.magenta,

  shadowSoft: "rgba(0,0,0,0.65)",
  shadowMid: "rgba(4,18,37,0.8)",
  shadowHard: "rgba(4,18,37,0.9)",

  rowStripe: "rgba(77,232,255,0.05)",
  rowStripeLit: "rgba(255,61,154,0.2)",
  rule: "rgba(77,232,255,0.14)",
  checkboxOff: "rgba(220,235,255,0.35)",
  gaugeOn: BASE.magenta,
  gaugeOff: "rgba(220,235,255,0.14)",

  introBackdrop: "rgba(3,6,15,0.97)",
  // Ореол за логотипом двухцветный: циан в центре, маджента по краю —
  // так вывеска читается как подсвеченная с двух сторон.
  introGlow: [
    [0, "rgba(77,232,255,0.26)"],
    [0.4, "rgba(255,61,154,0.16)"],
    [1, "rgba(0,0,0,0)"]
  ]
};
