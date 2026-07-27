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
const FACET_LIGHT = { x: -0.55, y: -0.83 };

function facetShade(gem, cx, cy, facetPts, boost = 0) {
  const c = centroid(facetPts);
  let nx = c.x - cx;
  let ny = c.y - cy;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  // dot ∈ [-1, 1]: 1 — грань смотрит на источник света
  const dot = nx * FACET_LIGHT.x + ny * FACET_LIGHT.y;
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

/* ════════════════════════════════════════════════════════════════════
   РЕЦЕПТЫ ФИЛЬТРОВ

   Всё, что ниже, — чистые функции вида recipe(id, opts) → Recipe:

     { id, def, ref, [fill] }

   `def`  — строка с <filter> (и, если нужно, с <pattern>), её кладут в <defs>;
   `ref`  — готовая строка `url(#id)` для атрибута filter=;
   `fill` — для рецептов-материалов: `url(#id-tex)` под атрибут fill=.

   Вызывающий код НИКОГДА не пишет разметку фильтра руками — только
   `const b = bevel("btn"); defs += b.def; ...filter="${b.ref}"`.

   Почему фильтры, а не градиенты. Растеризатор — headless Chromium,
   у него полноценная реализация SVG-фильтров. feDiffuseLighting и
   feSpecularLighting по карте высот считают НАСТОЯЩЕЕ освещение
   поверхности: блик ползёт по форме, фаска гнётся вместе с контуром,
   вмятины темнеют сами. Нарисованный градиент так не умеет — он
   всегда выглядит наклейкой, и именно это отличает арт на 5 из 10
   от арта уровня Pragmatic.
   ════════════════════════════════════════════════════════════════════ */

/**
 * ЕДИНЫЙ ИСТОЧНИК СВЕТА игры. Держится на КАЖДОМ символе, рамке,
 * кнопке и панели — согласованность света и есть главный признак
 * дорогого арта.
 *
 * Про азимут. В SVG ось Y направлена ВНИЗ, а азимут отсчитывается
 * от оси +X в сторону +Y. Вектор «на источник» равен
 * (cos A · cos E, sin A · cos E, sin E). Свет сверху-слева — это
 * отрицательные X и Y, то есть третий квадрант: A = 225°.
 * Привычные «135°» из графических редакторов (там Y вверх) в SVG
 * дали бы свет СНИЗУ-слева и вывернули бы все фаски наизнанку.
 */
export const LIGHT = Object.freeze({
  azimuth: 225,
  elevation: 55,
  // Нормированное направление «на источник» в экранных координатах.
  // Тени и контактные пятна смещаются в противоположную сторону.
  x: -0.7071,
  y: -0.7071,
  // Готовое смещение тени (вправо-вниз) на единицу расстояния.
  shadowX: 0.7071,
  shadowY: 0.7071
});

/** Свет как элемент фильтра. Позволяет локально отклонить ключ. */
export function distantLight(light = LIGHT) {
  return `<feDistantLight azimuth="${light.azimuth}" elevation="${light.elevation}"/>`;
}

/** Точечный источник — для локальных бликов (искры, накладки на стекле). */
export function pointLight(x, y, z, light) {
  return `<fePointLight x="${x}" y="${y}" z="${z}"/>`;
}

function recipe(id, def, extra = {}) {
  return { id, def, ref: `url(#${id})`, ...extra };
}

/**
 * Нейтральный diffuseConstant для данного источника.
 *
 * feDiffuseLighting возвращает kd · (N·L). На плоском участке
 * N = (0,0,1), значит N·L = sin(elevation) — при elevation 55° это
 * 0.82. С kd = 1 ровная поверхность темнеет на 18 % ни за что,
 * а с kd = 1.4 (популярный «на глаз» подбор) — светлеет на 15 %
 * и выжигает светлые грани в белое. Ровно на этом первая версия
 * самоцветов ушла в пастель.
 *
 * kd = 1/sin(elevation) оставляет плоскость КАК ЕСТЬ и заставляет
 * лепку работать только там, где поверхность отвернулась от света.
 * Тогда усиление объёма делает тени глубже, а не света ярче — это и
 * даёт насыщенность вместо выцветания.
 */
export function neutralDiffuse(light = LIGHT) {
  return 1 / Math.max(0.15, Math.sin((light.elevation * Math.PI) / 180));
}

// Разные seed на разных рецептах: одинаковый шум на всех символах
// сразу читается как повторяющийся узор и убивает иллюзию материала.
let SEED = 11;
const nextSeed = () => (SEED = (SEED * 7 + 13) % 977);

/* ───────────────────────────── фаска ────────────────────────────── */

/**
 * bevel(id, opts) — настоящая фаска по карте высот.
 *
 * Карта высот строится из альфы: размытие даёт скат от края к центру,
 * feComponentTransfer «подрезает» его в плато, чтобы получилась именно
 * фаска (плоская макушка + скруглённая кромка), а не подушка.
 * Дальше по этой карте считаются диффузное освещение (форма) и
 * зеркальное (блик). Результат умножается на исходный цвет, поэтому
 * рецепт работает поверх любой заливки — плоской, градиента, текстуры.
 *
 * @param {string} id
 * @param {object} opts
 * @param {number} opts.height     ширина фаски в пикселях исходника (стандарт 6)
 * @param {number} opts.depth      surfaceScale — насколько круто гнётся кромка
 * @param {number} opts.diffuse    diffuseConstant, 1 — нейтрально
 * @param {number} opts.specular   specularConstant; 0 отключает блик
 * @param {number} opts.shininess  specularExponent: больше — блик острее
 * @param {string} opts.specColor  цвет блика (тёплый для золота, белый для стекла)
 * @param {number} opts.plateau    0..1, доля плоской макушки
 * @param {object} opts.light      направление, по умолчанию LIGHT
 */
export function bevel(id, opts = {}) {
  const {
    height = 6,
    // surfaceScale, а не «глубина в пикселях». Значения порядка единиц
    // дают почти плоские нормали и ровный засвет по всей фигуре;
    // объём начинается примерно с 20. Проверено на стенде probe.mjs.
    depth = 24,
    diffuse = neutralDiffuse(),
    specular = 1.35,
    shininess = 22,
    specColor = "#FFFFFF",
    plateau = 0.55,
    modeling = 0.7,
    light = LIGHT,
    margin = 25
  } = opts;

  // tableValues лепит профиль кромки: чем раньше кривая выходит на 1,
  // тем шире плоская макушка и тем «жёстче» фаска.
  const p = Math.max(0, Math.min(0.95, plateau));
  const t = [0, 0.18 + p * 0.25, 0.55 + p * 0.32, 0.9 + p * 0.1, 1]
    .map((v) => Math.min(1, v).toFixed(3))
    .join(" ");

  return recipe(id, `<filter id="${id}" x="-${margin}%" y="-${margin}%"
      width="${100 + margin * 2}%" height="${100 + margin * 2}%"
      color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${height}" result="bv_h0"/>
    <feComponentTransfer in="bv_h0" result="bv_h">
      <feFuncA type="table" tableValues="${t}"/>
    </feComponentTransfer>
${modeling > 0 ? `
    <!-- общая лепка: широкая карта высот даёт перепад тона по всему телу,
         иначе освещена только кромка, а середина остаётся заливкой -->
    <feGaussianBlur in="SourceAlpha" stdDeviation="${(height * 4.5).toFixed(2)}" result="bv_H"/>
    <feDiffuseLighting in="bv_H" surfaceScale="${(depth * 0.9 * modeling).toFixed(2)}"
        diffuseConstant="${neutralDiffuse(light).toFixed(3)}" lighting-color="#ffffff" result="bv_D">
      ${distantLight(light)}
    </feDiffuseLighting>
    <feComposite in="bv_D" in2="SourceGraphic" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="bv_base"/>` : `
    <feOffset in="SourceGraphic" result="bv_base"/>`}

    <feDiffuseLighting in="bv_h" surfaceScale="${depth}"
        diffuseConstant="${diffuse}" lighting-color="#ffffff" result="bv_d">
      ${distantLight(light)}
    </feDiffuseLighting>
    <!-- k1 — умножение: тон исходника сохраняется, меняется яркость -->
    <feComposite in="bv_d" in2="bv_base" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="bv_lit"/>
${specular > 0 ? `
    <feSpecularLighting in="bv_h" surfaceScale="${depth}"
        specularConstant="${specular}" specularExponent="${shininess}"
        lighting-color="${specColor}" result="bv_s">
      ${distantLight(light)}
    </feSpecularLighting>
    <feComposite in="bv_s" in2="SourceAlpha" operator="in" result="bv_sm"/>
    <feComposite in="bv_lit" in2="bv_sm" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0" result="bv_add"/>` : `
    <feOffset in="bv_lit" result="bv_add"/>`}
    <feComposite in="bv_add" in2="SourceAlpha" operator="in"/>
  </filter>`);
}

/* ────────────────────────── стеклянный камень ───────────────────── */

/**
 * glassGem(id, gem, opts) — стеклянный самоцвет.
 *
 * Семь проходов, каждый отвечает за свой признак «стекла»:
 *   1) купол-карта высот из альфы;
 *   2) преломление — интерьер камня смещается feDisplacementMap,
 *      поэтому огранка под поверхностью «плывёт», как в настоящем стекле;
 *   3) диффузное освещение купола — объём;
 *   4) внутреннее свечение от ядра — камень светится изнутри, а не
 *      подсвечен снаружи;
 *   5) тёмная кромка — полное внутреннее отражение по контуру, без
 *      неё стекло выглядит пластиком;
 *   6) каустика — россыпь искр внутри тела;
 *   7) острый зеркальный блик по ключевому свету.
 *
 * Исходник — плоский силуэт камня (можно с гранями). Всё остальное
 * делает фильтр.
 *
 * @param {string} id
 * @param {{lightest,light,base,dark,darkest,glow}} gem палитра камня из palette.mjs
 */
export function glassGem(id, gem, opts = {}) {
  const {
    // Купол держится УЗКИМ намеренно. Широкое размытие альфы смазывает
    // грани в пузырь и добавляет «апельсиновую корку» из-за квантования
    // альфы; объём даёт не ширина ската, а крутизна нормалей (depth).
    dome = 7,
    depth = 30,          // surfaceScale: крутизна кромки
    refraction = 5,      // сила преломления интерьера
    innerGlow: ig = 0.12,
    edge = 3,            // толщина тёмной кромки, px
    caustic = 0.12,
    specular = 1.6,
    // Показатель НАМЕРЕННО высокий.
    //
    // Направленный источник над плоской площадкой даёт РОВНЫЙ блик по
    // всей площадке: N·H там постоянно. При показателе 44 это +0.13
    // белого на каждый пиксель камня — центр рубина уезжал с #E02040
    // в #FF6494, то есть в розовый. При 110 та же площадка получает
    // +0.003, и блик остаётся только там, где нормаль реально
    // повернулась к источнику — на фаске. Ровно так он лежит и в
    // эталонах: узкая раскалённая полоса по кромке, насыщенная масса
    // внутри.
    shininess = 110,
    modeling = 0.8,      // сила общего перепада тона по телу камня
    // Любая добавка света (свечение, каустика, блик) — это подмешивание
    // БЕЛОГО, а белое обесцвечивает. Без обратной подкрутки насыщенности
    // рубин уезжает в розовый, изумруд в мятный, и весь набор выглядит
    // леденцами вместо камней. Возвращаем цветность в самом конце.
    saturate = 1.3,
    light = LIGHT,
    seed = nextSeed()
  } = opts;

  const glow = gem.glow || gem.light;
  const dark = gem.darkest || gem.dark;

  return recipe(id, `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"
      color-interpolation-filters="sRGB">
    <!-- 1. купол -->
    <feGaussianBlur in="SourceAlpha" stdDeviation="${dome}" result="gg_h0"/>
    <feComponentTransfer in="gg_h0" result="gg_h">
      <feFuncA type="table" tableValues="0 0.30 0.68 0.90 1"/>
    </feComponentTransfer>

    <!-- 2. преломление интерьера -->
    <feTurbulence type="fractalNoise" baseFrequency="0.016 0.024" numOctaves="3"
                  seed="${seed}" result="gg_t"/>
    <feDisplacementMap in="SourceGraphic" in2="gg_t" scale="${refraction}"
                       xChannelSelector="R" yChannelSelector="G" result="gg_body"/>

    <!-- 3a. общая лепка: широкая мягкая карта высот даёт плавный
         перепад «светлее к источнику — темнее от него» по всему телу.
         Без него камень ровный по тону: узкая фаска освещает только
         кромку, а середина остаётся плоской заливкой. -->
    <feGaussianBlur in="SourceAlpha" stdDeviation="${(dome * 4.5).toFixed(2)}" result="gg_H"/>
    <feDiffuseLighting in="gg_H" surfaceScale="${(depth * 0.9 * modeling).toFixed(2)}"
                       diffuseConstant="${neutralDiffuse(light).toFixed(3)}"
                       lighting-color="#ffffff" result="gg_D">
      ${distantLight(light)}
    </feDiffuseLighting>
    <feComposite in="gg_D" in2="gg_body" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="gg_model"/>

    <!-- 3b. фаска: резкий перелом по кромке -->
    <feDiffuseLighting in="gg_h" surfaceScale="${depth}"
                       diffuseConstant="${neutralDiffuse(light).toFixed(3)}"
                       lighting-color="#ffffff" result="gg_d">
      ${distantLight(light)}
    </feDiffuseLighting>
    <feComposite in="gg_d" in2="gg_model" operator="arithmetic"
                 k1="1.0" k2="0" k3="0" k4="0" result="gg_lit"/>

    <!-- 4. свечение изнутри: ядро камня светлее оболочки -->
    <feMorphology in="SourceAlpha" operator="erode" radius="${(dome * 2.2).toFixed(2)}"
                  result="gg_core"/>
    <feGaussianBlur in="gg_core" stdDeviation="${(dome * 1.6).toFixed(2)}" result="gg_coreB"/>
    <feFlood flood-color="${glow}" result="gg_gc"/>
    <feComposite in="gg_gc" in2="gg_coreB" operator="in" result="gg_glow"/>
    <feComposite in="gg_lit" in2="gg_glow" operator="arithmetic"
                 k1="0" k2="1" k3="${ig}" k4="0" result="gg_lit2"/>

    <!-- 5. тёмная кромка (полное внутреннее отражение) -->
    <feMorphology in="SourceAlpha" operator="erode" radius="${edge}" result="gg_in"/>
    <feComposite in="SourceAlpha" in2="gg_in" operator="out" result="gg_ring"/>
    <feGaussianBlur in="gg_ring" stdDeviation="${(edge * 0.55).toFixed(2)}" result="gg_ringB"/>
    <feFlood flood-color="${dark}" flood-opacity="0.9" result="gg_dc"/>
    <feComposite in="gg_dc" in2="gg_ringB" operator="in" result="gg_edge"/>
    <feComposite in="gg_edge" in2="gg_lit2" operator="over" result="gg_lit3"/>

    <!-- 6. каустика -->
    <feTurbulence type="turbulence" baseFrequency="0.05 0.07" numOctaves="2"
                  seed="${seed + 3}" result="gg_ct"/>
    <feColorMatrix in="gg_ct" type="saturate" values="0" result="gg_cm"/>
    <feComponentTransfer in="gg_cm" result="gg_cs">
      <feFuncR type="gamma" exponent="7" amplitude="2.4"/>
      <feFuncG type="gamma" exponent="7" amplitude="2.4"/>
      <feFuncB type="gamma" exponent="7" amplitude="2.4"/>
      <feFuncA type="linear" slope="0" intercept="1"/>
    </feComponentTransfer>
    <feComposite in="gg_cs" in2="gg_in" operator="in" result="gg_caust"/>
    <feComposite in="gg_lit3" in2="gg_caust" operator="arithmetic"
                 k1="0" k2="1" k3="${caustic}" k4="0" result="gg_lit4"/>

    <!-- 7. зеркальный блик -->
    <feSpecularLighting in="gg_h" surfaceScale="${depth}" specularConstant="${specular}"
        specularExponent="${shininess}" lighting-color="#ffffff" result="gg_sp">
      ${distantLight(light)}
    </feSpecularLighting>
    <feComposite in="gg_sp" in2="SourceAlpha" operator="in" result="gg_spm"/>
    <feComposite in="gg_lit4" in2="gg_spm" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0" result="gg_add"/>

    <feColorMatrix in="gg_add" type="saturate" values="${saturate}" result="gg_out"/>
    <feComposite in="gg_out" in2="SourceAlpha" operator="in"/>
  </filter>`);
}

/**
 * cutGem(gem, opts) — ГЕОМЕТРИЯ огранённого камня под glassGem.
 *
 * Возвращает плоскую разметку без градиентов и фильтров: рундист,
 * корона из парных треугольников, площадка и один диагональный
 * штрих-отражение. Тона граней считаются по ключевому свету — грань,
 * повёрнутая к источнику, светлее, и порядок этих переходов совпадает
 * с тем, что потом досчитает фильтр. Если рисовать грани «на глаз»,
 * фильтр и заливка спорят друг с другом, и камень выглядит грязным.
 *
 * Отдаётся строкой — оборачивайте её в <g filter="${glassGem(...).ref}">.
 *
 * @param {object} gem   палитра камня (lightest/light/base/dark/darkest/glow)
 * @param {object} opts
 * @param {number} opts.cx,cy,radius
 * @param {number} opts.sides       число граней рундиста
 * @param {number} opts.rotation    поворот, градусы
 * @param {number} opts.table       доля площадки от радиуса (0.46)
 * @param {number} opts.girdle      доля рундиста от радиуса (0.88)
 * @param {number} opts.squashX/squashY  сплющивание (овальные и «маркиз»)
 * @param {number} opts.contrast    разброс тона граней (1.0)
 */
export function cutGem(gem, opts = {}) {
  const {
    cx = 128, cy = 128, radius = 96,
    sides = 8, rotation = -90,
    table = 0.46, girdle = 0.88,
    squashX = 1, squashY = 1,
    contrast = 1,
    // deepen — сдвиг всей рампы в темноту, 0..1.
    //
    // Курортная палитра темы намеренно светлая: `base` рубина
    // #E02040 против #A00203 у эталонного. Понижать её в palette.mjs
    // нельзя — тот же набор цветов держит тему целиком. Поэтому
    // глубина камня регулируется здесь, на уровне символа: 0.2…0.35
    // даёт массу уровня Pragmatic, не трогая общую гамму игры.
    deepen = 0,
    streak = true
  } = opts;

  const sq = (pts) => pts.map((p) => ({
    x: cx + (p.x - cx) * squashX,
    y: cy + (p.y - cy) * squashY
  }));

  const out = sq(ngon(cx, cy, radius, sides, rotation));
  const gir = sq(ngon(cx, cy, radius * girdle, sides, rotation));
  const tab = sq(ngon(cx, cy, radius * table, sides, rotation));

  // Тон грани по её нормали относительно ключа: то же правило,
  // по которому потом посчитает feDiffuseLighting.
  const tone = (pts, bias = 0) => {
    const c = centroid(pts);
    let nx = c.x - cx, ny = c.y - cy;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const dot = nx * LIGHT.x + ny * LIGHT.y;      // 1 — грань смотрит на свет
    const k = Math.max(0, Math.min(1, (dot * 0.5 + 0.5) * contrast + bias));

    // Рампа НЕЛИНЕЙНАЯ и намеренно смещена в тень.
    //
    // Линейная развёртка darkest→base→light отдаёт светлой половине
    // ровно половину граней, а `light` в палитрах курортной гаммы —
    // это пастель (#FF7A8C у рубина). В результате камень читался
    // розовым леденцом, тогда как в эталонах масса камня насыщенная,
    // а пастель занимает считаные грани у самого блика.
    //
    // Здесь `base` стоит на 0.72: две трети граней лежат в диапазоне
    // darkest…base, и только верхушка уходит в light. Светлое добавит
    // фильтр — блик, свечение и лепку он кладёт поверх.
    const deep = (c) => (deepen > 0 ? mix(c, gem.darkest, deepen) : c);
    const stops = [
      [0.00, gem.darkest],
      [0.35, deep(gem.dark)],
      [0.72, deep(gem.base)],
      [1.00, deep(gem.light)]
    ];
    for (let i = 1; i < stops.length; i++) {
      if (k <= stops[i][0] || i === stops.length - 1) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        return mix(ca, cb, b === a ? 0 : (k - a) / (b - a));
      }
    }
    return gem.base;
  };

  let s = `<polygon points="${pointsAttr(out)}" fill="${gem.dark}"/>`;

  // Рундист: узкая тёмная фаска по контуру — даёт камню толщину.
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const q = [out[i], out[j], gir[j], gir[i]];
    s += `<polygon points="${pointsAttr(q)}" fill="${tone(q, -0.26)}"/>`;
  }
  // Корона: парные треугольники — источник «мерцания» огранки.
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const a = [gir[i], gir[j], tab[i]];
    const b = [gir[j], tab[j], tab[i]];
    s += `<polygon points="${pointsAttr(a)}" fill="${tone(a, 0.10)}"/>`;
    s += `<polygon points="${pointsAttr(b)}" fill="${tone(b, -0.10)}"/>`;
  }
  // Площадка: не белая. Белая площадка съедает весь блик, который
  // потом положит фильтр, и камень выцветает в лёд.
  // Площадка = ровно `base`. Она смотрит в камеру, её нормаль совпадает
  // с плоскостью экрана, и нейтральный свет обязан оставить её как есть.
  // Любое осветление здесь бьёт по самой большой площади камня.
  s += `<polygon points="${pointsAttr(tab)}" fill="${deepen > 0 ? mix(gem.base, gem.darkest, deepen) : gem.base}"/>`;
  s += `<polygon points="${pointsAttr(tab)}" fill="none" stroke="${gem.dark}"
         stroke-width="${(radius * 0.018).toFixed(2)}" opacity="0.5"/>`;

  if (streak) {
    // Отражение окна на площадке — диагональ по ключевому свету.
    const w = radius * table * 0.72, h = radius * table * 0.2;
    const ax = cx + LIGHT.x * radius * table * 0.38;
    const ay = cy + LIGHT.y * radius * table * 0.38;
    s += `<ellipse cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}"
           rx="${w.toFixed(1)}" ry="${h.toFixed(1)}" fill="${gem.lightest}" opacity="0.22"
           transform="rotate(-38 ${ax.toFixed(1)} ${ay.toFixed(1)})"/>`;
  }
  return s;
}

