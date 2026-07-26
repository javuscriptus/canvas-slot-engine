// 12 игровых символов слота «Sochi Sunset».
//
// ID здесь обязаны совпадать с SYMBOL_KEYS в server/src/math/gameConfig.js —
// это контракт между математикой и графикой: индекс в ленте и есть id символа.
//
// Пять премиальных знаков — курортные предметы, пять младших — леденцы-
// самоцветы, плюс дикий и скаттер. Такое разделение читается мгновенно:
// «вещь» дороже «камешка».
//
// Любой символ можно заменить готовым PNG: положите art/symbols/<ключ>.png,
// и сборка возьмёт файл вместо этой отрисовки.

import { PALETTE as P, SOCHI as S, SOCHI_GEMS as GEMS } from "./palette.mjs";
import {
  facetedGem, gemDefs, goldGradient, radial, linear, linearV, dropShadow,
  blurFilter, glowFilter, metalText, svgDoc, ngon, pointsAttr, shade,
  sparkle, polar, namespaceSvg, innerShadow, extrude, contactShadow, gloss, mix,
  sculpt
} from "./svg-lib.mjs";

const SIZE = 256;

/**
 * Сборка символа.
 *
 * Всё содержимое проходит через один фильтр лепки и получает общий
 * световой слой сверху. Раньше каждый символ был набором плоских
 * заливок с градиентом — на барабане это читалось как аппликация.
 * Один источник света на все двенадцать символов важнее любой
 * детализации: именно совпадение света склеивает их в один комплект.
 */
function symbolDoc(defs, body) {
  // Заливка светом во весь кадр здесь была ошибкой: прямоугольник
  // непрозрачен и превращал символ в плитку с фоном. Направленность
  // даёт сама отрисовка, а фильтр добавляет только фактуру поверхности.
  return svgDoc(SIZE, SIZE, defs, `<g filter="url(#sculpt)">${body}</g>`);
}

/* ─────────────────────── общее оформление ───────────────────────── */

const commonDefs = `
  ${goldGradient("gold", P, 90)}
  ${linear("goldRim", [["0%", P.goldLight], ["50%", P.goldMid], ["100%", P.goldDeep]], 90)}
  ${dropShadow("shadow", 5, 5, 0.55)}
  ${dropShadow("shadowSoft", 3, 7, 0.4)}
  ${blurFilter("soft", 4)}
  ${blurFilter("softer", 9)}
  ${blurFilter("contactBlur", 7)}
  ${innerShadow("innerDeep", { dy: 6, blur: 6, opacity: 0.62 })}
  ${gloss("gloss")}
  ${glowFilter("goldGlow", 7, P.gold, 0.85)}
  ${sculpt("sculpt")}
`;

/** Тёплый ореол под премиальным символом — «солнце за предметом». */
function halo(color, opacity = 0.5) {
  return `<circle cx="128" cy="128" r="122" fill="url(#halo)" opacity="${opacity}"/>`;
}

function haloDef(color) {
  return radial("halo", color + "AA", color + "00");
}

function rays(cx, cy, count, radius, color, opacity) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const a = (360 / count) * i;
    const p1 = polar(cx, cy, radius * 0.1, a - 360 / count / 4);
    const p2 = polar(cx, cy, radius, a);
    const p3 = polar(cx, cy, radius * 0.1, a + 360 / count / 4);
    out += `<polygon points="${pointsAttr([p1, p2, p3])}" fill="${color}"/>`;
  }
  return `<g opacity="${opacity}" filter="url(#soft)">${out}</g>`;
}

/* ───────────────────────────── ЯКОРЬ ────────────────────────────── */

