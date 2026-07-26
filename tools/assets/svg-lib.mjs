// Низкоуровневые примитивы для сборки SVG-символов.
// Здесь нет ничего про конкретную игру — только математика цвета,
// огранка самоцветов и металлические поверхности.

/* ────────────────────────────── цвет ────────────────────────────── */

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t
  });
}

export function shade(hex, amount) {
  // amount > 0 — светлее, < 0 — темнее
  return amount >= 0 ? mix(hex, "#ffffff", amount) : mix(hex, "#000000", -amount);
}

/* ──────────────────────────── геометрия ─────────────────────────── */

export function polar(cx, cy, radius, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
}

export function ngon(cx, cy, radius, sides, rotationDeg = 0) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    pts.push(polar(cx, cy, radius, rotationDeg + (360 / sides) * i));
  }
  return pts;
}

export function pointsAttr(pts) {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

export function centroid(pts) {
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  return { x: sx / pts.length, y: sy / pts.length };
}

/* ───────────────────────── огранка самоцвета ────────────────────── */

// Направление света: сверху-слева. Используется для затенения граней,
// чтобы камень выглядел объёмным, а не плоской заливкой.
const LIGHT = { x: -0.55, y: -0.83 };

function facetShade(gem, cx, cy, facetPts, boost = 0) {
  const c = centroid(facetPts);
  let nx = c.x - cx;
  let ny = c.y - cy;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  // dot ∈ [-1, 1]: 1 — грань смотрит на источник света
  const dot = nx * LIGHT.x + ny * LIGHT.y;
  const t = (dot + 1) / 2; // → [0, 1]
  const k = Math.max(0, Math.min(1, t * 0.85 + boost));
  if (k < 0.5) return mix(gem.darkest, gem.base, k / 0.5);
  return mix(gem.base, gem.lightest, (k - 0.5) / 0.5);
}

/**
 * Самоцвет ступенчатой огранки: внешний ореол, поясок, корона из граней,
 * площадка (table) с внутренним отражением и блик.
 */
export function facetedGem(gem, opts = {}) {
  const {
    cx = 128,
    cy = 128,
    radius = 92,
    sides = 8,
    rotation = -90 + 360 / 16,
    id = "gem"
  } = opts;

  const outer = ngon(cx, cy, radius, sides, rotation);
  const girdle = ngon(cx, cy, radius * 0.9, sides, rotation);
  const table = ngon(cx, cy, radius * 0.44, sides, rotation);

  let facets = "";

  // Пояс между внешним контуром и пояском — узкая тёмная фаска.
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const quad = [outer[i], outer[j], girdle[j], girdle[i]];
    facets += `<polygon points="${pointsAttr(quad)}" fill="${facetShade(gem, cx, cy, quad, -0.18)}"/>`;
  }

  // Корона: каждый сегмент разбит на два треугольника —
  // это и создаёт характерное «мерцание» огранки.
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const triA = [girdle[i], girdle[j], table[i]];
    const triB = [girdle[j], table[j], table[i]];
    facets += `<polygon points="${pointsAttr(triA)}" fill="${facetShade(gem, cx, cy, triA, 0.06)}"/>`;
    facets += `<polygon points="${pointsAttr(triB)}" fill="${facetShade(gem, cx, cy, triB, -0.08)}"/>`;
  }

  const tableTop = table[Math.floor(sides * 0.62) % sides];

  return `
<g>
  <!-- мягкое свечение вокруг камня -->
  <polygon points="${pointsAttr(ngon(cx, cy, radius * 1.06, sides, rotation))}"
           fill="${gem.glow}" opacity="0.5" filter="url(#${id}-aura)"/>

  <!-- тело камня -->
  <g filter="url(#${id}-shadow)">
    <polygon points="${pointsAttr(outer)}" fill="${gem.dark}"/>
    ${facets}

    <!-- площадка -->
    <polygon points="${pointsAttr(table)}" fill="url(#${id}-table)"/>
    <polygon points="${pointsAttr(table)}" fill="none"
             stroke="${shade(gem.lightest, 0.2)}" stroke-width="1.5" opacity="0.75"/>

    <!-- внутреннее отражение на площадке -->
    <polygon points="${pointsAttr(ngon(cx, cy - radius * 0.06, radius * 0.24, sides, rotation))}"
             fill="${gem.lightest}" opacity="0.45"/>

    <!-- поясок: тонкая светлая грань по контуру -->
    <polygon points="${pointsAttr(outer)}" fill="none"
             stroke="${shade(gem.light, 0.35)}" stroke-width="2.5" opacity="0.9"/>
    <polygon points="${pointsAttr(outer)}" fill="none"
             stroke="${gem.darkest}" stroke-width="1" opacity="0.6"/>
  </g>

  <!-- зеркальный блик -->
  <ellipse cx="${(cx - radius * 0.34).toFixed(1)}" cy="${(cy - radius * 0.42).toFixed(1)}"
           rx="${(radius * 0.3).toFixed(1)}" ry="${(radius * 0.17).toFixed(1)}"
           fill="#ffffff" opacity="0.55" transform="rotate(-32 ${cx} ${cy})"
           filter="url(#${id}-soft)"/>
  <ellipse cx="${(cx + radius * 0.3).toFixed(1)}" cy="${(cy + radius * 0.36).toFixed(1)}"
           rx="${(radius * 0.16).toFixed(1)}" ry="${(radius * 0.08).toFixed(1)}"
           fill="${gem.lightest}" opacity="0.4" transform="rotate(-32 ${cx} ${cy})"
           filter="url(#${id}-soft)"/>

  ${sparkle(tableTop.x, tableTop.y, radius * 0.2, 0.9)}
</g>`;
}