/* ───────────────────────────── металл ───────────────────────────── */

/**
 * texturePattern(id, href, opts) — <pattern> из растровой карты.
 * Используется как fill= для металла/дерева/мрамора.
 * href — обязательно data:-URI (страница растеризатора не имеет базового
 * пути, относительные ссылки в ней не резолвятся).
 */
export function texturePattern(id, href, opts = {}) {
  const { tile = 256, x = 0, y = 0, rotate = 0, opacity = 1 } = opts;
  const tr = rotate ? ` patternTransform="rotate(${rotate})"` : "";
  return recipe(id, `<pattern id="${id}" patternUnits="userSpaceOnUse"
      x="${x}" y="${y}" width="${tile}" height="${tile}"${tr}>
    <image href="${href}" x="0" y="0" width="${tile}" height="${tile}"
           preserveAspectRatio="none" opacity="${opacity}"/>
  </pattern>`, { fill: `url(#${id})` });
}

/**
 * Мощение растровой карты по всей области фильтра.
 * feImage кладёт картинку один раз, feTile размножает её.
 * Возвращает пару примитивов, результат лежит в `result`.
 */
function tiledImage(href, tile, result) {
  if (!href) return "";
  return `<feImage href="${href}" x="0" y="0" width="${tile}" height="${tile}"
          preserveAspectRatio="none" result="${result}_src"/>
    <feTile in="${result}_src" result="${result}"/>`;
}

