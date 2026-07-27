// Орнаментальная геометрия для оправы, табличек и картушей.
//
// Здесь нет ни одного фильтра и ни одного цвета — только ФОРМА.
// Объём этим формам даёт svg-lib.mjs (bevel / metalGold / carvedWood),
// и работает он по АЛЬФЕ группы. Отсюда главное правило модуля:
//
//   каждая выпуклая деталь орнамента — ОТДЕЛЬНАЯ фигура с зазором
//   от соседей.
//
// Если нарисовать раковину одним контуром с прорисованными внутри
// «рёбрами», карта высот будет плоской: фильтр видит только силуэт,
// а внутренние линии для альфы не существуют. Разрезав ту же раковину
// на девять отдельных клиньев с зазором в полтора пикселя, мы получаем
// девять независимых валиков — и фаска лепит каждый по отдельности.
// Ровно этим «резной» орнамент отличается от «нарисованного».

import { polar, pointsAttr } from "./svg-lib.mjs";

const RAD = Math.PI / 180;

/**
 * Капсула — отрезок заданной толщины, но НЕ обводкой.
 *
 * Ловушка, на которой пропали шток и веретено якоря: у строго
 * горизонтального или вертикального `<path>` габаритный прямоугольник
 * вырожден (ширина или высота равна нулю), а заливка `url(#…)` по
 * умолчанию считается в objectBoundingBox. По спецификации SVG такой
 * элемент НЕ ОТРИСОВЫВАЕТСЯ вообще. Обводка градиентом молча исчезает,
 * и якорь превращается в колечко со скобкой.
 *
 * Повёрнутый `<rect>` всегда имеет обе стороны, поэтому годится
 * с любой заливкой и в любом наклоне.
 */
export function capsule(x1, y1, x2, y2, w, fill = "currentColor") {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 0.01 || w <= 0) return "";
  const a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return `<g transform="translate(${x1.toFixed(2)} ${y1.toFixed(2)}) rotate(${a.toFixed(2)})">
    <rect x="0" y="${(-w / 2).toFixed(2)}" width="${len.toFixed(2)}" height="${w.toFixed(2)}"
          rx="${(w / 2).toFixed(2)}" fill="${fill}"/></g>`;
}

/* ─────────────────────────── витой канат ────────────────────────── */

/**
 * Витой канат вдоль отрезка.
 *
 * Прядь — короткий наклонный штрих поперёк оси; наклон и есть признак
 * «витого», без него получается не канат, а бусы. Пряди рисуются ШИРЕ
 * сердечника, поэтому силуэт каната получается фестончатым и фаска
 * лепит каждую прядь отдельно, не разрывая жгут на части.
 *
 * @param {number} x1,y1,x2,y2 ось каната
 * @param {object} o
 * @param {number} o.width   толщина жгута
 * @param {number} o.period  шаг прядей
 * @param {number} o.tilt    наклон пряди к нормали, градусы
 * @param {string} o.fill
 */
export function rope(x1, y1, x2, y2, o = {}) {
  const { width = 14, period = 15, tilt = 34, fill = "currentColor", core = 0.58 } = o;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return "";
  const ux = dx / len, uy = dy / len;      // вдоль оси
  const nx = -uy, ny = ux;                 // поперёк

  const c = Math.cos(tilt * RAD), s = Math.sin(tilt * RAD);
  // Направление пряди: нормаль, повёрнутая на tilt в сторону оси.
  const sx = nx * c + ux * s;
  const sy = ny * c + uy * s;
  const half = width / 2 / c;

  const n = Math.max(2, Math.round(len / period));
  const step = len / n;
  let out = capsule(x1, y1, x2, y2, width * core, fill);
  for (let i = 0; i <= n; i++) {
    const t = i * step;
    const cx = x1 + ux * t, cy = y1 + uy * t;
    out += capsule(cx - sx * half, cy - sy * half, cx + sx * half, cy + sy * half,
      step * 0.62, fill);
  }
  return out;
}

/* ──────────────────────────── бусина / перл ─────────────────────── */

