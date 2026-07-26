// UI-графика: кнопки, панели, рамка барабанов, частицы, логотип.
// Размеры заданы в «дизайнерских» пикселях для базового холста 1920×1080;
// растеризатор поднимает их до 2×.

import { PALETTE as P, GEMS, SOCHI as S } from "./palette.mjs";
import {
  goldGradient, radial, linear, dropShadow, blurFilter, glowFilter,
  metalText, svgDoc, ngon, pointsAttr, shade, sparkle, namespaceSvg, polar,
  innerShadow, gloss, linearV
} from "./svg-lib.mjs";

const baseDefs = `
  ${goldGradient("gold", P, 90)}
  ${linear("goldRim", [["0%", P.goldLight], ["45%", P.gold], ["100%", P.goldDeep]], 90)}
  ${linear("goldRimDown", [["0%", P.goldDeep], ["55%", P.goldMid], ["100%", P.goldLight]], 90)}
  ${linear("glass", [["0%", "#2E1049"], ["55%", "#1A0730"], ["100%", "#0E0320"]], 90)}
  ${linear("glassLit", [["0%", "#4A1B73"], ["55%", "#2A0B45"], ["100%", "#160528"]], 90)}
  ${dropShadow("shadow", 4, 6, 0.5)}
  ${dropShadow("shadowDeep", 6, 10, 0.6)}
  ${innerShadow("innerWellShadow", { dy: 10, blur: 12, opacity: 0.75 })}
  ${innerShadow("innerBtn", { dy: 3, blur: 4, opacity: 0.5 })}
  ${gloss("gloss")}
  ${blurFilter("soft", 4)}
  ${blurFilter("softer", 10)}
  ${glowFilter("goldGlow", 8, P.gold, 0.85)}
`;

/* ─────────────────────────── круглые кнопки ─────────────────────── */