/**
 * metalGold(id, opts) — золото по PBR-карте с анизотропным бликом.
 *
 * Разделение обязанностей, без которого металл не получается:
 *   ЗАЛИВКА фигуры (её даёт вызывающий код — envGold или свой градиент)
 *     задаёт МАКРО-тон: отражение неба сверху, раскалённый горизонт
 *     посередине, тёмная земля снизу;
 *   ТЕКСТУРА через `href` подмешивается режимом overlay и даёт только
 *     МИКРОрельеф — она обязана быть картой детали из pbr.detailUri(),
 *     то есть серой вокруг 0.5, иначе собьёт тон;
 *   ФИЛЬТР добавляет фаску (толщину металла) и анизотропный блик:
 *     шум, растянутый вдоль одной оси, работает картой борозд полировки,
 *     поэтому блик вытягивается в полосу, как на шлифованном золоте,
 *     а не сидит круглым пятном.
 *
 * @param {string} id
 * @param {object} opts
 * @param {string} opts.href        data:-URI карты детали (pbr.detailUri)
 * @param {number} opts.tile        размер плитки в пользовательских единицах
 * @param {number} opts.texture     сила микрорельефа 0..1
 * @param {number} opts.height      ширина фаски, px
 * @param {number} opts.depth       surfaceScale фаски
 * @param {number} opts.anisotropy  0..1, вытянутость блика
 * @param {string} opts.tint        цвет блика
 */