/** Четырёхлучевая искра — ставится поверх бликов. */
export function sparkle(x, y, size, opacity = 1, color = "#ffffff") {
  const s = size;
  const t = size * 0.13;
  return `<g opacity="${opacity}">
    <path d="M ${x} ${y - s} Q ${x + t} ${y - t} ${x + s} ${y} Q ${x + t} ${y + t} ${x} ${y + s} Q ${x - t} ${y + t} ${x - s} ${y} Q ${x - t} ${y - t} ${x} ${y - s} Z"
          fill="${color}"/>
    <circle cx="${x}" cy="${y}" r="${(size * 0.16).toFixed(2)}" fill="${color}"/>
  </g>`;
}

/* ───────────────────────────── градиенты ────────────────────────── */

export function goldGradient(id, P, angle = 90) {
  return `
<linearGradient id="${id}" gradientTransform="rotate(${angle} 0.5 0.5)">
  <stop offset="0%"   stop-color="${P.goldLight}"/>
  <stop offset="18%"  stop-color="${P.goldPale}"/>
  <stop offset="38%"  stop-color="${P.gold}"/>
  <stop offset="52%"  stop-color="${P.goldLight}"/>
  <stop offset="66%"  stop-color="${P.goldMid}"/>
  <stop offset="86%"  stop-color="${P.goldDeep}"/>
  <stop offset="100%" stop-color="${P.goldPale}"/>
</linearGradient>`;
}

/**
 * Строго вертикальный градиент.
 *
 * linear() крутит стандартную горизонтальную ось через gradientTransform,
 * и «повернуть на 180°» означает не «сверху вниз», а «справа налево» —
 * на этом легко получить полосу поперёк экрана вместо мягкой дымки.
 * Здесь ось задана явно координатами.
 */
export function linearV(id, stops) {
  const body = stops
    .map(([off, color, op]) => `<stop offset="${off}" stop-color="${color}"${op !== undefined ? ` stop-opacity="${op}"` : ""}/>`)
    .join("");
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${body}</linearGradient>`;
}

export function radial(id, inner, outer, cx = "50%", cy = "50%", r = "50%") {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">
    <stop offset="0%" stop-color="${inner}"/>
    <stop offset="100%" stop-color="${outer}"/>
  </radialGradient>`;
}