const ICONS = {
  // Две дуги со стрелками — классический «спин».
  spin: (s) => `
    <g fill="none" stroke="#fff" stroke-width="${s * 0.09}" stroke-linecap="round">
      <path d="M ${s * 0.5} ${s * 0.19}
               A ${s * 0.31} ${s * 0.31} 0 1 1 ${s * 0.19} ${s * 0.5}"/>
      <path d="M ${s * 0.5} ${s * 0.81}
               A ${s * 0.31} ${s * 0.31} 0 1 1 ${s * 0.81} ${s * 0.5}"/>
    </g>
    <polygon points="${pointsAttr([
      { x: s * 0.5, y: s * 0.08 }, { x: s * 0.5, y: s * 0.3 }, { x: s * 0.68, y: s * 0.19 }
    ])}" fill="#fff"/>
    <polygon points="${pointsAttr([
      { x: s * 0.5, y: s * 0.92 }, { x: s * 0.5, y: s * 0.7 }, { x: s * 0.32, y: s * 0.81 }
    ])}" fill="#fff"/>`,

  stop: (s) => `<rect x="${s * 0.33}" y="${s * 0.33}" width="${s * 0.34}" height="${s * 0.34}" rx="${s * 0.06}" fill="#fff"/>`,

  // Четыре уголка, расходящиеся наружу, — общепринятый знак
  // «развернуть на весь экран».
  full: (s) => {
    const a = s * 0.26, b = s * 0.74, l = s * 0.15;
    return `<g fill="none" stroke="#fff" stroke-width="${s * 0.075}"
              stroke-linecap="round" stroke-linejoin="round">
      <path d="M ${a + l} ${a} H ${a} V ${a + l}"/>
      <path d="M ${b - l} ${a} H ${b} V ${a + l}"/>
      <path d="M ${a + l} ${b} H ${a} V ${b - l}"/>
      <path d="M ${b - l} ${b} H ${b} V ${b - l}"/>
    </g>`;
  },

  // Те же уголки, повёрнутые внутрь, — «свернуть».
  fullExit: (s) => {
    const a = s * 0.24, b = s * 0.76, m1 = s * 0.44, m2 = s * 0.56, l = s * 0.14;
    return `<g fill="none" stroke="#fff" stroke-width="${s * 0.075}"
              stroke-linecap="round" stroke-linejoin="round">
      <path d="M ${a} ${m1} H ${m1} V ${a}"/>
      <path d="M ${b} ${m1} H ${m2} V ${a}"/>
      <path d="M ${a} ${m2} H ${m1} V ${b}"/>
      <path d="M ${b} ${m2} H ${m2} V ${b}"/>
    </g>`;
  },

  turbo: (s) => `<polygon points="${pointsAttr([
    { x: s * 0.58, y: s * 0.12 }, { x: s * 0.3, y: s * 0.54 }, { x: s * 0.47, y: s * 0.54 },
    { x: s * 0.42, y: s * 0.88 }, { x: s * 0.7, y: s * 0.44 }, { x: s * 0.53, y: s * 0.44 }
  ])}" fill="#fff"/>`,

  auto: (s) => `
    <g fill="none" stroke="#fff" stroke-width="${s * 0.085}" stroke-linecap="round">
      <path d="M ${s * 0.5} ${s * 0.2} A ${s * 0.3} ${s * 0.3} 0 1 1 ${s * 0.24} ${s * 0.65}"/>
    </g>
    <polygon points="${pointsAttr([
      { x: s * 0.5, y: s * 0.08 }, { x: s * 0.5, y: s * 0.32 }, { x: s * 0.7, y: s * 0.2 }
    ])}" fill="#fff"/>
    <circle cx="${s * 0.5}" cy="${s * 0.52}" r="${s * 0.07}" fill="#fff"/>`,

  soundOn: (s) => `
    <path d="M ${s * 0.24} ${s * 0.4} L ${s * 0.36} ${s * 0.4} L ${s * 0.5} ${s * 0.26}
             L ${s * 0.5} ${s * 0.74} L ${s * 0.36} ${s * 0.6} L ${s * 0.24} ${s * 0.6} Z" fill="#fff"/>
    <g fill="none" stroke="#fff" stroke-width="${s * 0.06}" stroke-linecap="round">
      <path d="M ${s * 0.6} ${s * 0.38} A ${s * 0.14} ${s * 0.14} 0 0 1 ${s * 0.6} ${s * 0.62}"/>
      <path d="M ${s * 0.69} ${s * 0.29} A ${s * 0.26} ${s * 0.26} 0 0 1 ${s * 0.69} ${s * 0.71}"/>
    </g>`,

  soundOff: (s) => `
    <path d="M ${s * 0.24} ${s * 0.4} L ${s * 0.36} ${s * 0.4} L ${s * 0.5} ${s * 0.26}
             L ${s * 0.5} ${s * 0.74} L ${s * 0.36} ${s * 0.6} L ${s * 0.24} ${s * 0.6} Z" fill="#fff"/>
    <g stroke="#fff" stroke-width="${s * 0.07}" stroke-linecap="round">
      <line x1="${s * 0.6}" y1="${s * 0.38}" x2="${s * 0.8}" y2="${s * 0.62}"/>
      <line x1="${s * 0.8}" y1="${s * 0.38}" x2="${s * 0.6}" y2="${s * 0.62}"/>
    </g>`,

  menu: (s) => `<g stroke="#fff" stroke-width="${s * 0.08}" stroke-linecap="round">
      <line x1="${s * 0.28}" y1="${s * 0.35}" x2="${s * 0.72}" y2="${s * 0.35}"/>
      <line x1="${s * 0.28}" y1="${s * 0.5}"  x2="${s * 0.72}" y2="${s * 0.5}"/>
      <line x1="${s * 0.28}" y1="${s * 0.65}" x2="${s * 0.72}" y2="${s * 0.65}"/>
    </g>`,

  info: (s) => `
    <circle cx="${s * 0.5}" cy="${s * 0.29}" r="${s * 0.055}" fill="#fff"/>
    <rect x="${s * 0.445}" y="${s * 0.4}" width="${s * 0.11}" height="${s * 0.32}" rx="${s * 0.055}" fill="#fff"/>`,

  close: (s) => `<g stroke="#fff" stroke-width="${s * 0.09}" stroke-linecap="round">
      <line x1="${s * 0.32}" y1="${s * 0.32}" x2="${s * 0.68}" y2="${s * 0.68}"/>
      <line x1="${s * 0.68}" y1="${s * 0.32}" x2="${s * 0.32}" y2="${s * 0.68}"/>
    </g>`,

  plus: (s) => `<g stroke="#fff" stroke-width="${s * 0.1}" stroke-linecap="round">
      <line x1="${s * 0.3}" y1="${s * 0.5}" x2="${s * 0.7}" y2="${s * 0.5}"/>
      <line x1="${s * 0.5}" y1="${s * 0.3}" x2="${s * 0.5}" y2="${s * 0.7}"/>
    </g>`,

  minus: (s) => `<g stroke="#fff" stroke-width="${s * 0.1}" stroke-linecap="round">
      <line x1="${s * 0.3}" y1="${s * 0.5}" x2="${s * 0.7}" y2="${s * 0.5}"/>
    </g>`,

  history: (s) => `
    <circle cx="${s * 0.5}" cy="${s * 0.5}" r="${s * 0.28}" fill="none" stroke="#fff" stroke-width="${s * 0.075}"/>
    <g stroke="#fff" stroke-width="${s * 0.075}" stroke-linecap="round">
      <line x1="${s * 0.5}" y1="${s * 0.5}" x2="${s * 0.5}" y2="${s * 0.31}"/>
      <line x1="${s * 0.5}" y1="${s * 0.5}" x2="${s * 0.64}" y2="${s * 0.58}"/>
    </g>`,

  chevronDown: (s) => `<polyline points="${s * 0.32},${s * 0.42} ${s * 0.5},${s * 0.6} ${s * 0.68},${s * 0.42}"
      fill="none" stroke="#fff" stroke-width="${s * 0.09}" stroke-linecap="round" stroke-linejoin="round"/>`
};