export function metalGold(id, opts = {}) {
  const {
    href = null,
    tile = 256,
    texture = 0.75,
    height = 5,
    depth = 22,
    anisotropy = 0.85,
    grooves = 0.10,
    grooveFreq = 0.06,
    specular = 1.15,
    shininess = 40,
    tint = "#FFF6D8",
    light = LIGHT,
    seed = nextSeed()
  } = opts;

  // Борозды полировки: низкая частота вдоль X, высокая поперёк —
  // получается штриховка, а не крапка.
  //
  // Частоты задаются в ПОЛЬЗОВАТЕЛЬСКИХ ЕДИНИЦАХ, то есть 0.42 — это
  // почти пиксельный шум. Такая карта высот превращает металл в
  // блёстки: каждый пиксель ловит свой блик. Рабочий диапазон для
  // борозды — 0.06…0.12; проверено на стенде.
  const fy = grooveFreq;
  const fx = (grooveFreq * (1 - anisotropy) + 0.003).toFixed(4);

  const base = href
    ? `${tiledImage(href, tile, "mg_tex")}
    <feBlend in="SourceGraphic" in2="mg_tex" mode="overlay" result="mg_ov"/>
    <feComposite in="mg_ov" in2="SourceGraphic" operator="arithmetic"
                 k1="0" k2="${texture}" k3="${(1 - texture).toFixed(3)}" k4="0" result="mg_base"/>`
    : `<feOffset in="SourceGraphic" result="mg_base"/>`;

  return recipe(id, `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%"
      color-interpolation-filters="sRGB">
    ${base}

    <!-- карта высот: фаска контура + микро-борозды полировки -->
    <feGaussianBlur in="SourceAlpha" stdDeviation="${height}" result="mg_h0"/>
    <feComponentTransfer in="mg_h0" result="mg_h1">
      <feFuncA type="table" tableValues="0 0.42 0.82 0.96 1"/>
    </feComponentTransfer>
    <feTurbulence type="fractalNoise" baseFrequency="${fx} ${fy}" numOctaves="2"
                  seed="${seed}" result="mg_gr"/>
    <feColorMatrix in="mg_gr" type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${grooves} 0 0 0 ${(1 - grooves * 0.5).toFixed(3)}"
        result="mg_grA"/>
    <feComposite in="mg_h1" in2="mg_grA" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="mg_h"/>

    <feDiffuseLighting in="mg_h" surfaceScale="${depth}"
                       diffuseConstant="${neutralDiffuse(light).toFixed(3)}"
                       lighting-color="#FFFBF0" result="mg_d">
      ${distantLight(light)}
    </feDiffuseLighting>
    <feComposite in="mg_d" in2="mg_base" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="mg_lit"/>

    <feSpecularLighting in="mg_h" surfaceScale="${depth}" specularConstant="${specular}"
        specularExponent="${shininess}" lighting-color="${tint}" result="mg_s">
      ${distantLight(light)}
    </feSpecularLighting>
    <feComposite in="mg_s" in2="SourceAlpha" operator="in" result="mg_sm"/>
    <feComposite in="mg_lit" in2="mg_sm" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0" result="mg_out"/>
    <feComposite in="mg_out" in2="SourceAlpha" operator="in"/>
  </filter>`);
}