function anchor() {
  const defs = `
    ${commonDefs}
    ${haloDef(S.sun)}
    ${linear("ribbon", [["0%", "#FF6B86"], ["50%", "#D31E45"], ["100%", "#8C0A26"]], 90)}
    ${linear("rope", [["0%", S.sand], ["50%", S.sandDark], ["100%", "#8A6A34"]], 90)}
  `;
  // Якорь поднят и ужат, а лента опущена. В прошлой версии лапы якоря
  // упирались в ленту, и на масштабе ячейки они слипались в одно золотое
  // пятно: глаз не успевал разделить силуэт и надпись.
  const body = `
    ${halo(S.sun, 0.55)}
    ${rays(128, 110, 16, 118, S.sun, 0.24)}
    ${contactShadow(128, 250, 66, 8, 0.42)}

    <!-- канат кольцом -->
    <circle cx="128" cy="118" r="88" fill="none" stroke="url(#rope)" stroke-width="12"
            stroke-dasharray="16 10" stroke-linecap="round" opacity="0.9"/>

    <g filter="url(#shadow)" transform="translate(128 110) scale(0.86) translate(-128 -122)">
      ${extrude("M 118 44 h 20 v 160 h -20 Z", { dy: 9, color: "#3A2000", isPath: true })}
      <!-- шток -->
      <rect x="118" y="44" width="20" height="162" rx="8"
            fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="4"/>
      <!-- рым -->
      <circle cx="128" cy="46" r="24" fill="none" stroke="url(#gold)" stroke-width="13"/>
      <circle cx="128" cy="46" r="24" fill="none" stroke="${P.goldShadow}" stroke-width="2.5"/>
      <!-- поперечина -->
      <rect x="70" y="84" width="116" height="17" rx="8"
            fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="3.5"/>
      <!-- лапы -->
      <path d="M 128 206
               C 84 206 50 178 44 138
               L 66 132
               C 74 164 98 184 128 184
               C 158 184 182 164 190 132
               L 212 138
               C 206 178 172 206 128 206 Z"
            fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="4" stroke-linejoin="round"/>
      <polygon points="${pointsAttr([{ x: 32, y: 118 }, { x: 58, y: 150 }, { x: 30, y: 152 }])}"
               fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="3.5" stroke-linejoin="round"/>
      <polygon points="${pointsAttr([{ x: 224, y: 118 }, { x: 198, y: 150 }, { x: 226, y: 152 }])}"
               fill="url(#gold)" stroke="${P.goldShadow}" stroke-width="3.5" stroke-linejoin="round"/>
    </g>

    <!-- лента с названием -->
    <g filter="url(#shadowSoft)">
      <path d="M 6 210 L 30 198 L 30 248 L 6 236 Z" fill="#8C0A26"/>
      <path d="M 250 210 L 226 198 L 226 248 L 250 236 Z" fill="#8C0A26"/>
      <rect x="22" y="194" width="212" height="50" rx="8" fill="url(#ribbon)"
            stroke="${P.goldDeep}" stroke-width="3"/>
      <rect x="28" y="200" width="200" height="9" rx="4" fill="#fff" opacity="0.22"/>
    </g>
    ${metalText("СОЧИ", {
      x: 128, y: 220, size: 34, family: "Lora", weight: 700,
      fill: "url(#gold)", stroke: P.goldShadow, strokeWidth: 5,
      letterSpacing: 3, filter: "url(#goldGlow)"
    })}

    ${sparkle(202, 54, 17, 0.9)}
    ${sparkle(50, 84, 11, 0.7)}
  `;
  return symbolDoc(defs, body);
}

/* ─────────────────────────── МОРОЖЕНОЕ ──────────────────────────── */