/**
 * Круглая кнопка: золотое кольцо, стеклянная сердцевина, иконка.
 * variant: primary — крупная жёлтая, ghost — тёмная вспомогательная.
 */
function roundButton(size, icon, { variant = "ghost", disabled = false } = {}) {
  const s = size;
  const r = s * 0.46;
  const ringW = variant === "primary" ? s * 0.075 : s * 0.055;
  const core = variant === "primary" ? "url(#coreHot)" : "url(#glass)";
  const ring = disabled ? "#4A4458" : "url(#goldRim)";

  const defs = `
    ${baseDefs}
    ${radial("coreHot", "#FFDA6B", "#E08A0B", "50%", "36%", "72%")}
    ${radial("coreGlow", P.gold + "AA", P.gold + "00")}
  `;

  const body = `
    ${variant === "primary" && !disabled
      ? `<circle cx="${s / 2}" cy="${s / 2}" r="${r * 1.12}" fill="url(#coreGlow)"/>`
      : ""}
    <g filter="url(#shadow)" ${disabled ? 'opacity="0.45"' : ""}>
      <!-- торец кольца -->
      <circle cx="${s / 2}" cy="${s / 2 + s * 0.022}" r="${r}" fill="#4A2A02"/>
      <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="${ring}"/>
      <g filter="url(#innerBtn)">
        <circle cx="${s / 2}" cy="${s / 2}" r="${r - ringW}" fill="${core}"/>
      </g>
      <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="url(#gloss)"/>
      <path d="M ${s / 2 - (r - ringW) * 0.72} ${s / 2 - (r - ringW) * 0.4}
               A ${r - ringW} ${r - ringW} 0 0 1 ${s / 2 + (r - ringW) * 0.72} ${s / 2 - (r - ringW) * 0.4}"
            fill="none" stroke="#ffffff" stroke-width="${s * 0.03}" opacity="${variant === "primary" ? 0.5 : 0.22}"
            stroke-linecap="round"/>
    </g>
    <g ${disabled ? 'opacity="0.4"' : ""}
       ${variant === "primary" ? `style="filter:drop-shadow(0 ${s * 0.012}px ${s * 0.012}px rgba(60,30,0,.55))"` : ""}>
      ${icon(s)}
    </g>`;

  return svgDoc(s, s, defs, body);
}

