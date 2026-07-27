// Тема «Сочи · Sunset» — единственная точка входа оформления.
//
// Всё, что игра знает о своём виде, лежит здесь и больше нигде: палитра,
// гарнитуры и роли надписей, длительности, имена кадров в атласе, имена
// звуков, уровни крупного выигрыша, рецепты частиц, раскладки и тексты.
// Слот получает этот объект параметром и не импортирует из темы ничего —
// иначе выпуск второй игры означал бы правку слота.
//
// Проверка на то, что разделение настоящее, а не декларативное, —
// client/src/themes/neon: вторая тема собрана из этого же контракта и
// включается параметром ?theme=neon, не меняя ни строки в slot/ и engine/.
//
// Полнота проверяется slot/theme/validate.js при старте: игра не поднимется
// с неполной темой, вместо того чтобы упасть посреди спина на отсутствующем
// кадре или с чёрным текстом на чёрном фоне.

import * as layout from "./layout.js";
import { strings, symbols } from "./strings.js";
import { Bursts } from "./effects.js";
import { createAmbient } from "./ambient.js";
import { BackgroundView } from "./background.js";
import { palette } from "./palette.js";

const FAMILY = "Poppins, Lora, sans-serif";
const NUMERIC = "Poppins, sans-serif";

export const theme = {
  id: "sochi",
  title: "Сочи · Sunset",

  palette,

  fonts: {
    family: FAMILY,
    numeric: NUMERIC,
    mono: "ui-monospace, monospace",
    // Начертания, которые нужно прогреть до первого кадра: иначе текст
    // рисуется запасной гарнитурой и потом дёргается.
    preload: ["700 32px Poppins", "600 32px Poppins", "700 32px Lora"],

    /**
     * Роли надписей: слот называет роль, тема решает, как она выглядит.
     * Цвета — КЛЮЧИ палитры, а не литералы; кегль умножается на масштаб
     * там, где надпись живёт внутри масштабируемой композиции.
     */
    roles: {
      meterLabel: {
        weight: 600, size: 20, fill: "textDim", align: "center", letterSpacing: 2
      },
      meterValue: {
        weight: 700, size: 40, gradient: "meterGradient",
        stroke: "stroke", strokeWidth: 2, align: "center",
        shadow: { color: "shadowSoft", blur: 6, x: 0, y: 2 }
      },
      // Счётчик автоигры лежит поверх кнопки: ему нужен не золотой блеск,
      // а максимальный контраст с любой картинкой под ним.
      autoCounter: {
        weight: 700, size: 26, family: "numeric", fill: "textBright",
        stroke: "inkStroke", strokeWidth: 3, align: "center"
      },
      badge: {
        weight: 700, size: 30, gradient: "meterGradient",
        stroke: "stroke", strokeWidth: 2, align: "center", letterSpacing: 2
      },
      winPopup: {
        weight: 700, size: 54, gradient: "goldGradient",
        stroke: "stroke", strokeWidth: 4, align: "center",
        shadow: { color: "shadowMid", blur: 10, x: 0, y: 3 }
      },
      bannerAmount: {
        weight: 700, size: 92, gradient: "bannerGradient",
        stroke: "stroke", strokeWidth: 6, align: "center",
        shadow: { color: "shadowHard", blur: 14, x: 0, y: 4 }
      },

      modalTitle: {
        weight: 700, size: 44, gradient: "goldGradient",
        stroke: "stroke", strokeWidth: 3, align: "center", letterSpacing: 3
      },
      modalButton: { weight: 700, size: 26, fill: "text", align: "center" },

      paytableName: { weight: 600, size: 20, fill: "text" },
      paytablePays: { weight: 700, size: 22, fill: "winGlow" },
      paytableNotes: { weight: 500, size: 24, fill: "textDim", lineHeight: 36 },

      toast: { weight: 600, size: 30, fill: "textWarm", align: "center" },

      chipTitle: {
        weight: 600, size: 24, fill: "textDim", align: "center", letterSpacing: 2
      },
      chipValue: {
        weight: 700, size: 28, family: "numeric", gradient: "goldGradient", align: "center"
      },
      autoplayNote: { weight: 500, size: 20, fill: "textMuted", align: "center" },

      historyHint: { weight: 600, size: 20, fill: "textMuted" },
      historyEmpty: { weight: 600, size: 24, fill: "textMuted", align: "center" },
      historyCell: { weight: 600, size: 24, fill: "textSoft" },

      detailSmall: { weight: 600, size: 20, fill: "textMuted" },
      detailMono: { weight: 500, size: 20, family: "mono", fill: "textDim" },
      detailAmount: { weight: 700, size: 30, fill: "textDim" },
      detailKind: { weight: 700, size: 24, fill: "winGlow" },

      introPlay: {
        weight: 700, size: 46, gradient: "goldGradient",
        stroke: "stroke", strokeWidth: 3, align: "center", letterSpacing: 4
      },
      introFactLabel: { weight: 600, size: 28, fill: "textSoft" },
      introFactValue: { weight: 700, size: 34, fill: "winGlow", align: "right" },
      introSkip: { weight: 600, size: 30, fill: "textDim" }
    }
  },

  /**
   * Длительности, секунды. Единственное место, где живёт темп игры.
   *
   * «Сочи» намеренно неторопливы: барабаны крутятся почти секунду даже
   * при мгновенном ответе сервера, показ выигрыша даёт рассмотреть
   * комбинацию. Слот эти числа не выдумывает и не подменяет — он берёт
   * их отсюда, поэтому вторая тема вправе быть вдвое быстрее.
   */
  timings: {
    reelSpeed: 26,
    reelSpeedTurbo: 40,
    reelMinSpin: 0.85,
    reelMinSpinTurbo: 0.34,
    reelStopGap: 0.17,
    reelStopGapTurbo: 0.09,
    reelKick: 0.18,
    reelLand: 0.34,
    reelSettle: 0.2,
    anticipationHold: 1.15,

    winPop: 0.42,
    paylineDraw: 0.34,
    winCycleFirst: 1.1,
    winCycleStep: 1.5,
    cascadeStep: 0.75,
    scatterHold: 1.1,

    bannerDim: 0.38,
    bannerIn: 0.45,
    bannerHold: 0.6,
    bannerOut: 0.35,
    bannerFade: 0.42,
    freeSpinsAnnounce: 2.4,
    bonusTotalCount: 1.6,
    bonusTotalHold: 3.0,

    freeModeFade: 0.8,
    freeSpinGap: 0.6,
    freeSpinGapTurbo: 0.25,
    freeSpinAfterWin: 0.9,
    freeSpinAfterWinTurbo: 0.3,
    autoplayGap: 0.52,
    autoplayGapTurbo: 0.18,

    modalFade: 0.18,
    toastFade: 0.4,
    introFade: 0.32
  },

  /** Имена кадров в атласе. Слот знает только эти ключи. */
  atlas: {
    reelFrame: "reel_frame",
    logo: "logo",
    panel: "panel",
    panelDark: "panel_dark",
    panelBar: "panel_bar",
    meterPlate: "meter_plate",
    cellGlow: "cell_glow",
    winFrame: "win_frame",
    winRays: "win_rays",
    bannerFree: "banner_free",
    btnSpin: "btn_spin",
    btnStop: "btn_stop",
    btnMinus: "btn_minus",
    btnPlus: "btn_plus",
    btnTurbo: "btn_turbo",
    btnAuto: "btn_auto",
    btnMenu: "btn_menu",
    btnInfo: "btn_info",
    btnHistory: "btn_history",
    btnSoundOn: "btn_sound_on",
    btnSoundOff: "btn_sound_off",
    btnFull: "btn_full",
    btnFullExit: "btn_full_exit",
    btnClose: "btn_close",
    particleSpark: "p_spark",
    particleCoin: "p_coin",
    particleStar: "p_star",
    particleGlow: "p_glow"
  },

  /**
   * Логическое имя звука → имя в спрайте. Слот просит «остановку барабана»,
   * а не «reel_stop»: как эта остановка звучит и звучит ли вообще —
   * решение темы.
   */
  sounds: {
    click: "click",
    button: "button",
    spinStart: "spin_start",
    reelStop: "reel_stop",
    scatter: "scatter",
    winSmall: "win_small",
    winMedium: "win_medium",
    tick: "tick",
    coins: "coins",
    freeSpins: "freespins",
    fanfare: "fanfare",
    error: "error",
    // Второй план: их просит только плагин живности этой же темы.
    gull: "gull",
    wave: "wave"
  },

  /** Музыка базовой игры и бонуса — имена в спрайте звука. */
  music: { base: "music_base", free: "music_free" },

  /**
   * Уровни крупного выигрыша. Порог считается в ставках: 50 рублей при
   * ставке 1 — событие, при ставке 100 — обычный спин.
   */
  winTiers: [
    { key: "big", threshold: 15, banner: "banner_big", sound: "win_big", duration: 3.2, shake: 7 },
    { key: "mega", threshold: 50, banner: "banner_mega", sound: "fanfare", duration: 4.2, shake: 10 },
    { key: "epic", threshold: 150, banner: "banner_epic", sound: "fanfare", duration: 5.2, shake: 14 }
  ],

  /** Порог «медленного» выигрыша: ниже — тихий звук, выше — средний. */
  winMediumThreshold: 5,

  /** Волатильность для заставки: пять делений понятнее, чем «σ = 7.08». */
  volatility: { level: 4, of: 5 },

  /**
   * Живая сцена: слои фона, их глубина и движение. Пока фон собирается
   * одной картинкой (createBackground), поэтому слой ровно один и без
   * движения; ParallaxScene разберёт этот же список на настоящие слои,
   * не трогая ни слот, ни движок.
   */
  scene: {
    layers: [
      { key: "photo", depth: 1, motion: null }
    ],
    character: null
  },

  effects: Bursts,
  layout,
  strings,
  symbols,

  /** Фон и живность: слот только кладёт их в свои слои. */
  createBackground: (store, layout) => new BackgroundView(store, layout),
  createAmbient
};

export default theme;
