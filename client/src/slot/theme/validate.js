// Проверка полноты темы.
//
// Тема — это контракт, а контракт должен проверяться. Списки ниже и есть
// сам контракт в машиночитаемом виде: слот перечисляет ВСЁ, что просит
// у оформления, — цвета, роли надписей, длительности, кадры, звуки.
//
// Вызывается один раз при старте и перечисляет ВСЕ недостающие ключи сразу,
// а не по одному за запуск: искать их поштучно, перезапуская игру, — худший
// способ провести вечер. И уж точно лучше отказаться на загрузке, чем упасть
// посреди спина на отсутствующем кадре или нарисовать надпись цветом
// undefined, которую потом никто не найдёт на скриншоте.

import { textStyle } from "./styles.js";

/** Ключи верхнего уровня, без которых слот не соберётся. */
const REQUIRED = [
  ["id", (t) => t.id],
  ["palette", (t) => t.palette],
  ["fonts.family", (t) => t.fonts?.family],
  ["fonts.numeric", (t) => t.fonts?.numeric],
  ["fonts.mono", (t) => t.fonts?.mono],
  ["fonts.preload", (t) => t.fonts?.preload],
  ["fonts.roles", (t) => t.fonts?.roles],
  ["timings", (t) => t.timings],
  ["atlas", (t) => t.atlas],
  ["sounds", (t) => t.sounds],
  ["music.base", (t) => t.music?.base],
  ["music.free", (t) => t.music?.free],
  ["layout.build", (t) => t.layout?.build],
  ["strings", (t) => t.strings],
  ["symbols", (t) => t.symbols],
  ["effects", (t) => t.effects],
  ["scene.layers", (t) => t.scene?.layers],
  ["volatility.level", (t) => t.volatility?.level],
  ["volatility.of", (t) => t.volatility?.of],
  ["winMediumThreshold", (t) => t.winMediumThreshold],
  ["winTiers", (t) => (t.winTiers?.length ? true : null)],
  ["createBackground", (t) => t.createBackground],
  ["createAmbient", (t) => t.createAmbient]
];

/**
 * Цвета, которые слот берёт из палитры напрямую — заливками узлов, а не
 * через роли надписей. Цвета, спрятанные внутри ролей, проверяются иначе:
 * попыткой собрать саму роль.
 */
const COLORS = [
  "stage", "backdrop", "bannerDim", "line", "lineBacking", "anticipation",
  "winGlow", "text", "textDim", "textSoft", "textMuted", "textFaint",
  "positive", "warn", "wild",
  "rowStripe", "rowStripeLit", "rule", "checkboxOff", "gaugeOn", "gaugeOff",
  "introBackdrop", "introGlow"
];

/** Роли надписей. Каждая собирается на месте — заодно проверяются её цвета. */
const ROLES = [
  "meterLabel", "meterValue", "autoCounter", "badge", "winPopup", "bannerAmount",
  "modalTitle", "modalButton",
  "paytableName", "paytablePays", "paytableNotes", "toast",
  "chipTitle", "chipValue", "autoplayNote",
  "historyHint", "historyEmpty", "historyCell",
  "detailSmall", "detailMono", "detailAmount", "detailKind",
  "introPlay", "introFactLabel", "introFactValue", "introSkip"
];

/** Длительности. Отсутствующая даёт NaN в твине — то есть застывший кадр. */
const TIMINGS = [
  "reelSpeed", "reelSpeedTurbo", "reelMinSpin", "reelMinSpinTurbo",
  "reelStopGap", "reelStopGapTurbo", "reelKick", "reelLand", "reelSettle",
  "anticipationHold", "winPop", "paylineDraw",
  "winCycleFirst", "winCycleStep", "cascadeStep", "scatterHold",
  "bannerDim", "bannerIn", "bannerHold", "bannerOut", "bannerFade",
  "freeSpinsAnnounce", "bonusTotalCount", "bonusTotalHold",
  "freeModeFade", "freeSpinGap", "freeSpinGapTurbo", "freeSpinAfterWin", "freeSpinAfterWinTurbo",
  "autoplayGap", "autoplayGapTurbo", "modalFade", "toastFade", "introFade"
];

/** Кадры, которые слот запрашивает по имени из atlas. */
const ATLAS = [
  "reelFrame", "logo", "panel", "panelDark", "panelBar", "meterPlate",
  "cellGlow", "winFrame", "bannerFree",
  "btnSpin", "btnStop", "btnMinus", "btnPlus", "btnTurbo", "btnAuto",
  "btnMenu", "btnInfo", "btnHistory", "btnSoundOn", "btnSoundOff",
  "btnFull", "btnFullExit", "btnClose",
  "particleSpark", "particleCoin", "particleStar", "particleGlow"
];

/** Звуки, которые просит слот. Второй план темы сюда не входит. */
const SOUNDS = [
  "click", "button", "spinStart", "reelStop", "scatter",
  "winSmall", "winMedium", "tick", "coins", "freeSpins", "fanfare", "error"
];

/**
 * @param theme объект темы
 * @param store загруженные ассеты — по нему сверяются имена кадров
 * @throws со списком всех недостающих ключей
 */
export function validateTheme(theme, store) {
  const missing = [];

  for (const [path, get] of REQUIRED) {
    let value = null;
    try {
      value = theme ? get(theme) : null;
    } catch { /* дырявая тема падает на обращении — это и есть отсутствие */ }
    if (value === undefined || value === null) missing.push(path);
  }
  if (missing.length) throw report(theme, missing);

  for (const key of COLORS) {
    if (theme.palette[key] === undefined) missing.push(`palette.${key}`);
  }
  for (const key of TIMINGS) {
    if (!Number.isFinite(theme.timings[key])) missing.push(`timings.${key} (число секунд)`);
  }
  for (const key of SOUNDS) {
    if (!theme.sounds[key]) missing.push(`sounds.${key}`);
  }

  // Роль собирается по-настоящему: так же, как её соберёт интерфейс.
  // Заодно проверяются цвета, на которые роль ссылается, и гарнитура.
  for (const role of ROLES) {
    try {
      textStyle(theme, role);
    } catch (err) {
      missing.push(err.message);
    }
  }

  // Имя кадра, которого нет в атласе, — та же неполнота темы, только
  // всплывающая позже всех остальных.
  for (const key of ATLAS) {
    const name = theme.atlas[key];
    if (!name) missing.push(`atlas.${key}`);
    else if (!store.has(name)) missing.push(`atlas.${key} → кадра «${name}» нет в атласе`);
  }
  for (const tier of theme.winTiers) {
    if (!store.has(tier.banner)) missing.push(`winTiers.${tier.key} → кадра «${tier.banner}» нет`);
  }

  if (missing.length) throw report(theme, missing);
  return theme;
}

function report(theme, missing) {
  return new Error(`Тема «${theme?.id || "?"}» неполна:\n  · ${missing.join("\n  · ")}`);
}
