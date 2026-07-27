// Палитра темы «Сочи» — один источник цвета на игру и на сборку арта.
//
// Раньше цвета жили в двух местах: здесь их брал интерфейс, а
// tools/assets/palette.mjs держал свою копию для генератора символов, UI
// и фонов. Две копии одного набора расходятся не «если», а «когда»: любая
// правка золота в интерфейсе оставляла символы прежними, и игра постепенно
// становилась разноцветной. Теперь генератор арта импортирует ЭТОТ файл,
// а его палитра осталась тонкой обёрткой ради обратной совместимости
// с уже написанными producers.
//
// Разделение внутри файла такое:
//   ART   — краски, которыми РИСУЮТСЯ ассеты (символы, кнопки, фоны).
//   palette — цвета, которыми игра красит текст и подложки в кадре.
// Второе выведено из первого везде, где это осмысленно: золото надписи
// обязано быть тем же золотом, что и золото кнопки.

/* ─────────────────────── краски для сборки арта ─────────────────── */

/** Базовые металлы и глубины. */
export const BASE = {
  // Фон / глубина
  voidDeep: "#0B0413",
  voidMid: "#1A0730",
  royal: "#2A0B45",
  royalLight: "#3D1163",
  royalGlow: "#5B1E92",

  // Золото (основной металл)
  goldLight: "#FFF3C4",
  goldPale: "#FFE082",
  gold: "#F7C948",
  goldMid: "#E09E1A",
  goldDeep: "#A9690C",
  goldShadow: "#5E3703",

  // Серебро (вторичный металл, для UI)
  silverLight: "#F4F8FF",
  silver: "#C3CEE0",
  silverMid: "#8895AC",
  silverDeep: "#4A5568",

  // Акценты
  cyan: "#3FE0FF",
  magenta: "#FF3D9A",
  emerald: "#31E08A",
  crimson: "#FF3B4E",

  ink: "#120620",
  white: "#FFFFFF"
};

/** Самоцветы: от самой светлой грани до самой тёмной. */
export const GEMS = {
  sapphire: {
    name: "SAPPHIRE",
    lightest: "#D4F1FF", light: "#6FC8FF", base: "#1E7FE0",
    dark: "#0C46A0", darkest: "#062A66", glow: "#4FB8FF"
  },
  ruby: {
    name: "RUBY",
    lightest: "#FFD9DE", light: "#FF7A8C", base: "#E02040",
    dark: "#9B0F28", darkest: "#5C0616", glow: "#FF5C74"
  },
  emerald: {
    name: "EMERALD",
    lightest: "#D6FFEA", light: "#63EFAE", base: "#12B86A",
    dark: "#08714A", darkest: "#03412B", glow: "#48E89C"
  },
  amethyst: {
    name: "AMETHYST",
    lightest: "#F0DCFF", light: "#C48CFF", base: "#8A32E0",
    dark: "#571397", darkest: "#310857", glow: "#B06BFF"
  }
};

/**
 * Цвет плашки под картой-роялти: низкие символы должны читаться
 * с одного взгляда, не вчитываясь в букву.
 */
export const ROYAL_PLATES = {
  A: { base: "#B4262E", dark: "#6A0F16", light: "#FF6B72" },
  K: { base: "#7A2CB0", dark: "#40126A", light: "#C77BFF" },
  Q: { base: "#1F63B8", dark: "#0D3270", light: "#6FAEFF" },
  J: { base: "#0E8A6B", dark: "#04503C", light: "#4EE0B4" },
  // «10» намеренно уводим в бирюзу: золотая плашка сливалась бы
  // с золотой цифрой и символ терял читаемость на барабане.
  T: { base: "#0E7C9B", dark: "#043C51", light: "#5FD6F0" }
};

/** Закатное море: бирюза воды, тёплое небо, песок и золото. */
export const SCENERY = {
  skyTop: "#2A1B5E",
  skyMid: "#C94E7A",
  skyLow: "#FF8A4C",
  sun: "#FFD166",
  sunCore: "#FFF3C4",

  seaDeep: "#062E45",
  seaMid: "#0E6E8C",
  sea: "#17B7C9",
  seaLight: "#7FE3E8",
  foam: "#E8FBFC",

  sand: "#F0D9A8",
  sandDark: "#C9A46B",
  pebble: "#4A5568",

  palmDark: "#0B3A2E",
  palm: "#1E7A4F",
  palmLight: "#4FBF7F",

  coral: "#FF4E7A",
  mango: "#FF7A3D"
};