/* ─────────────────────────── панели / плашки ────────────────────── */

/** Nine-slice плашка «тёмное стекло в золотой оправе». */
function panel(size = 96) {
  const defs = `${baseDefs}`;
  const body = `
    <rect x="3" y="3" width="${size - 6}" height="${size - 6}" rx="18"
          fill="url(#goldRim)" filter="url(#shadow)"/>
    <rect x="7" y="7" width="${size - 14}" height="${size - 14}" rx="14" fill="${P.goldShadow}"/>
    <rect x="9" y="9" width="${size - 18}" height="${size - 18}" rx="12" fill="url(#glass)"/>
    <rect x="13" y="13" width="${size - 26}" height="${(size - 26) * 0.4}" rx="9"
          fill="#ffffff" opacity="0.07"/>`;
  return svgDoc(size, size, defs, body);
}

/**
 * Нижняя панель управления. Отдельная плашка, а не заливка прямоугольником:
 * золотая планка сверху и стеклянная толща под ней визуально «закрывают»
 * композицию снизу, иначе интерфейс выглядит оборванным.
 */
function panelBar(size = 128) {
  const defs = `
    ${baseDefs}
    ${linearV("barGlass", [["0%", "#0A2C3E", 0.97], ["45%", "#05161F", 0.99], ["100%", "#02080D", 1]])}
    ${linear("barRail", [["0%", P.goldLight], ["40%", P.gold], ["100%", P.goldDeep]], 180)}
  `;
  const rail = 10;
  const body = `
    <rect x="0" y="${rail}" width="${size}" height="${size - rail}" fill="url(#barGlass)"/>
    <rect x="0" y="0" width="${size}" height="${rail}" fill="url(#barRail)"/>
    <rect x="0" y="${rail}" width="${size}" height="3" fill="${P.goldShadow}" opacity="0.7"/>
    <rect x="0" y="${rail + 3}" width="${size}" height="14" fill="${P.goldPale}" opacity="0.06"/>
  `;
  return svgDoc(size, size, defs, body);
}

/** Утопленная плашка под счётчиком: баланс и ставка должны читаться как табло. */
function meterPlate(size = 96) {
  const defs = `
    ${baseDefs}
    ${linear("meterGlass", [["0%", "#02090F"], ["55%", "#07222E"], ["100%", "#020A10"]], 90)}
  `;
  const body = `
    <rect x="3" y="3" width="${size - 6}" height="${size - 6}" rx="14"
          fill="${P.goldShadow}" opacity="0.9"/>
    <g filter="url(#innerBtn)">
      <rect x="6" y="6" width="${size - 12}" height="${size - 12}" rx="12" fill="url(#meterGlass)"/>
    </g>
    <rect x="6" y="6" width="${size - 12}" height="${size - 12}" rx="12"
          fill="none" stroke="${P.goldMid}" stroke-width="2" opacity="0.55"/>
  `;
  return svgDoc(size, size, defs, body);
}

/** Плашка без золота — для второстепенных блоков (история, правила). */
function panelDark(size = 96) {
  const defs = `${baseDefs}`;
  const body = `
    <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="16"
          fill="#000000" opacity="0.55"/>
    <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="16"
          fill="none" stroke="${P.goldDeep}" stroke-width="2" opacity="0.7"/>`;
  return svgDoc(size, size, defs, body);
}

/* ──────────────────────── рамка барабанов ───────────────────────── */

/**
 * Рамка вокруг игрового поля 5×3. Пропорции жёстко связаны
 * с сеткой: внутреннее окно — ровно 1000×600 «дизайнерских» пикселей.
 */