export function linear(id, stops, angle = 90) {
  const body = stops
    .map(([off, color, op]) => `<stop offset="${off}" stop-color="${color}"${op !== undefined ? ` stop-opacity="${op}"` : ""}/>`)
    .join("");
  return `<linearGradient id="${id}" gradientTransform="rotate(${angle} 0.5 0.5)">${body}</linearGradient>`;
}

/* ───────────────────────────── фильтры ──────────────────────────── */

export function dropShadow(id, dy = 4, blur = 5, opacity = 0.55, color = "#000000") {
  return `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
    <feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="${color}" flood-opacity="${opacity}"/>
  </filter>`;
}

export function blurFilter(id, std) {
  return `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="${std}"/>
  </filter>`;
}

/**
 * Внутренняя тень. Именно её нехватка делает плоскими любые векторные
 * символы: без затемнения под верхней кромкой оправа читается как заливка,
 * а не как металл с толщиной.
 */
export function innerShadow(id, { dy = 5, blur = 5, color = "#000000", opacity = 0.55 } = {}) {
  return `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">
    <feOffset dx="0" dy="${dy}" in="SourceAlpha" result="off"/>
    <feGaussianBlur stdDeviation="${blur}" in="off" result="blur"/>
    <feComposite operator="out" in="SourceAlpha" in2="blur" result="inverse"/>
    <feFlood flood-color="${color}" flood-opacity="${opacity}" result="color"/>
    <feComposite operator="in" in="color" in2="inverse" result="shadow"/>
    <feComposite operator="over" in="shadow" in2="SourceGraphic"/>
  </filter>`;
}

/**
 * «Экструзия»: копия силуэта, сдвинутая вниз и затемнённая, кладётся под
 * основную фигуру. Дёшево имитирует торец металла и сразу отрывает символ
 * от плоскости фона.
 */
export function extrude(pointsOrPath, { dy = 7, color = "#3A2000", isPath = false }) {
  const shape = isPath
    ? `<path d="${pointsOrPath}" fill="${color}"/>`
    : `<polygon points="${pointsOrPath}" fill="${color}"/>`;
  return `<g transform="translate(0 ${dy})">${shape}</g>`;
}

/** Контактная тень под символом — он должен лежать на барабане, а не висеть. */
export function contactShadow(cx, cy, rx, ry, opacity = 0.45) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
    fill="#000000" opacity="${opacity}" filter="url(#contactBlur)"/>`;
}

/** Глянцевый блик на верхней половине: имитация отражения источника света. */
export function gloss(id) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.45"/>
    <stop offset="38%"  stop-color="#ffffff" stop-opacity="0.13"/>
    <stop offset="52%"  stop-color="#ffffff" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0.28"/>
  </linearGradient>`;
}

/**
 * Лепка поверхности: мелкий рельеф плюс направленный свет.
 *
 * Это то, чего не хватало символам, чтобы перестать читаться как вектор.
 * Плоская заливка и градиент дают «наклейку»: у настоящего предмета
 * поверхность неровная, и свет цепляется за неровности. Здесь feTurbulence
 * работает картой высот, feDiffuseLighting освещает её направленным
 * источником, а результат подмешивается в мягком свете — тон не сбивается,
 * но появляется фактура.
 *
 * Свет идёт справа сверху — оттуда же, где солнце на фоне. Если источники
 * не совпадают, предметы выглядят вырезанными из другой картинки.
 *
 * color-interpolation-filters="sRGB" обязателен: по умолчанию фильтры
 * считаются в линейном пространстве и результат выцветает.
 */