/**
 * Самоцветы низких символов в курортной гамме: леденцы на солнце,
 * а не сокровища тронного зала.
 */
export const SCENERY_GEMS = {
  ruby: GEMS.ruby,
  amber: {
    name: "AMBER",
    lightest: "#FFF0C9", light: "#FFC963", base: "#F09A14",
    dark: "#A05E00", darkest: "#5C3600", glow: "#FFC24F"
  },
  emerald: GEMS.emerald,
  aqua: {
    name: "AQUA",
    lightest: "#DFFBFF", light: "#7FE3E8", base: "#17B7C9",
    dark: "#0A5E77", darkest: "#04303E", glow: "#57DCEA"
  },
  amethyst: GEMS.amethyst
};

/* ──────────────────────── цвета интерфейса ──────────────────────── */

/**
 * Полупрозрачные цвета заданы строкой rgba, а не «цвет + альфа узла»:
 * альфу узла игра анимирует, и подмешивать в неё постоянную прозрачность
 * подложки значило бы каждый раз пересчитывать одно через другое.
 */
export const palette = {
  // Золото — основной акцент: логотип, счётчики, подсветка выигрыша.
  goldGradient: [[0, BASE.goldLight], [0.5, BASE.gold], [1, BASE.goldMid]],
  // У счётчиков блик посередине: цифры мелкие, и однородная заливка
  // на них читается плоско.
  meterGradient: [[0, BASE.goldLight], [0.35, BASE.gold], [0.6, BASE.goldLight], [1, BASE.goldMid]],
  // Баннер крупного выигрыша светлее счётчиков: он читается издалека
  // и на затемнённом фоне, где золото уходит в грязь.
  bannerGradient: [[0, BASE.white], [0.5, BASE.goldPale], [1, "#F5A623"]],

  winGlow: "#FFD86A",
  line: BASE.goldPale,
  lineBacking: "rgba(0,0,0,0.55)",
  stroke: "#3A1F00",
  stage: "#07020F",
  backdrop: "rgba(4,1,10,0.86)",
  bannerDim: "rgba(4,1,10,1)",

  // Колонна антисипации: свет наливается к середине окна барабанов
  // и сходит на нет к его краям.
  anticipation: [
    [0, "rgba(255,216,106,0)"],
    [0.5, "rgba(255,216,106,1)"],
    [1, "rgba(255,216,106,0)"]
  ],

  text: "#E9DDFF",
  textWarm: "#FFE9B8",
  textDim: "#C9B6E8",
  textSoft: "#9C8CBF",
  textMuted: "#6B5C87",
  textFaint: "#4E4370",
  textBright: BASE.white,
  inkStroke: "#000000",

  positive: "#7CFFB0",
  warn: "#FFB84F",
  wild: "#FF9ED6",

  // Тени под надписями: три плотности на всю игру, потому что глазу
  // важна не точная альфа, а то, что тень везде одна и та же.
  shadowSoft: "rgba(0,0,0,0.6)",
  shadowMid: "rgba(0,0,0,0.7)",
  shadowHard: "rgba(0,0,0,0.75)",

  // Мелочь интерфейса: полосы, разделители, рамка галочки.
  rowStripe: "rgba(255,255,255,0.04)",
  rowStripeLit: "rgba(255,216,106,0.16)",
  rule: "rgba(255,255,255,0.09)",
  checkboxOff: "rgba(255,255,255,0.42)",
  gaugeOn: "#FFC24F",
  gaugeOff: "rgba(255,255,255,0.16)",

  // Заставка: почти непрозрачный занавес и тёплый ореол за логотипом.
  introBackdrop: "rgba(8,3,18,0.955)",
  introGlow: [
    [0, "rgba(255,176,90,0.30)"],
    [0.45, "rgba(214,84,120,0.14)"],
    [1, "rgba(0,0,0,0)"]
  ]
};