function reelFrame() {
  const W = 1120;
  const H = 720;
  const inset = 60; // толщина оправы
  const iw = W - inset * 2;
  const ih = H - inset * 2;

  const defs = `
    ${baseDefs}
    ${linear("frameMetal", [
      ["0%", P.goldLight], ["12%", P.goldPale], ["30%", P.gold],
      ["50%", P.goldMid], ["70%", P.goldDeep], ["88%", P.goldMid], ["100%", P.goldPale]
    ], 90)}
    ${linear("innerWell", [["0%", "#03151F"], ["45%", "#0A3346"], ["100%", "#02090F"]], 90)}
    ${linear("frameEdgeTop", [["0%", P.goldLight], ["100%", P.goldPale]], 90)}
    ${dropShadow("frameShadow", 8, 14, 0.65)}
  `;

  // Декоративные «заклёпки» по периметру оправы.
  let rivets = "";
  for (let i = 0; i <= 10; i++) {
    const x = inset / 2 + (i * (W - inset)) / 10;
    rivets += `<circle cx="${x}" cy="${inset / 2}" r="7" fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="2"/>`;
    rivets += `<circle cx="${x}" cy="${H - inset / 2}" r="7" fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="2"/>`;
  }
  for (let i = 1; i < 6; i++) {
    const y = inset / 2 + (i * (H - inset)) / 6;
    rivets += `<circle cx="${inset / 2}" cy="${y}" r="7" fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="2"/>`;
    rivets += `<circle cx="${W - inset / 2}" cy="${y}" r="7" fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="2"/>`;
  }

  const corner = (cx, cy, flipX, flipY) => `
    <g transform="translate(${cx} ${cy}) scale(${flipX} ${flipY})">
      <path d="M 0 0 L 96 0 Q 52 12 30 34 Q 12 56 0 96 Z"
            fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="30" cy="30" r="15" fill="${P.royal}" stroke="${P.goldShadow}" stroke-width="3"/>
      <circle cx="30" cy="30" r="8" fill="${GEMS.ruby.base}"/>
      <circle cx="27" cy="27" r="3" fill="#fff" opacity="0.8"/>
    </g>`;

  const body = `
    <g filter="url(#frameShadow)">
      <rect x="0" y="0" width="${W}" height="${H}" rx="34" fill="url(#frameMetal)"/>
      <rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="26"
            fill="none" stroke="${P.goldShadow}" stroke-width="3" opacity="0.8"/>
      <rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="20"
            fill="none" stroke="${P.goldLight}" stroke-width="2" opacity="0.45"/>
    </g>

    <!-- глянец по металлу оправы -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="34" fill="url(#gloss)"/>

    <!-- окно под барабаны: утоплено, поэтому с внутренней тенью -->
    <g filter="url(#innerWellShadow)">
      <rect x="${inset}" y="${inset}" width="${iw}" height="${ih}" rx="14" fill="url(#innerWell)"/>
    </g>
    <rect x="${inset}" y="${inset}" width="${iw}" height="${ih}" rx="14"
          fill="none" stroke="${P.goldShadow}" stroke-width="6"/>
    <rect x="${inset + 4}" y="${inset + 4}" width="${iw - 8}" height="${ih - 8}" rx="11"
          fill="none" stroke="${P.goldPale}" stroke-width="2" opacity="0.35"/>
    <!-- нижняя кромка окна ловит отражённый свет -->
    <path d="M ${inset + 14} ${inset + ih - 3} H ${inset + iw - 14}"
          stroke="${P.goldPale}" stroke-width="3" opacity="0.28" stroke-linecap="round"/>

    <!-- герб по центру верхней планки: без него рамка читается
         как просто прямоугольник -->
    <g transform="translate(${W / 2} ${inset / 2})">
      <path d="M -104 6 Q -70 -30 0 -34 Q 70 -30 104 6 Q 70 34 0 38 Q -70 34 -104 6 Z"
            fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M -86 4 Q -58 -20 0 -23 Q 58 -20 86 4"
            fill="none" stroke="${P.goldLight}" stroke-width="3" opacity="0.6"/>
      <g transform="translate(0 2)">
        <polygon points="${pointsAttr(ngon(0, 0, 21, 8, -67.5))}"
                 fill="${P.royal}" stroke="${P.goldShadow}" stroke-width="3.5"/>
        <polygon points="${pointsAttr(ngon(0, 0, 14, 8, -67.5))}" fill="${GEMS.ruby.base}"/>
        <polygon points="${pointsAttr(ngon(0, 0, 7, 8, -67.5))}" fill="${GEMS.ruby.light}"/>
        <circle cx="-5" cy="-6" r="3.5" fill="#fff" opacity="0.85"/>
      </g>
      ${[-1, 1].map((sx) => `
        <path d="M ${sx * 108} 6 q ${sx * 26} -20 ${sx * 52} -4 q ${sx * -20} 6 ${sx * -22} 20
                 q ${sx * -10} -14 ${sx * -30} -16 Z"
              fill="url(#goldRim)" stroke="${P.goldShadow}" stroke-width="3" stroke-linejoin="round"/>`).join("")}
    </g>

    ${rivets}
    ${corner(0, 0, 1, 1)}
    ${corner(W, 0, -1, 1)}
    ${corner(0, H, 1, -1)}
    ${corner(W, H, -1, -1)}
  `;
  return svgDoc(W, H, defs, body);
}