export function sculpt(id, { freq = 0.85, octaves = 3, amount = 0.13, seed = 7 } = {}) {
  const slope = amount * 2;
  const intercept = 1 - amount;
  return `<filter id="${id}" x="-6%" y="-6%" width="112%" height="112%"
        color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}"
                  seed="${seed}" result="noise"/>
    <feColorMatrix in="noise" type="saturate" values="0" result="mono"/>
    <!-- Шум сжимается к единице: множитель гуляет в пределах ±${Math.round(amount * 100)} %.
         Полный размах выбелил бы символ до мрамора. -->
    <feComponentTransfer in="mono" result="soft">
      <feFuncR type="linear" slope="${slope}" intercept="${intercept}"/>
      <feFuncG type="linear" slope="${slope}" intercept="${intercept}"/>
      <feFuncB type="linear" slope="${slope}" intercept="${intercept}"/>
      <feFuncA type="linear" slope="0" intercept="1"/>
    </feComponentTransfer>
    <!-- arithmetic с k1=1 — это умножение: тон сохраняется, меняется яркость. -->
    <feComposite in="SourceGraphic" in2="soft" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="tex"/>
    <feComposite in="tex" in2="SourceGraphic" operator="in"/>
  </filter>`;
}

/**
 * Тёплый ключевой свет сверху справа и холодная подсветка снизу слева.
 *
 * Один источник даёт плоскую, «пластмассовую» картинку. Вторая, холодная
 * заливка снизу — приём из предметной съёмки: она отделяет объём от фона
 * и делает материал похожим на материал, а не на цветное пятно.
 */
export function keyFill(id) {
  return `<linearGradient id="${id}" x1="0.85" y1="0" x2="0.15" y2="1">
    <stop offset="0%"   stop-color="#FFE9C0" stop-opacity="0.30"/>
    <stop offset="42%"  stop-color="#FFFFFF" stop-opacity="0.04"/>
    <stop offset="66%"  stop-color="#2A1840" stop-opacity="0.06"/>
    <stop offset="100%" stop-color="#4FC8E8" stop-opacity="0.20"/>
  </linearGradient>`;
}

export function glowFilter(id, std, color, opacity = 1) {
  return `<filter id="${id}" x="-80%" y="-80%" width="260%" height="260%">
    <feDropShadow dx="0" dy="0" stdDeviation="${std}" flood-color="${color}" flood-opacity="${opacity}"/>
  </filter>`;
}

/** Стандартный набор фильтров/градиентов для камня. */
export function gemDefs(id, gem) {
  return [
    radial(`${id}-table`, shade(gem.light, 0.25), gem.base),
    blurFilter(`${id}-aura`, 7),
    blurFilter(`${id}-soft`, 3.2),
    dropShadow(`${id}-shadow`, 5, 5, 0.6)
  ].join("");
}

/* ─────────────────────────── типографика ────────────────────────── */

/**
 * Металлическая надпись: обводка идёт под заливкой (paint-order),
 * поэтому буква не «худеет» и остаётся читаемой на любом фоне.
 */
export function metalText(text, opts = {}) {
  const {
    x = 128,
    y = 128,
    size = 96,
    fill = "url(#gold)",
    stroke = "#5E3703",
    strokeWidth = 7,
    family = "Lora",
    weight = 700,
    letterSpacing = 0,
    anchor = "middle",
    baseline = "central",
    filter = ""
  } = opts;
  return `<text x="${x}" y="${y}" font-family="${family}" font-weight="${weight}"
    font-size="${size}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"
    paint-order="stroke" stroke-linejoin="round" text-anchor="${anchor}"
    dominant-baseline="${baseline}" letter-spacing="${letterSpacing}"
    ${filter ? `filter="${filter}"` : ""}>${text}</text>`;
}

/* ──────────────────────────── документ ──────────────────────────── */

export function svgDoc(width, height, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"
  viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">
  <defs>${defs}</defs>
  ${body}
</svg>`;
}

/**
 * Пространство имён для id внутри SVG.
 *
 * Растеризатор кладёт все символы в один HTML-документ, а id в SVG —
 * глобальные для документа. Без префикса `url(#gold)` во втором символе
 * подхватит градиент из первого. Поэтому каждый файл получает свой префикс.
 */
export function namespaceSvg(svg, prefix) {
  return svg
    .replace(/id="([A-Za-z][\w-]*)"/g, (_, id) => `id="${prefix}__${id}"`)
    .replace(/url\(#([A-Za-z][\w-]*)\)/g, (_, id) => `url(#${prefix}__${id})`);
}