/**
 * envGold(id, opts) — макро-заливка золота: отражение сцены.
 *
 * Не «градиент от светлого к тёмному», а именно отражение: сверху
 * прохладное небо, ниже раскалённая полоса горизонта, ещё ниже
 * тёплый отскок от земли и глубокая тень в нижней кромке. Это то,
 * что отличает золото от жёлтой пластмассы. Ось наклонена по
 * ключевому свету, поэтому металл согласован со всеми фасками.
 */
export function envGold(id, opts = {}) {
  const {
    sky = "#FFF7DE", horizonHot = "#FFFFFF", gold = "#F7C948",
    deep = "#A9690C", shadow = "#5E3703", bounce = "#FFD98A",
    angle = 100
  } = opts;
  return linear(id, [
    ["0%", sky], ["12%", horizonHot], ["24%", gold],
    ["46%", deep], ["58%", shadow], ["72%", deep],
    ["88%", bounce], ["100%", gold]
  ], angle);
}

/** Серебро/сталь тем же принципом — для вторичного металла UI. */
export function envSilver(id, opts = {}) {
  const {
    sky = "#F8FCFF", horizonHot = "#FFFFFF", body = "#C3CEE0",
    deep = "#6B7A90", shadow = "#39445A", bounce = "#9FD6EA",
    angle = 100
  } = opts;
  return linear(id, [
    ["0%", sky], ["12%", horizonHot], ["26%", body],
    ["48%", deep], ["60%", shadow], ["74%", deep],
    ["90%", bounce], ["100%", body]
  ], angle);
}