/** Ряд жемчужин вдоль отрезка — классический «астрагал». */
export function beadRun(x1, y1, x2, y2, o = {}) {
  const { radius = 5, period = 17, fill = "currentColor", alt = 0 } = o;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const n = Math.max(1, Math.round(len / period));
  let out = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = alt && i % 2 ? radius * alt : radius;
    out += `<circle cx="${(x1 + dx * t).toFixed(2)}" cy="${(y1 + dy * t).toFixed(2)}"
             r="${r.toFixed(2)}" fill="${fill}"/>`;
  }
  return out;
}

/* ──────────────────────────── завиток ───────────────────────────── */

/**
 * Волюта — сужающийся к центру завиток, основа любой резьбы.
 *
 * Строится как полигон между двумя логарифмическими спиралями:
 * внешняя и внутренняя расходятся на толщину, которая падает вместе
 * с радиусом. Поэтому завиток сходит на нет, а не обрывается пеньком.
 *
 * @param {number} cx,cy центр закрутки
 * @param {number} r     начальный радиус
 * @param {object} o
 * @param {number} o.turns    сколько оборотов
 * @param {number} o.start    начальный угол, градусы
 * @param {number} o.thick    толщина у основания, доля радиуса
 * @param {number} o.decay    во сколько раз спираль ужимается за оборот
 * @param {number} o.dir      1 — по часовой, -1 — против
 */
export function volute(cx, cy, r, o = {}) {
  const {
    turns = 1.15, start = 0, thick = 0.34, decay = 2.4, dir = 1, fill = "currentColor"
  } = o;
  const steps = Math.max(24, Math.round(turns * 40));
  const k = Math.log(decay) / (2 * Math.PI);
  const outer = [], inner = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    const rr = r * Math.exp(-k * t);
    const a = start * RAD + dir * t;
    // Толщина падает быстрее радиуса — кончик получается острым.
    const w = thick * rr * (1 - (i / steps) * 0.35);
    const ux = Math.cos(a), uy = Math.sin(a);
    outer.push({ x: cx + ux * (rr + w / 2), y: cy + uy * (rr + w / 2) });
    inner.push({ x: cx + ux * (rr - w / 2), y: cy + uy * (rr - w / 2) });
  }
  const pts = outer.concat(inner.reverse());
  return `<polygon points="${pointsAttr(pts)}" fill="${fill}"/>`;
}

/**
 * Лист аканта: капля с волнистым краем, растущая из точки.
 * Отдельная фигура, потому что должна лепиться сама по себе.
 */
export function leaf(x, y, len, o = {}) {
  const { angle = -90, width = 0.28, curl = 0.22, fill = "currentColor" } = o;
  const a = angle * RAD;
  const ux = Math.cos(a), uy = Math.sin(a);
  const nx = -uy, ny = ux;
  // Точка на оси листа: t вдоль, s поперёк (s в долях длины).
  const P = (t, s) => {
    const bend = curl * len * t * t;      // изгиб к острию
    const dx = len * t, dy = (s + bend);
    return `${(x + ux * dx + nx * dy).toFixed(2)} ${(y + uy * dx + ny * dy).toFixed(2)}`;
  };
  const w = width * len;
  // Две квадратичные дуги от черенка к острию. Полигон по формуле
  // «синус ширины» давал луковицу: у него максимум ширины уезжал
  // к середине, и лист терял и черенок, и остриё.
  return `<path d="M ${P(0, 0)}
      Q ${P(0.3, w)} ${P(0.62, w * 0.72)}
      Q ${P(0.88, w * 0.34)} ${P(1, 0)}
      Q ${P(0.88, -w * 0.34)} ${P(0.62, -w * 0.72)}
      Q ${P(0.3, -w)} ${P(0, 0)} Z" fill="${fill}"/>`;
}

/* ─────────────────────────── морская раковина ───────────────────── */

/**
 * Раковина-гребешок: веер отдельных рёбер плюс замок.
 *
 * Каждое ребро — самостоятельный клин с зазором, поэтому фаска делает
 * из веера настоящую гофру. Внешний радиус чередуется, и край
 * получается фестончатым, как у живого гребешка.
 */