function iceCream() {
  const defs = `
    ${commonDefs}
    ${haloDef(S.coral)}
    ${linear("cone", [["0%", "#F0C070"], ["50%", "#D19A45"], ["100%", "#9A6A22"]], 90)}
    ${radial("scoopPink", "#FFC2D6", "#FF4E7A")}
    ${radial("scoopMint", "#D9FFF2", "#3FD9B0")}
    ${radial("scoopCream", "#FFF6DC", "#FFC24F")}
  `;
  const scoop = (cx, cy, r, fill) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"
            stroke="#00000022" stroke-width="2"/>
    <ellipse cx="${cx - r * 0.32}" cy="${cy - r * 0.38}" rx="${r * 0.3}" ry="${r * 0.2}"
             fill="#ffffff" opacity="0.5" transform="rotate(-25 ${cx} ${cy})"/>`;

  const body = `
    ${halo(S.coral, 0.45)}
    ${contactShadow(128, 236, 58, 11, 0.5)}

    <g filter="url(#shadow)">
      <!-- рожок -->
      ${extrude("M 92 138 L 164 138 L 128 232 Z", { dy: 8, color: "#4A2E08", isPath: true })}
      <path d="M 92 138 L 164 138 L 128 232 Z" fill="url(#cone)"
            stroke="#7A5218" stroke-width="4" stroke-linejoin="round"/>
      <g stroke="#7A5218" stroke-width="2.5" opacity="0.55">
        <path d="M 100 156 L 140 156 M 108 176 L 150 176 M 116 196 L 140 196"/>
        <path d="M 104 148 L 122 214 M 134 140 L 146 190"/>
      </g>

      <!-- шарики -->
      ${scoop(96, 122, 40, "url(#scoopMint)")}
      ${scoop(160, 122, 40, "url(#scoopPink)")}
      ${scoop(128, 82, 44, "url(#scoopCream)")}
    </g>

    <!-- вафельная трубочка и вишня -->
    <g filter="url(#shadowSoft)">
      <rect x="176" y="34" width="15" height="62" rx="7" fill="url(#cone)"
            stroke="#7A5218" stroke-width="3" transform="rotate(22 183 65)"/>
      <path d="M 128 44 q 16 -22 34 -20" fill="none" stroke="${S.palm}" stroke-width="6"
            stroke-linecap="round"/>
      <circle cx="128" cy="46" r="17" fill="#E0203F" stroke="#8C0A20" stroke-width="3"/>
      <circle cx="121" cy="40" r="5" fill="#fff" opacity="0.75"/>
    </g>

    ${sparkle(64, 74, 14, 0.85)}
    ${sparkle(198, 148, 10, 0.6)}
  `;
  return symbolDoc(defs, body);
}

/* ──────────────────────────── ШАШЛЫК ────────────────────────────── */

function shashlik() {
  const defs = `
    ${commonDefs}
    ${haloDef(S.mango)}
    ${linear("skewer", [["0%", "#F2F5FA"], ["45%", "#AFBACD"], ["100%", "#6B7688"]], 0)}
    ${radial("meat", "#C4562A", "#6E2A10")}
    ${radial("meatLight", "#E8814A", "#8A3616")}
  `;
  /**
   * Кусок мяса.
   *
   * Прямоугольник со скруглением на просвет читается как бурый брусок —
   * в ячейке барабана 96 пикселей от него остаётся пятно. Форму спасают
   * три вещи: неровный силуэт (мясо не штампуют), тёмные полосы от решётки
   * поперёк и светлый жирок по верхнему краю. Полосы важнее всего: именно
   * они за долю секунды говорят «это шашлык», а не «это коричневое».
   */
  const piece = (y, fill, w = 78, h = 46, flip = false) => {
    const x = 128 - w / 2;
    const k = flip ? -1 : 1;
    const wob = (v) => 128 + k * v;
    const outline = `M ${x} ${y + h * 0.34}
      C ${x - 3} ${y + h * 0.1} ${wob(-w * 0.22)} ${y - 5} ${wob(-w * 0.02)} ${y + 1}
      C ${wob(w * 0.2)} ${y - 4} ${x + w + 3} ${y + h * 0.08} ${x + w} ${y + h * 0.36}
      C ${x + w + 4} ${y + h * 0.72} ${wob(w * 0.24)} ${y + h + 5} ${wob(w * 0.02)} ${y + h - 1}
      C ${wob(-w * 0.22)} ${y + h + 4} ${x - 4} ${y + h * 0.7} ${x} ${y + h * 0.34} Z`;
    return `
    <path d="${outline}" fill="${fill}" stroke="#4A1B08" stroke-width="4" stroke-linejoin="round"/>
    <!-- жирок по верхней кромке -->
    <path d="M ${x + w * 0.14} ${y + h * 0.2} q ${w * 0.36} ${-h * 0.14} ${w * 0.72} 0"
          fill="none" stroke="#FFD9A8" stroke-width="4" stroke-linecap="round" opacity="0.5"/>
    <!-- следы решётки -->
    <g stroke="#3A1405" stroke-width="5" stroke-linecap="round" opacity="0.62">
      <path d="M ${x + w * 0.24} ${y + h * 0.16} l ${-w * 0.1} ${h * 0.7}"/>
      <path d="M ${x + w * 0.52} ${y + h * 0.12} l ${-w * 0.1} ${h * 0.78}"/>
      <path d="M ${x + w * 0.8} ${y + h * 0.16} l ${-w * 0.1} ${h * 0.7}"/>
    </g>
    <ellipse cx="${128 - w * 0.2}" cy="${y + h * 0.3}" rx="${w * 0.14}" ry="${h * 0.13}"
             fill="#ffffff" opacity="0.26"/>`;
  };

  const veg = (cx, cy, r, fill, stroke) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="3.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="${stroke}" opacity="0.28"/>
    <circle cx="${cx - r * 0.3}" cy="${cy - r * 0.34}" r="${r * 0.24}" fill="#fff" opacity="0.45"/>`;

  const body = `
    ${halo(S.mango, 0.45)}
    ${contactShadow(128, 238, 62, 11, 0.5)}

    <!-- Наклон обязателен: строго вертикальный шампур целиком прячется
         за кусками, и остаётся стопка отдельных предметов. Наклонённый
         виден сверху и снизу, и силуэт сразу читается как шампур. -->
    <g filter="url(#shadow)" transform="rotate(-17 128 128)">
      <!-- шампур -->
      <rect x="121" y="10" width="14" height="234" rx="6" fill="url(#skewer)"
            stroke="#5A6474" stroke-width="3"/>
      <path d="M 128 244 l -11 -20 h 22 Z" fill="url(#skewer)" stroke="#5A6474" stroke-width="3"/>
      <circle cx="128" cy="20" r="12" fill="none" stroke="url(#skewer)" stroke-width="6"/>

      ${piece(46, "url(#meatLight)", 88, 48)}
      ${veg(128, 110, 21, "#E03A2A", "#8C1408")}
      ${piece(124, "url(#meat)", 88, 48, true)}
      ${veg(128, 186, 20, "#3FA84F", "#14531F")}
      ${piece(200, "url(#meatLight)", 78, 42)}
    </g>

    ${sparkle(70, 66, 13, 0.8)}
    ${sparkle(192, 168, 10, 0.6)}
  `;
  return symbolDoc(defs, body);
}