/**
 * carvedWood(id, opts) — резное дерево.
 *
 * Отличие от металла: свет рассеянный (дерево не зеркалит), рельеф
 * идёт вдоль волокна, а по кромкам добавляются потёртости — светлые
 * задиры там, где резьба выступает. Без потёртостей дерево выглядит
 * пластиковым.
 */
export function carvedWood(id, opts = {}) {
  const {
    href = null,
    tile = 256,
    texture = 0.8,
    height = 5.5,
    depth = 16,
    grainFreq = 0.012,
    grainAmount = 0.28,
    wear = 0.35,
    specular = 0.42,
    shininess = 9,
    tint = "#FFE7BE",
    light = LIGHT,
    seed = nextSeed()
  } = opts;

  const base = href
    ? `${tiledImage(href, tile, "cw_tex")}
    <feBlend in="SourceGraphic" in2="cw_tex" mode="overlay" result="cw_ov"/>
    <feComposite in="cw_ov" in2="SourceGraphic" operator="arithmetic"
                 k1="0" k2="${texture}" k3="${(1 - texture).toFixed(3)}" k4="0" result="cw_base"/>`
    : `<feOffset in="SourceGraphic" result="cw_base"/>`;

  return recipe(id, `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%"
      color-interpolation-filters="sRGB">
    ${base}
    <feGaussianBlur in="SourceAlpha" stdDeviation="${height}" result="cw_h0"/>
    <feComponentTransfer in="cw_h0" result="cw_h1">
      <feFuncA type="table" tableValues="0 0.30 0.70 0.92 1"/>
    </feComponentTransfer>
    <!-- волокно: низкая частота вдоль X, высокая поперёк -->
    <feTurbulence type="fractalNoise" baseFrequency="${grainFreq} ${(grainFreq * 9).toFixed(4)}"
                  numOctaves="4" seed="${seed}" result="cw_g"/>
    <feColorMatrix in="cw_g" type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${grainAmount} 0 0 0 ${(1 - grainAmount * 0.5).toFixed(3)}"
        result="cw_gA"/>
    <feComposite in="cw_h1" in2="cw_gA" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="cw_h"/>

    <feDiffuseLighting in="cw_h" surfaceScale="${depth}"
                       diffuseConstant="${neutralDiffuse(light).toFixed(3)}"
                       lighting-color="#FFF3E2" result="cw_d">
      ${distantLight(light)}
    </feDiffuseLighting>
    <feComposite in="cw_d" in2="cw_base" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="cw_lit"/>

    <feSpecularLighting in="cw_h" surfaceScale="${depth}" specularConstant="${specular}"
        specularExponent="${shininess}" lighting-color="${tint}" result="cw_s">
      ${distantLight(light)}
    </feSpecularLighting>
    <feComposite in="cw_s" in2="SourceAlpha" operator="in" result="cw_sm"/>
    <feComposite in="cw_lit" in2="cw_sm" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0" result="cw_add"/>

    <!-- потёртости: светлые задиры на выступающих кромках -->
    <feMorphology in="SourceAlpha" operator="erode" radius="${(height * 0.6).toFixed(2)}"
                  result="cw_er"/>
    <feComposite in="SourceAlpha" in2="cw_er" operator="out" result="cw_rim"/>
    <feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2"
                  seed="${seed + 5}" result="cw_wt"/>
    <feColorMatrix in="cw_wt" type="saturate" values="0" result="cw_wm"/>
    <feComponentTransfer in="cw_wm" result="cw_ws">
      <feFuncR type="gamma" exponent="4" amplitude="1.6"/>
      <feFuncG type="gamma" exponent="4" amplitude="1.6"/>
      <feFuncB type="gamma" exponent="4" amplitude="1.6"/>
      <feFuncA type="linear" slope="0" intercept="1"/>
    </feComponentTransfer>
    <feComposite in="cw_ws" in2="cw_rim" operator="in" result="cw_wear"/>
    <feComposite in="cw_add" in2="cw_wear" operator="arithmetic"
                 k1="0" k2="1" k3="${wear}" k4="0" result="cw_out"/>
    <feComposite in="cw_out" in2="SourceAlpha" operator="in"/>
  </filter>`);
}

/* ──────────────────────── свет вокруг объекта ───────────────────── */

/**
 * rimLight(id, color, width) — контровой свет по контуру.
 *
 * Узкая яркая полоса на кромке со стороны, ПРОТИВОПОЛОЖНОЙ ключу:
 * так объект отделяется от фона, даже когда их тона совпали.
 * В эталонах Pragmatic это видно на каждом символе — холодный
 * ободок по нижне-правому краю золотой оправы.
 */