/** Разделитель между барабанами — тонкая золотая колонна. */
function reelDivider() {
  const W = 10;
  const H = 600;
  const defs = `${linear("div", [["0%", P.goldDeep + "00"], ["15%", P.goldMid], ["50%", P.goldPale], ["85%", P.goldMid], ["100%", P.goldDeep + "00"]], 0)}`;
  const body = `<rect x="3" y="0" width="4" height="${H}" fill="url(#div)" opacity="0.65"/>`;
  return svgDoc(W, H, defs, body);
}

/* ───────────────────────── подсветка выигрыша ───────────────────── */

/** Рамка, которая вспыхивает вокруг выигравшего символа. */
function winFrame() {
  const S = 224;
  const defs = `
    ${baseDefs}
    ${glowFilter("winGlow", 9, "#FFE082", 1)}
  `;
  const pad = 14;
  const body = `
    <g filter="url(#winGlow)">
      <rect x="${pad}" y="${pad}" width="${S - pad * 2}" height="${S - pad * 2}" rx="18"
            fill="none" stroke="url(#gold)" stroke-width="7"/>
      ${[[pad, pad], [S - pad, pad], [pad, S - pad], [S - pad, S - pad]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${P.goldLight}"/>`)
        .join("")}
    </g>`;
  return svgDoc(S, S, defs, body);
}

/** Лучи, медленно вращающиеся за выигравшим символом. */
function winRays() {
  const S = 320;
  const c = S / 2;
  const defs = `
    ${linear("rayFade", [["0%", "#FFF3C4", 0.95], ["55%", "#F7C948", 0.4], ["100%", "#F7C948", 0]], 90)}
    ${radial("rayCore", "#FFF3C4CC", "#FFF3C400")}
    ${blurFilter("raySoft", 3)}
  `;
  let rays = "";
  const count = 14;
  for (let i = 0; i < count; i++) {
    const a = (360 / count) * i;
    const wide = i % 2 === 0 ? 5.5 : 2.6;
    const len = i % 2 === 0 ? c * 0.98 : c * 0.66;
    const p1 = polar(c, c, c * 0.1, a - wide);
    const p2 = polar(c, c, len, a - wide * 0.32);
    const p3 = polar(c, c, len, a + wide * 0.32);
    const p4 = polar(c, c, c * 0.1, a + wide);
    rays += `<polygon points="${pointsAttr([p1, p2, p3, p4])}" fill="url(#rayFade)"/>`;
  }
  return svgDoc(S, S, defs, `
    <g filter="url(#raySoft)">${rays}</g>
    <circle cx="${c}" cy="${c}" r="${c * 0.42}" fill="url(#rayCore)"/>
  `);
}

/** Мягкое пятно света под выигравшим символом. */
function cellGlow() {
  const S = 256;
  const defs = radial("cg", "#FFE08299", "#FFE08200");
  return svgDoc(S, S, defs, `<circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}" fill="url(#cg)"/>`);
}

/* ──────────────────────────── частицы ───────────────────────────── */