/* ──────────────────── ШЛЯПА С ОЧКАМИ ────────────────────────────── */

function sunHat() {
  const defs = `
    ${commonDefs}
    ${haloDef(S.sand)}
    ${linear("straw", [["0%", "#FFEDC4"], ["45%", "#F0D9A8"], ["100%", "#C9A46B"]], 90)}
    ${linear("strawDark", [["0%", "#E0C48C"], ["100%", "#A8823F"]], 90)}
    ${linear("band", [["0%", "#FF7FA6"], ["50%", "#E0295C"], ["100%", "#8C0A2E"]], 90)}
    ${linear("lens", [["0%", "#5FD6F0"], ["45%", "#177FA8"], ["100%", "#062E45"]], 120)}
  `;
  const body = `
    ${halo(S.sand, 0.5)}
    ${contactShadow(128, 224, 90, 13, 0.5)}

    <g filter="url(#shadow)">
      <!-- поля -->
      ${extrude("M 16 176 q 112 -54 224 0 q -112 46 -224 0 Z", { dy: 9, color: "#8A6A34", isPath: true })}
      <path d="M 16 176 q 112 -54 224 0 q -112 46 -224 0 Z"
            fill="url(#straw)" stroke="#8A6A34" stroke-width="4" stroke-linejoin="round"/>
      <path d="M 40 174 q 88 -34 176 0" fill="none" stroke="#B4903F" stroke-width="3" opacity="0.55"/>

      <!-- тулья -->
      <path d="M 66 168 q 6 -100 62 -100 q 56 0 62 100 q -62 22 -124 0 Z"
            fill="url(#strawDark)" stroke="#8A6A34" stroke-width="4" stroke-linejoin="round"/>
      <g stroke="#B4903F" stroke-width="2.2" opacity="0.5">
        <path d="M 74 140 q 54 16 108 0 M 78 116 q 50 14 100 0 M 84 92 q 44 12 88 0"/>
      </g>

      <!-- лента -->
      <path d="M 66 150 q 62 22 124 0 l 4 20 q -66 22 -132 0 Z"
            fill="url(#band)" stroke="#6E0722" stroke-width="3"/>
      <path d="M 190 150 l 30 -12 l -4 26 l 24 6 l -34 12 Z"
            fill="url(#band)" stroke="#6E0722" stroke-width="3" stroke-linejoin="round"/>
    </g>

    <!-- очки на полях -->
    <g filter="url(#shadowSoft)">
      <rect x="46" y="176" width="66" height="42" rx="16" fill="url(#lens)"
            stroke="${P.goldDeep}" stroke-width="4"/>
      <rect x="144" y="176" width="66" height="42" rx="16" fill="url(#lens)"
            stroke="${P.goldDeep}" stroke-width="4"/>
      <path d="M 112 190 q 16 -8 32 0" fill="none" stroke="${P.goldDeep}" stroke-width="6"
            stroke-linecap="round"/>
      <path d="M 56 184 q 14 -4 24 2" fill="none" stroke="#ffffff" stroke-width="5"
            opacity="0.55" stroke-linecap="round"/>
      <path d="M 154 184 q 14 -4 24 2" fill="none" stroke="#ffffff" stroke-width="5"
            opacity="0.55" stroke-linecap="round"/>
    </g>

    ${sparkle(206, 74, 15, 0.85)}
  `;
  return symbolDoc(defs, body);
}

