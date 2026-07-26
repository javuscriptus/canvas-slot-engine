// Единая палитра игры "Сочи · Sochi Sunset".
// Всё, что рисуется (символы, UI, фоны), берёт цвета отсюда,
// поэтому арт остаётся консистентным.

export const PALETTE = {
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

// Самоцветы: каждый — набор оттенков одной гаммы,
// от самой светлой грани до самой тёмной.
export const GEMS = {
  sapphire: {
    name: "SAPPHIRE",
    lightest: "#D4F1FF",
    light: "#6FC8FF",
    base: "#1E7FE0",
    dark: "#0C46A0",
    darkest: "#062A66",
    glow: "#4FB8FF"
  },
  ruby: {
    name: "RUBY",
    lightest: "#FFD9DE",
    light: "#FF7A8C",
    base: "#E02040",
    dark: "#9B0F28",
    darkest: "#5C0616",
    glow: "#FF5C74"
  },
  emerald: {
    name: "EMERALD",
    lightest: "#D6FFEA",
    light: "#63EFAE",
    base: "#12B86A",
    dark: "#08714A",
    darkest: "#03412B",
    glow: "#48E89C"
  },
  amethyst: {
    name: "AMETHYST",
    lightest: "#F0DCFF",
    light: "#C48CFF",
    base: "#8A32E0",
    dark: "#571397",
    darkest: "#310857",
    glow: "#B06BFF"
  }
};

// Цвет плашки под каждой картой-роялти —
// чтобы низкие символы читались с одного взгляда.
export const ROYAL_PLATES = {
  A: { base: "#B4262E", dark: "#6A0F16", light: "#FF6B72" },
  K: { base: "#7A2CB0", dark: "#40126A", light: "#C77BFF" },
  Q: { base: "#1F63B8", dark: "#0D3270", light: "#6FAEFF" },
  J: { base: "#0E8A6B", dark: "#04503C", light: "#4EE0B4" },
  // «10» намеренно уводим в бирюзу: золотая плашка сливалась бы
  // с золотой цифрой и символ терял читаемость на барабане.
  T: { base: "#0E7C9B", dark: "#043C51", light: "#5FD6F0" }
};

/* ─────────────────────────── тема «Сочи» ────────────────────────── */

// Закатное море: бирюза воды, тёплое небо, песок и золото.
export const SOCHI = {
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

// Самоцветы низких символов: те же огранки, но курортная гамма —
// леденцы на солнце, а не сокровища тронного зала.
export const SOCHI_GEMS = {
  ruby:     { name: "RUBY",     lightest: "#FFD9DE", light: "#FF7A8C", base: "#E02040", dark: "#9B0F28", darkest: "#5C0616", glow: "#FF5C74" },
  amber:    { name: "AMBER",    lightest: "#FFF0C9", light: "#FFC963", base: "#F09A14", dark: "#A05E00", darkest: "#5C3600", glow: "#FFC24F" },
  emerald:  { name: "EMERALD",  lightest: "#D6FFEA", light: "#63EFAE", base: "#12B86A", dark: "#08714A", darkest: "#03412B", glow: "#48E89C" },
  aqua:     { name: "AQUA",     lightest: "#DFFBFF", light: "#7FE3E8", base: "#17B7C9", dark: "#0A5E77", darkest: "#04303E", glow: "#57DCEA" },
  amethyst: { name: "AMETHYST", lightest: "#F0DCFF", light: "#C48CFF", base: "#8A32E0", dark: "#571397", darkest: "#310857", glow: "#B06BFF" }
};