function coinParticle() {
  const S = 64;
  const defs = `${goldGradient("gold", P, 60)}${dropShadow("shadow", 2, 3, 0.45)}`;
  const body = `
    <g filter="url(#shadow)">
      <circle cx="32" cy="32" r="28" fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="3"/>
      <circle cx="32" cy="32" r="19" fill="none" stroke="${P.goldShadow}" stroke-width="2.5" opacity="0.65"/>
      ${metalText("C", { x: 32, y: 34, size: 26, fill: P.goldShadow, stroke: "none", strokeWidth: 0, family: "Lora" })}
      <circle cx="23" cy="22" r="6" fill="#fff" opacity="0.65"/>
    </g>`;
  return svgDoc(S, S, defs, body);
}

function sparkParticle() {
  const S = 48;
  const defs = radial("sp", "#FFFFFF", "#FFD86A00");
  return svgDoc(S, S, defs, `
    <circle cx="24" cy="24" r="24" fill="url(#sp)" opacity="0.85"/>
    ${sparkle(24, 24, 20, 1)}`);
}

function starParticle() {
  const S = 64;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 30 : 12;
    pts.push(polar(32, 32, r, -90 + i * 36));
  }
  const defs = `${goldGradient("gold", P, 90)}${glowFilter("g", 5, P.goldPale, 0.9)}`;
  return svgDoc(S, S, defs, `<polygon points="${pointsAttr(pts)}" fill="url(#gold)"
    stroke="${P.goldShadow}" stroke-width="2" filter="url(#g)"/>`);
}

function glowDot() {
  const S = 64;
  return svgDoc(S, S, radial("gd", "#FFFFFFDD", "#FFFFFF00"), `<circle cx="32" cy="32" r="32" fill="url(#gd)"/>`);
}

/* ──────────────────────────── логотип ───────────────────────────── */

function logo() {
  const W = 900;
  const H = 300;
  const defs = `
    ${baseDefs}
    ${radial("logoAura", S.sun + "77", S.sun + "00")}
    ${radial("sunDisc", S.sunCore, S.sun)}
    ${glowFilter("logoGlow", 12, S.sun, 0.9)}
  `;
  const body = `
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2}" ry="${H / 2}" fill="url(#logoAura)"/>

    <!-- солнце над надписью и волна под ней -->
    <circle cx="${W / 2}" cy="86" r="52" fill="url(#sunDisc)" opacity="0.95"/>
    <circle cx="${W / 2}" cy="86" r="52" fill="none" stroke="${P.goldPale}" stroke-width="3" opacity="0.6"/>
    <path d="M ${W / 2 - 190} 112 q 60 -26 120 0 q 60 26 120 0 q 60 -26 120 0"
          fill="none" stroke="${S.seaLight}" stroke-width="7" stroke-linecap="round" opacity="0.85"/>

    ${metalText("СОЧИ", {
      x: W / 2, y: 186, size: 96, family: "Lora", weight: 700,
      fill: "url(#gold)", stroke: P.goldShadow, strokeWidth: 10,
      letterSpacing: 14, filter: "url(#logoGlow)"
    })}
    ${metalText("SUNSET", {
      x: W / 2, y: 250, size: 44, family: "Poppins", weight: 700,
      fill: "url(#gold)", stroke: P.goldShadow, strokeWidth: 6, letterSpacing: 16
    })}
    ${sparkle(W / 2 - 250, 150, 22, 0.9)}
    ${sparkle(W / 2 + 258, 176, 17, 0.8)}
  `;
  return svgDoc(W, H, defs, body);
}

/* ─────────────────── баннеры больших выигрышей ──────────────────── */

function winBanner(text, colorA, colorB) {
  const W = 900;
  const H = 260;
  const defs = `
    ${baseDefs}
    ${linear("bannerFill", [["0%", colorA], ["100%", colorB]], 90)}
    ${radial("bannerAura", colorA + "88", colorA + "00")}
    ${glowFilter("bGlow", 14, colorA, 0.9)}
  `;
  const body = `
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2}" ry="${H / 2}" fill="url(#bannerAura)"/>
    <g filter="url(#shadowDeep)">
      <path d="M 20 ${H / 2} L 92 60 L ${W - 92} 60 L ${W - 20} ${H / 2} L ${W - 92} ${H - 60} L 92 ${H - 60} Z"
            fill="url(#bannerFill)" stroke="url(#gold)" stroke-width="7" stroke-linejoin="round"/>
      <path d="M 104 78 L ${W - 104} 78" stroke="#ffffff" stroke-width="6" opacity="0.25" stroke-linecap="round"/>
    </g>
    ${metalText(text, {
      x: W / 2, y: H / 2 + 6, size: 84, family: "Poppins", weight: 700,
      fill: "url(#gold)", stroke: P.goldShadow, strokeWidth: 9,
      letterSpacing: 6, filter: "url(#bGlow)"
    })}
  `;
  return svgDoc(W, H, defs, body);
}