/* ───────────────────── БОКАЛ С ВИНОГРАДОМ ───────────────────────── */

function wineGrapes() {
  const defs = `
    ${commonDefs}
    ${haloDef(S.coral)}
    ${linear("glassBody", [["0%", "#FFFFFF", 0.5], ["55%", "#CFE8F5", 0.35], ["100%", "#FFFFFF", 0.22]], 0)}
    ${linear("wine", [["0%", "#FF6B86"], ["45%", "#C4123C"], ["100%", "#78061F"]], 90)}
    ${radial("grape", "#B47FE8", "#4A177F")}
  `;
  const grape = (cx, cy, r) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#grape)" stroke="#33095C" stroke-width="2.5"/>
    <circle cx="${cx - r * 0.3}" cy="${cy - r * 0.34}" r="${r * 0.26}" fill="#fff" opacity="0.45"/>`;

  const body = `
    ${halo(S.coral, 0.45)}
    ${contactShadow(128, 236, 66, 11, 0.5)}

    <!-- бокал -->
    <g filter="url(#shadow)">
      <path d="M 66 40 h 92 l -8 62 a 38 46 0 0 1 -76 0 Z"
            fill="url(#glassBody)" stroke="#DCEAF2" stroke-width="4" stroke-linejoin="round"/>
      <path d="M 72 62 h 80 l -6 40 a 34 40 0 0 1 -68 0 Z" fill="url(#wine)"/>
      <ellipse cx="112" cy="62" rx="40" ry="9" fill="#FF8FA6" opacity="0.65"/>
      <rect x="105" y="140" width="14" height="62" rx="6" fill="url(#glassBody)"
            stroke="#DCEAF2" stroke-width="3"/>
      <ellipse cx="112" cy="208" rx="46" ry="13" fill="url(#glassBody)"
               stroke="#DCEAF2" stroke-width="4"/>
      <path d="M 80 52 l -4 44" stroke="#ffffff" stroke-width="6" opacity="0.6"
            stroke-linecap="round"/>
    </g>

    <!-- гроздь -->
    <g filter="url(#shadowSoft)">
      <path d="M 196 92 q 6 -26 -12 -40" fill="none" stroke="${S.palm}" stroke-width="6"
            stroke-linecap="round"/>
      <path d="M 184 56 q -22 -6 -30 10 q 22 6 30 -10 Z" fill="${S.palmLight}"
            stroke="${S.palmDark}" stroke-width="2.5"/>
      ${grape(196, 106, 19)}
      ${grape(170, 122, 18)}
      ${grape(220, 124, 18)}
      ${grape(184, 148, 19)}
      ${grape(212, 152, 18)}
      ${grape(198, 178, 18)}
    </g>

    ${sparkle(62, 78, 14, 0.85)}
    ${sparkle(232, 90, 10, 0.6)}
  `;
  return symbolDoc(defs, body);
}

/* ──────────────────────── ЛЕДЕНЦЫ-САМОЦВЕТЫ ─────────────────────── */

function gemSymbol(key, { sides, rotation, radius, squashX = 1, squashY = 1 }) {
  const gem = GEMS[key];
  const defs = `
    ${commonDefs}
    ${gemDefs("g", gem)}
    ${radial("halo", gem.glow + "AA", gem.glow + "00")}
  `;
  const t = squashX !== 1 || squashY !== 1
    ? ` transform="translate(128 128) scale(${squashX} ${squashY}) translate(-128 -128)"`
    : "";
  const outline = ngon(128, 128, radius, sides, rotation);
  const body = `
    ${halo(gem.glow, 0.5)}
    ${rays(128, 128, 12, 120, gem.light, 0.14)}
    ${contactShadow(128, 128 + radius * squashY * 0.98, radius * 0.66, radius * 0.13, 0.5)}
    <g${t}>
      ${extrude(pointsAttr(outline), { dy: 8, color: gem.darkest })}
      ${facetedGem(gem, { cx: 128, cy: 128, radius, sides, rotation, id: "g" })}
      <polygon points="${pointsAttr(outline)}" fill="url(#gloss)" opacity="0.75"/>
    </g>
    ${sparkle(128 - radius * 0.6 * squashX, 128 - radius * 0.58 * squashY, 15, 0.85)}
    ${sparkle(128 + radius * 0.64 * squashX, 128 + radius * 0.48 * squashY, 9, 0.6)}
  `;
  return symbolDoc(defs, body);
}

/* ────────────────────────────── WILD ────────────────────────────── */

function wild() {
  const outer = ngon(128, 122, 106, 8, -90 + 22.5);
  const inner = ngon(128, 122, 90, 8, -90 + 22.5);

  const defs = `
    ${commonDefs}
    ${haloDef(S.sun)}
    ${linearV("wildSky", [["0%", S.skyTop], ["45%", S.skyMid], ["100%", S.skyLow]])}
    ${linear("ribbon", [["0%", "#FF6B86"], ["50%", "#D31E45"], ["100%", "#8C0A26"]], 90)}
    ${radial("wildSun", S.sunCore, S.sun)}
    ${glowFilter("wildGlow", 10, S.sun, 0.9)}
  `;

  const body = `
    ${halo(S.sun, 0.6)}
    ${rays(128, 122, 20, 126, S.sun, 0.26)}
    ${contactShadow(128, 234, 78, 12, 0.5)}
    ${extrude(pointsAttr(outer), { dy: 9, color: "#4A2A02" })}

    <g>
      <polygon points="${pointsAttr(outer)}" fill="url(#goldRim)"
               stroke="${P.goldShadow}" stroke-width="4" stroke-linejoin="round"/>
      <polyline points="${pointsAttr([outer[5], outer[6], outer[7], outer[0]])}"
                fill="none" stroke="${P.goldLight}" stroke-width="4" opacity="0.7"
                stroke-linecap="round" stroke-linejoin="round"/>
      <g filter="url(#innerDeep)">
        <polygon points="${pointsAttr(inner)}" fill="url(#wildSky)"/>
      </g>

      <!-- закат в окне: солнце над морем и пальма -->
      <circle cx="128" cy="126" r="34" fill="url(#wildSun)"/>
      <path d="M 44 158 h 168 v 54 h -168 Z" fill="${S.seaMid}" opacity="0.85"/>
      <path d="M 44 158 h 168" stroke="${S.seaLight}" stroke-width="3" opacity="0.6"/>
      <path d="M 118 158 l -8 54 h 36 l -8 -54 Z" fill="${S.sun}" opacity="0.45"/>
      <g stroke="${S.palmDark}" stroke-width="7" stroke-linecap="round" fill="none">
        <path d="M 74 196 q 6 -40 22 -56"/>
      </g>
      <g fill="${S.palmDark}">
        <path d="M 96 140 q -30 -12 -44 4 q 26 -2 44 6 Z"/>
        <path d="M 96 140 q 30 -14 46 2 q -28 -2 -46 6 Z"/>
        <path d="M 96 140 q -6 -28 12 -38 q -4 24 -12 38 Z"/>
      </g>

      <polygon points="${pointsAttr(inner)}" fill="none"
               stroke="${P.goldShadow}" stroke-width="2.5"/>
    </g>

    <g filter="url(#shadowSoft)">
      <path d="M 8 128 L 34 112 L 34 168 L 8 152 Z" fill="#8C0A26"/>
      <path d="M 248 128 L 222 112 L 222 168 L 248 152 Z" fill="#8C0A26"/>
      <rect x="24" y="106" width="208" height="60" rx="8" fill="url(#ribbon)"
            stroke="${P.goldDeep}" stroke-width="3"/>
      <rect x="30" y="112" width="196" height="10" rx="5" fill="#ffffff" opacity="0.22"/>
    </g>
    ${metalText("WILD", {
      x: 128, y: 138, size: 52, family: "Poppins", weight: 700,
      fill: "url(#gold)", stroke: P.goldShadow, strokeWidth: 6,
      letterSpacing: 4, filter: "url(#wildGlow)"
    })}

    ${sparkle(206, 62, 18, 0.95)}
  `;
  return symbolDoc(defs, body);
}

/* ───────────────────────────── SCATTER ──────────────────────────── */

function scatter() {
  const defs = `
    ${commonDefs}
    ${haloDef(S.sun)}
    ${radial("shellFill", "#FFF3E0", "#F0A9C0")}
    ${radial("pearl", "#FFFFFF", "#C9D6E8")}
    ${linear("ribbon", [["0%", "#FF6B86"], ["50%", "#D31E45"], ["100%", "#8C0A26"]], 90)}
    ${glowFilter("scGlow", 12, S.sun, 0.9)}
  `;

  // Створка ракушки: веер рёбер от замка к краю.
  let ribs = "";
  for (let i = 0; i <= 10; i++) {
    const a = -168 + (156 / 10) * i;
    const p = polar(128, 196, 104, a);
    ribs += `<path d="M 128 196 L ${p.x.toFixed(1)} ${p.y.toFixed(1)}"
              stroke="#D98BA6" stroke-width="3.5" opacity="0.6"/>`;
  }

  const body = `
    ${halo(S.sun, 0.6)}
    ${rays(128, 140, 18, 128, S.sun, 0.3)}
    ${contactShadow(128, 224, 84, 13, 0.5)}

    <g filter="url(#shadow)">
      <path d="M 128 196 A 104 104 0 0 1 24 92 Q 24 40 128 34 Q 232 40 232 92 A 104 104 0 0 1 128 196 Z"
            fill="url(#shellFill)" stroke="#C4708E" stroke-width="4" stroke-linejoin="round"/>
      ${ribs}
      <path d="M 128 196 A 104 104 0 0 1 24 92" fill="none" stroke="#ffffff"
            stroke-width="5" opacity="0.45"/>
      <!-- замок -->
      <path d="M 104 196 q 24 -22 48 0 Z" fill="#C4708E"/>
      <ellipse cx="128" cy="196" rx="26" ry="12" fill="#E8A8BF" stroke="#C4708E" stroke-width="3"/>
    </g>

    <!-- жемчужина -->
    <g filter="url(#shadowSoft)">
      <circle cx="128" cy="128" r="34" fill="url(#pearl)" stroke="#A8B6CC" stroke-width="3"/>
      <circle cx="116" cy="116" r="11" fill="#fff" opacity="0.9"/>
    </g>

    <g filter="url(#shadowSoft)">
      <path d="M 6 200 L 30 188 L 30 236 L 6 224 Z" fill="#8C0A26"/>
      <path d="M 250 200 L 226 188 L 226 236 L 250 224 Z" fill="#8C0A26"/>
      <rect x="22" y="184" width="212" height="46" rx="7" fill="url(#ribbon)"
            stroke="${P.goldDeep}" stroke-width="3"/>
      <rect x="28" y="189" width="200" height="8" rx="4" fill="#ffffff" opacity="0.2"/>
    </g>
    ${metalText("SCATTER", {
      x: 128, y: 209, size: 30, family: "Poppins", weight: 700,
      fill: "url(#gold)", stroke: P.goldShadow, strokeWidth: 5,
      letterSpacing: 2, filter: "url(#scGlow)"
    })}

    ${sparkle(212, 60, 18, 0.95)}
    ${sparkle(44, 82, 13, 0.8)}
  `;
  return symbolDoc(defs, body);
}

/* ──────────────────────────── экспорт ───────────────────────────── */

const RAW = [
  { id: 0, key: "anchor", label: "ЯКОРЬ", draw: anchor },
  { id: 1, key: "icecream", label: "МОРОЖЕНОЕ", draw: iceCream },
  { id: 2, key: "shashlik", label: "ШАШЛЫК", draw: shashlik },
  { id: 3, key: "hat", label: "ШЛЯПА", draw: sunHat },
  { id: 4, key: "wine", label: "ВИНО", draw: wineGrapes },
  { id: 5, key: "gem_red", label: "КРАСНЫЙ", draw: () => gemSymbol("ruby", { sides: 6, rotation: -90, radius: 96 }) },
  { id: 6, key: "gem_amber", label: "ЯНТАРЬ", draw: () => gemSymbol("amber", { sides: 8, rotation: -67.5, radius: 94 }) },
  { id: 7, key: "gem_green", label: "ЗЕЛЁНЫЙ", draw: () => gemSymbol("emerald", { sides: 8, rotation: -67.5, radius: 100, squashX: 0.8, squashY: 1.02 }) },
  { id: 8, key: "gem_aqua", label: "БИРЮЗА", draw: () => gemSymbol("aqua", { sides: 12, rotation: -90, radius: 94 }) },
  { id: 9, key: "gem_purple", label: "ФИОЛЕТОВЫЙ", draw: () => gemSymbol("amethyst", { sides: 4, rotation: -45, radius: 92 }) },
  { id: 10, key: "wild", label: "WILD", draw: wild },
  { id: 11, key: "scatter", label: "SCATTER", draw: scatter }
];

export const SYMBOLS = RAW.map((s) => ({
  id: s.id,
  key: s.key,
  label: s.label,
  svg: () => namespaceSvg(s.draw(), `s${s.id}`)
}));

export const SYMBOL_SIZE = SIZE;