export function shellFan(cx, cy, r, o = {}) {
  const {
    ribs = 9, spread = 186, rotation = -90, gap = 2.6,
    fill = "currentColor", hinge = 0.3, wave = 0.055
  } = o;
  const a0 = rotation - spread / 2;
  const stepA = spread / ribs;
  let out = "";

  // Замок (ушки) — основание веера.
  const hr = r * hinge;
  const e1 = polar(cx, cy, hr * 1.35, rotation - 96);
  const e2 = polar(cx, cy, hr * 1.35, rotation + 96);
  out += `<path d="M ${e1.x.toFixed(2)} ${e1.y.toFixed(2)}
      Q ${cx} ${(cy - hr * 1.1).toFixed(2)} ${e2.x.toFixed(2)} ${e2.y.toFixed(2)}
      Q ${cx} ${(cy + hr * 0.55).toFixed(2)} ${e1.x.toFixed(2)} ${e1.y.toFixed(2)} Z"
      fill="${fill}"/>`;

  for (let i = 0; i < ribs; i++) {
    const s = a0 + stepA * i + gap / 2;
    const e = a0 + stepA * (i + 1) - gap / 2;
    // Средние рёбра длиннее крайних — веер получает выпуклый край.
    const mid = (i + 0.5) / ribs;
    const rr = r * (1 - wave * (i % 2)) * (0.86 + 0.14 * Math.sin(mid * Math.PI));
    const p0 = polar(cx, cy, hr * 0.72, s);
    const p1 = polar(cx, cy, rr, s);
    const p2 = polar(cx, cy, rr, e);
    const p3 = polar(cx, cy, hr * 0.72, e);
    out += `<path d="M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}
        L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}
        A ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}
        L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)} Z"
        fill="${fill}" stroke="${fill}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  return out;
}

/* ───────────────────────────── якорь ────────────────────────────── */

/**
 * Якорь: рым, шток, веретено и рога — четыре отдельные детали.
 * Собранный одним контуром якорь под фаской выглядит вырезанным
 * из фанеры; разрезанный — коваными частями, лежащими друг на друге.
 */
export function anchor(cx, cy, h, o = {}) {
  const { fill = "currentColor", thick = 0.1 } = o;
  const t = h * thick;
  const top = cy - h / 2;
  const bot = cy + h / 2;
  const ringR = h * 0.115;
  const armR = h * 0.34;

  const parts = [];
  // рым — кольцо как два круга с evenodd, а не обводкой: обводка
  // градиентом на дуге ведёт себя так же капризно, как на отрезке.
  const rc = top + ringR;
  const ro = ringR, ri = ringR - t * 0.42;
  parts.push(`<path fill-rule="evenodd" fill="${fill}" d="
    M ${(cx - ro).toFixed(2)} ${rc.toFixed(2)} a ${ro} ${ro} 0 1 0 ${(ro * 2).toFixed(2)} 0 a ${ro} ${ro} 0 1 0 ${(-ro * 2).toFixed(2)} 0 Z
    M ${(cx - ri).toFixed(2)} ${rc.toFixed(2)} a ${ri} ${ri} 0 1 0 ${(ri * 2).toFixed(2)} 0 a ${ri} ${ri} 0 1 0 ${(-ri * 2).toFixed(2)} 0 Z"/>`);
  // веретено
  parts.push(capsule(cx, top + ringR * 1.75, cx, bot - h * 0.1, t, fill));
  // шток
  const sy = top + h * 0.31;
  parts.push(capsule(cx - h * 0.28, sy, cx + h * 0.28, sy, t * 0.76, fill));
  // рога с лапами
  for (const s of [-1, 1]) {
    parts.push(`<path d="M ${cx} ${(bot - h * 0.09).toFixed(2)}
        Q ${(cx + s * armR * 0.62).toFixed(2)} ${(bot - h * 0.01).toFixed(2)}
          ${(cx + s * armR).toFixed(2)} ${(bot - h * 0.26).toFixed(2)}
        L ${(cx + s * armR * 0.86).toFixed(2)} ${(bot - h * 0.3).toFixed(2)}
        Q ${(cx + s * armR * 0.5).toFixed(2)} ${(bot - h * 0.09).toFixed(2)}
          ${cx} ${(bot - h * 0.02).toFixed(2)} Z" fill="${fill}"/>`);
    // лапа-треугольник на конце рога
    const tx = cx + s * armR, ty = bot - h * 0.26;
    parts.push(`<polygon points="${pointsAttr([
      { x: tx - s * t * 1.1, y: ty + t * 0.7 },
      { x: tx + s * t * 1.6, y: ty + t * 1.0 },
      { x: tx + s * t * 0.3, y: ty - t * 1.9 }
    ])}" fill="${fill}"/>`);
  }
  return parts.join("");
}

/* ─────────────────────────── картуш / плашка ────────────────────── */

/**
 * Контур картуша: тело с вогнутыми боками и «щёчками»-волютами.
 * Возвращает только путь тела; волюты вешает вызывающий код
 * отдельными фигурами — им нужна своя фаска.
 */
export function cartouchePath(cx, cy, w, h, o = {}) {
  const { waist = 0.16, notch = 0.24 } = o;
  const hw = w / 2, hh = h / 2;
  const nx = hw * notch;          // глубина скоса на торцах
  const wy = hh * waist;          // прогиб верхней и нижней кромок
  return `M ${(cx - hw).toFixed(2)} ${cy}
    L ${(cx - hw + nx).toFixed(2)} ${(cy - hh).toFixed(2)}
    Q ${cx} ${(cy - hh + wy).toFixed(2)} ${(cx + hw - nx).toFixed(2)} ${(cy - hh).toFixed(2)}
    L ${(cx + hw).toFixed(2)} ${cy}
    L ${(cx + hw - nx).toFixed(2)} ${(cy + hh).toFixed(2)}
    Q ${cx} ${(cy + hh - wy).toFixed(2)} ${(cx - hw + nx).toFixed(2)} ${(cy + hh).toFixed(2)} Z`;
}

/** Прямоугольник со скруглением — как путь, чтобы класть в общий d. */
export function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  return `M ${x + rr} ${y} H ${x + w - rr} A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}
    V ${y + h - rr} A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}
    H ${x + rr} A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}
    V ${y + rr} A ${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`;
}