/* ───────────────────── бейдж номера линии выплат ────────────────── */

function lineBadge() {
  const S = 56;
  const defs = `${baseDefs}`;
  const body = `
    <circle cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 3}" fill="url(#goldRim)" filter="url(#shadow)"/>
    <circle cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 8}" fill="${P.ink}"/>`;
  return svgDoc(S, S, defs, body);
}

/* ──────────────────────────── экспорт ───────────────────────────── */

const RAW_UI = [
  // кнопки
  { name: "btn_spin", draw: () => roundButton(180, ICONS.spin, { variant: "primary" }) },
  { name: "btn_spin_disabled", draw: () => roundButton(180, ICONS.spin, { variant: "primary", disabled: true }) },
  { name: "btn_stop", draw: () => roundButton(180, ICONS.stop, { variant: "primary" }) },
  { name: "btn_turbo", draw: () => roundButton(92, ICONS.turbo) },
  { name: "btn_auto", draw: () => roundButton(92, ICONS.auto) },
  { name: "btn_sound_on", draw: () => roundButton(76, ICONS.soundOn) },
  { name: "btn_sound_off", draw: () => roundButton(76, ICONS.soundOff) },
  { name: "btn_menu", draw: () => roundButton(76, ICONS.menu) },
  { name: "btn_info", draw: () => roundButton(76, ICONS.info) },
  { name: "btn_history", draw: () => roundButton(76, ICONS.history) },
  { name: "btn_full", draw: () => roundButton(76, ICONS.full) },
  { name: "btn_full_exit", draw: () => roundButton(76, ICONS.fullExit) },
  { name: "btn_close", draw: () => roundButton(76, ICONS.close) },
  { name: "btn_plus", draw: () => roundButton(76, ICONS.plus) },
  { name: "btn_minus", draw: () => roundButton(76, ICONS.minus) },
  { name: "btn_chevron", draw: () => roundButton(64, ICONS.chevronDown) },

  // панели (nine-slice)
  { name: "panel", draw: () => panel(96), slice: [26, 26, 26, 26] },
  { name: "panel_dark", draw: () => panelDark(96), slice: [22, 22, 22, 22] },
  { name: "panel_bar", draw: () => panelBar(128), slice: [8, 56, 8, 40] },
  { name: "meter_plate", draw: () => meterPlate(96), slice: [30, 30, 30, 30] },

  // игровое поле
  { name: "reel_frame", draw: reelFrame },
  { name: "reel_divider", draw: reelDivider },
  { name: "win_frame", draw: winFrame },
  { name: "win_rays", draw: winRays },
  { name: "cell_glow", draw: cellGlow },
  { name: "line_badge", draw: lineBadge },

  // частицы
  { name: "p_coin", draw: coinParticle },
  { name: "p_spark", draw: sparkParticle },
  { name: "p_star", draw: starParticle },
  { name: "p_glow", draw: glowDot },

  // брендинг и баннеры
  { name: "logo", draw: logo },
  { name: "banner_big", draw: () => winBanner("BIG WIN", "#F7C948", "#B35A00") },
  { name: "banner_mega", draw: () => winBanner("MEGA WIN", "#FF7AC8", "#8A0F63") },
  { name: "banner_epic", draw: () => winBanner("EPIC WIN", "#63EFFF", "#0A4FA8") },
  { name: "banner_free", draw: () => winBanner("FREE SPINS", "#7CFFB0", "#0A6B44") }
];

export const UI_ASSETS = RAW_UI.map((a) => ({
  name: a.name,
  slice: a.slice || null,
  svg: () => namespaceSvg(a.draw(), a.name)
}));