export function rimLight(id, color = "#8FE8FF", width = 2.5, opts = {}) {
  const { opacity = 0.9, softness = 1.2, offset = 1.6, light = LIGHT, inside = true } = opts;
  const dx = (light.shadowX * offset).toFixed(2);
  const dy = (light.shadowY * offset).toFixed(2);

  // Полоса строится так: силуэт сдвигается ОТ света, из исходной альфы
  // вычитается сдвинутая копия — остаётся серп на дальней кромке.
  const band = inside
    ? `<feOffset in="SourceAlpha" dx="${-dx}" dy="${-dy}" result="rl_off"/>
       <feComposite in="SourceAlpha" in2="rl_off" operator="out" result="rl_band0"/>
       <feComposite in="rl_band0" in2="SourceAlpha" operator="in" result="rl_band"/>`
    : `<feMorphology in="SourceAlpha" operator="dilate" radius="${width}" result="rl_dil"/>
       <feOffset in="rl_dil" dx="${dx}" dy="${dy}" result="rl_off"/>
       <feComposite in="rl_off" in2="SourceAlpha" operator="out" result="rl_band"/>`;

  return recipe(id, `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"
      color-interpolation-filters="sRGB">
    ${band}
    <feGaussianBlur in="rl_band" stdDeviation="${softness}" result="rl_soft"/>
    <feFlood flood-color="${color}" flood-opacity="${opacity}" result="rl_c"/>
    <feComposite in="rl_c" in2="rl_soft" operator="in" result="rl_rim"/>
    <feComposite in="SourceGraphic" in2="rl_rim" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0" result="rl_out"/>
    <feComposite in="rl_out" in2="SourceAlpha" operator="in"/>
  </filter>`);
}

/**
 * contour(id, color, width) — тёмный контур вокруг силуэта.
 *
 * Признак, который есть у КАЖДОГО символа в эталонах Pragmatic и
 * которого не хватало здесь. На барабане символ лежит на фоне
 * похожей светлоты, и без контура его край растворяется: предмет
 * читается как пятно, а не как предмет. Контур в полтора-два пикселя
 * тёмного насыщенного цвета (не чёрного — чёрный делает картинку
 * грязной) отделяет силуэт при любом фоне и заодно собирает
 * симметричный «мультяшный» вес, к которому глаз привык в слотах.
 *
 * Рисуется СНАРУЖИ: расширенная копия альфы кладётся под исходник,
 * поэтому форма самого предмета не худеет.
 *
 * @param {string} id
 * @param {string} color  тёмный насыщенный цвет, родственный предмету
 * @param {number} width  толщина в пикселях исходника
 * @param {object} opts
 * @param {number} opts.opacity
 * @param {number} opts.softness   размытие контура (0 — резкий)
 */
export function contour(id, color = "#2A0B45", width = 3, opts = {}) {
  const { opacity = 1, softness = 0.6 } = opts;
  const m = Math.max(25, Math.ceil(width * 6));
  return recipe(id, `<filter id="${id}" x="-${m}%" y="-${m}%"
      width="${100 + m * 2}%" height="${100 + m * 2}%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="${width}" result="ct_d"/>
    ${softness > 0 ? `<feGaussianBlur in="ct_d" stdDeviation="${softness}" result="ct_s"/>`
                   : `<feOffset in="ct_d" result="ct_s"/>`}
    <feFlood flood-color="${color}" flood-opacity="${opacity}" result="ct_c"/>
    <feComposite in="ct_c" in2="ct_s" operator="in" result="ct_ring"/>
    <feMerge>
      <feMergeNode in="ct_ring"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>`);
}

/**
 * dropContact(id, opacity) — контактная тень.
 *
 * Две тени вместо одной. Плотное короткое пятно прямо под объектом
 * говорит «предмет касается барабана», широкое мягкое — «под ним есть
 * воздух и объём». Одна тень средней мягкости не даёт ни того, ни
 * другого, и символ повисает в пустоте.
 */
export function dropContact(id, opacity = 0.55, opts = {}) {
  const {
    distance = 7,
    contactBlur = 2.2,
    ambientBlur = 14,
    ambient = 0.45,
    color = "#000000",
    light = LIGHT
  } = opts;
  const dx = (light.shadowX * distance).toFixed(2);
  const dy = (light.shadowY * distance).toFixed(2);

  return recipe(id, `<filter id="${id}" x="-45%" y="-45%" width="190%" height="190%"
      color-interpolation-filters="sRGB">
    <!-- широкая мягкая тень: объём -->
    <feGaussianBlur in="SourceAlpha" stdDeviation="${ambientBlur}" result="dc_a0"/>
    <feOffset in="dc_a0" dx="${(dx * 0.6).toFixed(2)}" dy="${(dy * 0.9).toFixed(2)}" result="dc_a1"/>
    <feFlood flood-color="${color}" flood-opacity="${ambient}" result="dc_ac"/>
    <feComposite in="dc_ac" in2="dc_a1" operator="in" result="dc_amb"/>
    <!-- плотное короткое пятно: контакт -->
    <feGaussianBlur in="SourceAlpha" stdDeviation="${contactBlur}" result="dc_c0"/>
    <feOffset in="dc_c0" dx="${(dx * 0.35).toFixed(2)}" dy="${(dy * 0.5).toFixed(2)}" result="dc_c1"/>
    <feFlood flood-color="${color}" flood-opacity="${opacity}" result="dc_cc"/>
    <feComposite in="dc_cc" in2="dc_c1" operator="in" result="dc_con"/>
    <feMerge>
      <feMergeNode in="dc_amb"/>
      <feMergeNode in="dc_con"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>`);
}

/**
 * innerGlow(id, color, opts) — свечение внутрь от контура.
 * Заменяет ctx.shadowBlur в рантайме: свечение печётся в текстуру,
 * а не считается каждый кадр на CPU.
 */
export function innerGlow(id, color = "#FFD98A", opts = {}) {
  const { size = 8, opacity = 0.8, spread = 0 } = opts;
  const src = spread > 0
    ? `<feMorphology in="SourceAlpha" operator="erode" radius="${spread}" result="ig_src"/>`
    : `<feOffset in="SourceAlpha" result="ig_src"/>`;
  return recipe(id, `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"
      color-interpolation-filters="sRGB">
    ${src}
    <feGaussianBlur in="ig_src" stdDeviation="${size}" result="ig_b"/>
    <feComposite in="SourceAlpha" in2="ig_b" operator="out" result="ig_band"/>
    <feFlood flood-color="${color}" flood-opacity="${opacity}" result="ig_c"/>
    <feComposite in="ig_c" in2="ig_band" operator="in" result="ig_glow"/>
    <feComposite in="SourceGraphic" in2="ig_glow" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0" result="ig_out"/>
    <feComposite in="ig_out" in2="SourceAlpha" operator="in"/>
  </filter>`);
}

