// Тема «Неон» — доказательство, что оформление сменяемо.
//
// Она собрана из того же контракта, что и «Сочи», включается параметром
// ?theme=neon и не потребовала ни одной правки в slot/ и engine/. Всё,
// что отличает её от первой темы, лежит в этом каталоге: холодная палитра,
// другая гарнитура, другой темп, другие тексты, другая композиция панели,
// другие рецепты частиц, другой второй план и обратные роли фоновых
// картинок.
//
// Атласы символов и UI общие: свой арт — отдельная задача, и подменяется
// он теми же ключами atlas ниже, без единой правки кода.
//
// Темп здесь заметно быстрее курортного: барабаны разгоняются сильнее,
// останавливаются плотнее, показ выигрыша короче. Это не «настройка» —
// это то, чем неоновый автомат отличается от набережной, и вся разница
// умещается в блок timings.

import * as layout from "./layout.js";
import { strings, symbols } from "./strings.js";
import { Bursts } from "./effects.js";
import { createAmbient } from "./ambient.js";
import { BackgroundView } from "./background.js";
import { palette } from "./palette.js";

// Заголовки — засечная гарнитура, цифры — моноширинные: у табло
// с моноширинными цифрами не «пляшет» ширина при докрутке суммы.
const FAMILY = "Lora, Georgia, serif";
const NUMERIC = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const theme = {
  id: "neon",
  title: "Neon Nights",

  palette,

  fonts: {
    family: FAMILY,
    numeric: NUMERIC,
    mono: "ui-monospace, monospace",
    preload: ["700 32px Lora", "600 32px Lora", "700 32px Poppins"],

    roles: {
      meterLabel: {
        weight: 600, size: 19, fill: "textSoft", align: "center", letterSpacing: 4
      },
      meterValue: {
        weight: 700, size: 38, family: "numeric", gradient: "meterGradient",
        stroke: "stroke", strokeWidth: 2, align: "center",
        shadow: { color: "shadowSoft", blur: 8, x: 0, y: 0 }
      },
      autoCounter: {
        weight: 700, size: 26, family: "numeric", fill: "textBright",
        stroke: "inkStroke", strokeWidth: 3, align: "center"
      },
      badge: {
        weight: 700, size: 30, gradient: "goldGradient",
        stroke: "stroke", strokeWidth: 2, align: "center", letterSpacing: 3
      },
      winPopup: {
        weight: 700, size: 52, family: "numeric", gradient: "goldGradient",
        stroke: "stroke", strokeWidth: 4, align: "center",
        shadow: { color: "shadowMid", blur: 12, x: 0, y: 0 }
      },
      bannerAmount: {
        weight: 700, size: 88, family: "numeric", gradient: "bannerGradient",
        stroke: "stroke", strokeWidth: 6, align: "center",
        shadow: { color: "shadowHard", blur: 18, x: 0, y: 0 }
      },

      modalTitle: {
        weight: 700, size: 42, gradient: "goldGradient",
        stroke: "stroke", strokeWidth: 3, align: "center", letterSpacing: 6
      },
      modalButton: { weight: 700, size: 25, fill: "text", align: "center" },

      paytableName: { weight: 600, size: 21, fill: "text" },
      paytablePays: { weight: 700, size: 21, family: "numeric", fill: "winGlow" },
      paytableNotes: { weight: 500, size: 23, fill: "textDim", lineHeight: 34 },

      toast: { weight: 600, size: 29, fill: "textWarm", align: "center" },

      chipTitle: {
        weight: 600, size: 23, fill: "textSoft", align: "center", letterSpacing: 3
      },
      chipValue: {
        weight: 700, size: 27, family: "numeric", gradient: "goldGradient", align: "center"
      },
      autoplayNote: { weight: 500, size: 20, fill: "textMuted", align: "center" },

      historyHint: { weight: 600, size: 20, fill: "textMuted" },
      historyEmpty: { weight: 600, size: 24, fill: "textMuted", align: "center" },
      historyCell: { weight: 600, size: 23, family: "numeric", fill: "textSoft" },

      detailSmall: { weight: 600, size: 20, fill: "textMuted" },
      detailMono: { weight: 500, size: 20, family: "mono", fill: "textDim" },
      detailAmount: { weight: 700, size: 29, family: "numeric", fill: "textDim" },
      detailKind: { weight: 700, size: 24, fill: "winGlow" },

      introPlay: {
        weight: 700, size: 44, gradient: "goldGradient",
        stroke: "stroke", strokeWidth: 3, align: "center", letterSpacing: 8
      },
      introFactLabel: { weight: 600, size: 27, fill: "textSoft" },
      introFactValue: { weight: 700, size: 33, family: "numeric", fill: "winGlow", align: "right" },
      introSkip: { weight: 600, size: 29, fill: "textDim" }
    }
  },

  timings: {
    reelSpeed: 34,
    reelSpeedTurbo: 52,
    reelMinSpin: 0.52,
    reelMinSpinTurbo: 0.22,
    reelStopGap: 0.1,
    reelStopGapTurbo: 0.05,
    reelKick: 0.12,
    reelLand: 0.26,
    reelSettle: 0.14,
    anticipationHold: 0.9,

    winPop: 0.3,
    paylineDraw: 0.22,
    winCycleFirst: 0.8,
    winCycleStep: 1.1,
    cascadeStep: 0.55,
    scatterHold: 0.85,

    bannerDim: 0.26,
    bannerIn: 0.32,
    bannerHold: 0.45,
    bannerOut: 0.26,
    bannerFade: 0.3,
    freeSpinsAnnounce: 1.9,
    bonusTotalCount: 1.2,
    bonusTotalHold: 2.4,

    freeModeFade: 0.55,
    freeSpinGap: 0.42,
    freeSpinGapTurbo: 0.18,
    freeSpinAfterWin: 0.65,
    freeSpinAfterWinTurbo: 0.22,
    autoplayGap: 0.38,
    autoplayGapTurbo: 0.14,

    modalFade: 0.12,
    toastFade: 0.3,
    introFade: 0.24
  },

  /** Кадры общие с «Сочи»: свой арт кладётся сюда же, по этим же ключам. */
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
    error: "error"
  },

  music: { base: "music_base", free: "music_free" },

  /**
   * Пороги ниже курортных: неон объявляет крупный выигрыш охотнее,
   * зато держит баннер меньше.
   */
  winTiers: [
    { key: "big", threshold: 12, banner: "banner_big", sound: "win_big", duration: 2.6, shake: 8 },
    { key: "mega", threshold: 40, banner: "banner_mega", sound: "fanfare", duration: 3.4, shake: 12 },
    { key: "epic", threshold: 120, banner: "banner_epic", sound: "fanfare", duration: 4.2, shake: 16 }
  ],

  winMediumThreshold: 4,

  volatility: { level: 4, of: 5 },

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

  createBackground: (store, layout) => new BackgroundView(store, layout),
  createAmbient
};

export default theme;