/** Кольцевой путь (внешний контур минус внутренний) для оправ и рамок. */
export function ringPath(x, y, w, h, r, t) {
  return `${roundRectPath(x, y, w, h, r)} ${roundRectPath(x + t, y + t, w - t * 2, h - t * 2, Math.max(1, r - t))}`;
}

/* ─────────────────────────── угловой акант ──────────────────────── */

/**
 * Угловой акцент: пара волют, расходящихся вдоль двух кромок, и лист
 * между ними. Ставится в угол оправы и «держит» её — без углового
 * акцента любая рамка читается как прямоугольник, чем бы её ни залили.
 *
 * Рисуется в локальных координатах угла (0,0) с ростом в +X и +Y;
 * остальные три угла получаются зеркалированием.
 */
export function acanthusCorner(size, o = {}) {
  const { fill = "currentColor", reach = 1.0 } = o;
  const s = size;
  let out = "";
  // Большая волюта в самом углу.
  out += volute(s * 0.44, s * 0.44, s * 0.3, { turns: 1.3, start: 214, thick: 0.5, decay: 2.6, dir: 1, fill });
  // Усы вдоль кромок.
  out += volute(s * 1.02 * reach, s * 0.3, s * 0.18, { turns: 1.05, start: 190, thick: 0.5, decay: 2.3, dir: -1, fill });
  out += volute(s * 0.3, s * 1.02 * reach, s * 0.18, { turns: 1.05, start: 280, thick: 0.5, decay: 2.3, dir: 1, fill });
  // Листья, уводящие взгляд вдоль планок.
  out += leaf(s * 0.62, s * 0.24, s * 0.62 * reach, { angle: 6, width: 0.3, curl: 0.16, fill });
  out += leaf(s * 0.24, s * 0.62, s * 0.62 * reach, { angle: 84, width: 0.3, curl: -0.16, fill });
  return out;
}