/** outerGlow(id, color, opts) — ореол снаружи силуэта, в два слоя. */
export function outerGlow(id, color = "#FFC24F", opts = {}) {
  const { size = 12, opacity = 0.85, halo = 2.6, haloOpacity = 0.35 } = opts;
  const m = Math.max(60, Math.ceil(size * halo * 3));
  return recipe(id, `<filter id="${id}" x="-${m}%" y="-${m}%"
      width="${100 + m * 2}%" height="${100 + m * 2}%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${(size * halo).toFixed(2)}" result="og_w"/>
    <feFlood flood-color="${color}" flood-opacity="${haloOpacity}" result="og_wc"/>
    <feComposite in="og_wc" in2="og_w" operator="in" result="og_wide"/>
    <feGaussianBlur in="SourceAlpha" stdDeviation="${size}" result="og_t"/>
    <feFlood flood-color="${color}" flood-opacity="${opacity}" result="og_tc"/>
    <feComposite in="og_tc" in2="og_t" operator="in" result="og_tight"/>
    <feMerge>
      <feMergeNode in="og_wide"/>
      <feMergeNode in="og_tight"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>`);
}

/**
 * grain(id, amount) — плёночное зерно.
 * Микрошум ломает «цифровую» чистоту градиентов; без него большие
 * заливки полосят бандингом, а картинка выглядит рендером, а не кадром.
 */
export function grain(id, amount = 0.06, opts = {}) {
  const { freq = 0.85, seed = nextSeed(), clip = true } = opts;
  const slope = (amount * 2).toFixed(4);
  const intercept = (0.5 - amount).toFixed(4);
  return recipe(id, `<filter id="${id}" x="0%" y="0%" width="100%" height="100%"
      color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="1"
                  seed="${seed}" stitchTiles="stitch" result="gr_n"/>
    <feColorMatrix in="gr_n" type="saturate" values="0" result="gr_m"/>
    <feComponentTransfer in="gr_m" result="gr_s">
      <feFuncR type="linear" slope="${slope}" intercept="${intercept}"/>
      <feFuncG type="linear" slope="${slope}" intercept="${intercept}"/>
      <feFuncB type="linear" slope="${slope}" intercept="${intercept}"/>
      <feFuncA type="linear" slope="0" intercept="1"/>
    </feComponentTransfer>
    <feBlend in="SourceGraphic" in2="gr_s" mode="overlay" result="gr_out"/>
    ${clip ? `<feComposite in="gr_out" in2="SourceAlpha" operator="in"/>` : `<feOffset in="gr_out"/>`}
  </filter>`);
}

/* ─────────────────── дополнительные рецепты ─────────────────────── */

/**
 * frost(id) — матовое/морозное стекло: искажение фона под панелью.
 * Для полупрозрачных панелей HUD поверх пейзажа.
 */
export function frost(id, opts = {}) {
  const { blur = 6, distort = 3, freq = 0.05, seed = nextSeed() } = opts;
  return recipe(id, `<filter id="${id}" x="-15%" y="-15%" width="130%" height="130%"
      color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2"
                  seed="${seed}" result="fr_t"/>
    <feDisplacementMap in="SourceGraphic" in2="fr_t" scale="${distort}"
                       xChannelSelector="R" yChannelSelector="G" result="fr_d"/>
    <feGaussianBlur in="fr_d" stdDeviation="${blur}" result="fr_b"/>
    <feComposite in="fr_b" in2="SourceAlpha" operator="in"/>
  </filter>`);
}

/**
 * liquid(id) — искажение воды: используется для отражений на море
 * и для «плывущего» стекла в кнопках.
 */
export function liquid(id, opts = {}) {
  const { scale = 12, freq = "0.008 0.05", octaves = 2, seed = nextSeed() } = opts;
  return recipe(id, `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"
      color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}"
                  seed="${seed}" result="lq_t"/>
    <feDisplacementMap in="SourceGraphic" in2="lq_t" scale="${scale}"
                       xChannelSelector="R" yChannelSelector="G"/>
  </filter>`);
}

/**
 * emboss(id) — быстрый рельеф для мелких деталей (гравировка на металле,
 * насечка на панели). Дешевле bevel: одна карта высот, только диффуз.
 */
export function emboss(id, opts = {}) {
  const { height = 2, depth = 2.4, light = LIGHT } = opts;
  return recipe(id, `<filter id="${id}" x="-15%" y="-15%" width="130%" height="130%"
      color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${height}" result="em_h"/>
    <feDiffuseLighting in="em_h" surfaceScale="${depth}"
                       diffuseConstant="${neutralDiffuse(light).toFixed(3)}"
                       lighting-color="#ffffff" result="em_d">
      ${distantLight(light)}
    </feDiffuseLighting>
    <feComposite in="em_d" in2="SourceGraphic" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" result="em_out"/>
    <feComposite in="em_out" in2="SourceAlpha" operator="in"/>
  </filter>`);
}

/**
 * Композиция рецептов в один filter=«a b c».
 * SVG применяет их слева направо; порядок важен: сначала материал,
 * потом контровой свет, последней — тень (иначе тень получит блик).
 */
export function stack(...recipes) {
  return recipes.filter(Boolean).map((r) => (typeof r === "string" ? r : r.ref)).join(" ");
}

/** Собирает def-строки набора рецептов для вставки в <defs>. */
export function defsOf(...recipes) {
  return recipes.filter(Boolean).map((r) => (typeof r === "string" ? r : r.def)).join("\n");
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
