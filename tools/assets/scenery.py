#!/usr/bin/env python3
"""
Рисованные фоны: закат над Чёрным морем.

    python3 tools/assets/scenery.py

Результат: tools/assets/rendered/img/bg_{landscape,portrait}{,_free}.webp
Сборка ассетов подхватывает их автоматически (см. build.mjs).

─────────────────────── зачем не SVG ────────────────────────

Прежний фон был векторным, и это было видно: плоские заливки, чистые
градиенты, силуэты с математически ровным краем. Векторный редактор
физически не умеет главного, что делает пейзаж пейзажем, — рассеяния.
Свет в воздухе не идёт по прямой: он вязнет в дымке, размывает контур
дальней горы, поднимает её тон к тону неба, растекается ореолом вокруг
солнца. Всё это операции над пикселями, а не над кривыми.

Поэтому здесь всё считается по точкам, в numpy:

  • небо — многоступенчатый градиент плюс мягкий цветовой шум, чтобы
    не было полос на плавных переходах;
  • облака — фрактальный шум, растянутый по горизонтали и подсвеченный
    снизу: тёплый ободок на брюхе, холодная спина;
  • горы — три гряды с шумовым профилем, каждая дальняя светлее и
    контрастнее размыта: это и есть воздушная перспектива;
  • море — набор волновых полей с длиной волны, растущей к зрителю,
    плюс солнечная дорожка из тысяч бликов;
  • сверху — свечение ярких мест, виньетка и зерно.

Зерно в конце обязательно. Идеально гладкий градиент выдаёт машинную
природу картинки сильнее любой другой детали, а лёгкий шум читается
как плёнка и сразу успокаивает глаз.
"""

import os
import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "rendered", "img")

rng = np.random.default_rng(0x50C1)     # детерминированная сборка


# ─────────────────────────── утилиты ──────────────────────────────────

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def blur(a, radius):
    """Гаусс через PIL: на float-массивах свой был бы вдвое медленнее."""
    if radius <= 0:
        return a
    lo, hi = float(a.min()), float(a.max())
    span = (hi - lo) or 1.0
    img = Image.fromarray(((a - lo) / span * 255).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(img).astype(np.float64) / 255 * span + lo


def value_noise(h, w, res_y, res_x, seed_rng, tile_x=False):
    """
    Гладкий шум: случайная сетка, растянутая бикубикой.

    tile_x замыкает шум по горизонтали — правый край сходится с левым.
    Это нужно воде: она выбирается из текстуры по модулю, и без стыковки
    через кадр шёл бы отчётливый вертикальный шов.
    """
    g = seed_rng.random((max(2, res_y), max(2, res_x)))
    if tile_x:
        g = np.concatenate([g, g[:, :1]], axis=1)
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(img).astype(np.float64) / 255


def fbm(h, w, octaves=5, res_y=4, res_x=4, gain=0.5, lacunarity=2.0,
        seed_rng=None, tile_x=False):
    """Фрактальный шум — сумма октав. Основа облаков, гор и фактуры воды."""
    r = seed_rng or rng
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    ry, rx = res_y, res_x
    for _ in range(octaves):
        out += amp * value_noise(h, w, int(ry), int(rx), r, tile_x=tile_x)
        total += amp
        amp *= gain
        ry *= lacunarity
        rx *= lacunarity
    return out / total


def ridge_profile(w, peaks, roughness, seed_rng):
    """
    Профиль горной гряды.

    Обычный шум даёт округлые холмы — на картинке они читались как
    барханы, а не как Кавказ. Нужен гребневый (ridged) шум: у обычного
    берётся модуль относительно середины, и гладкие макушки
    превращаются в острые гребни. Дальше степень поднимает контраст
    склонов, чтобы силуэт был угловатым.
    """
    x = np.linspace(0, 1, w)

    # Крупная форма массива: несколько вершин разной высоты.
    prof = np.zeros(w)
    for k in range(1, peaks + 1):
        prof += (np.sin(2 * np.pi * k * x + seed_rng.random() * 6.28)
                 / k ** 1.05) * seed_rng.uniform(0.55, 1.0)
    prof = (prof - prof.min()) / (np.ptp(prof) or 1)

    # Гребневой шум поверх — сколы, кулуары, зубцы.
    n = fbm(1, w, octaves=6, res_y=2, res_x=5, seed_rng=seed_rng)[0]
    ridged = 1.0 - np.abs(2.0 * n - 1.0)
    ridged = (ridged - ridged.min()) / (np.ptp(ridged) or 1)
    ridged = ridged ** 0.7

    out = prof * (1 - roughness) + ridged * roughness
    out = (out - out.min()) / (np.ptp(out) or 1)
    return np.clip(out ** 1.25, 0, 1)


def lerp_color(stops, tvals):
    """Многоцветный градиент. stops = [(позиция, (r,g,b)), …] в 0..1."""
    pos = np.array([s[0] for s in stops])
    cols = np.array([s[1] for s in stops], dtype=np.float64) / 255.0
    out = np.empty(tvals.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(tvals, pos, cols[:, c])
    return out


def over(dst, src, alpha):
    """Наложение src поверх dst. alpha — карта или одно число."""
    a = np.asarray(alpha, dtype=np.float64)
    if a.ndim == 2:
        a = a[..., None]
    return dst * (1 - a) + src * a


# ──────────────────────────── палитры ─────────────────────────────────

DAY = {
    "sky": [
        (0.00, (32, 18, 74)),      # зенит — глубокий индиго
        (0.30, (86, 40, 104)),
        (0.52, (168, 62, 106)),    # магента
        (0.70, (232, 104, 88)),    # коралл
        (0.86, (252, 168, 78)),
        (1.00, (255, 226, 150)),   # горизонт — расплавленное золото
    ],
    "sun": (255, 246, 206),
    "sun_glow": (255, 172, 92),
    "ridge_far": (120, 96, 150),
    "ridge_mid": (78, 56, 108),
    "ridge_near": (44, 28, 66),
    "snow": (255, 208, 190),
    "sea_far": (196, 132, 118),    # у горизонта вода берёт цвет неба
    "sea_near": (8, 38, 54),
    "glitter": (255, 232, 176),
    "sand": (88, 62, 68),
    "palm": (16, 10, 26),
    "haze": (238, 158, 118),
}

NIGHT = {
    "sky": [
        (0.00, (6, 8, 30)),
        (0.32, (14, 20, 56)),
        (0.56, (28, 38, 88)),
        (0.76, (54, 60, 116)),
        (0.90, (92, 84, 140)),
        (1.00, (140, 122, 158)),
    ],
    "sun": (236, 240, 255),        # луна
    "sun_glow": (128, 158, 220),
    "ridge_far": (44, 52, 96),
    "ridge_mid": (26, 32, 68),
    "ridge_near": (10, 12, 34),
    "snow": (150, 166, 210),
    "sea_far": (60, 70, 118),
    "sea_near": (4, 12, 30),
    "glitter": (198, 216, 255),
    "sand": (26, 24, 46),
    "palm": (4, 4, 14),
    "haze": (70, 84, 140),
}


# ──────────────────────────── сцена ───────────────────────────────────

def render(w, h, night=False, seed=1):
    r = np.random.default_rng(seed)
    P = NIGHT if night else DAY

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    u = xx / w
    v = yy / h

    horizon = int(h * (0.60 if w >= h else 0.44))
    sun_x = int(w * 0.62)
    sun_y = int(horizon - h * (0.055 if not night else 0.20))
    sun_r = h * (0.052 if not night else 0.030)

    # ── небо ─────────────────────────────────────────────────────────
    sky_t = np.clip(yy / max(horizon, 1), 0, 1)
    img = lerp_color(P["sky"], sky_t)

    # Ореол вокруг светила: воздух рассеивает свет далеко за диск.
    dist = np.sqrt((xx - sun_x) ** 2 + ((yy - sun_y) * 1.25) ** 2)
    glow = np.exp(-dist / (h * (0.30 if not night else 0.16)))
    img = over(img, np.array(P["sun_glow"]) / 255, glow * (0.62 if not night else 0.32))

    # ── облака ───────────────────────────────────────────────────────
    # Растянуты по горизонтали: реальные слоистые облака на закате
    # вытянуты ветром вдоль горизонта, а не круглые.
    cl = fbm(h, w, octaves=6, res_y=3, res_x=9, seed_rng=r)
    band = smoothstep(0.02, 0.42, v) * (1 - smoothstep(0.52, 0.98, v / max(horizon / h, 1e-3)))
    density = smoothstep(0.42, 0.68, cl) * band * 1.25
    if night:
        density *= 0.45

    # Подсветка снизу: солнце под облаком, поэтому брюхо тёплое,
    # а спина остаётся холодной. Градиент берётся из самого шума.
    lit = np.clip(np.gradient(cl, axis=0) * 26 + 0.5, 0, 1)
    warm = np.array(P["sun_glow"]) / 255
    cool = np.array(P["ridge_far"]) / 255
    cloud_col = warm[None, None, :] * lit[..., None] + cool[None, None, :] * (1 - lit[..., None])
    # Ближе к солнцу облака горят ярче.
    cloud_col *= (0.75 + 0.9 * glow)[..., None]
    img = over(img, np.clip(cloud_col, 0, 1), np.clip(density * 0.95, 0, 1))

    # ── диск светила ─────────────────────────────────────────────────
    # Слегка сплюснут: у горизонта атмосфера преломляет свет и солнце
    # всегда выглядит овалом, а не кругом. Мелочь, которую глаз знает.
    disc_d = np.sqrt((xx - sun_x) ** 2 + ((yy - sun_y) / 0.92) ** 2)
    disc = 1 - smoothstep(sun_r * 0.82, sun_r * 1.05, disc_d)
    img = over(img, np.array(P["sun"]) / 255, disc)
    if night:
        # Терминатор луны: тонкая тень с одного края.
        shade = smoothstep(sun_r * 0.2, sun_r * 1.0, np.sqrt((xx - sun_x + sun_r * 0.45) ** 2
                                                             + (yy - sun_y) ** 2))
        img = over(img, np.array((16, 22, 48)) / 255, disc * (1 - shade) * 0.55)
        # звёзды
        st = r.random((h, w))
        stars = (st > 0.99965).astype(np.float64) * smoothstep(0.62, 0.0, v) * (1 - glow)
        stars = blur(stars, 0.6) * 3.0
        img = over(img, np.ones(3), np.clip(stars, 0, 1))

    # ── горные гряды ─────────────────────────────────────────────────
    #
    # Кавказ выходит к морю с одной стороны, а напротив открытое море
    # с солнцем. Поэтому гряды не тянутся через весь горизонт, а сходят
    # на нет к правому краю: получается бухта, а не остров посреди воды.
    # Это и есть узнаваемый сочинский вид — горы прямо у берега.
    coast = np.clip(1 - smoothstep(0.10, 0.62, u[0]), 0, 1) ** 1.1

    ridges = [
        # высота, цвет, дымка, вершин, изрезанность, снег
        (0.215, "ridge_far", 0.40, 6, 0.55, True),
        (0.140, "ridge_mid", 0.17, 5, 0.60, not night),
        (0.080, "ridge_near", 0.0, 4, 0.65, False),
    ]
    for height_f, key, haze_amt, peaks, rough, snowy in ridges:
        prof = ridge_profile(w, peaks, rough, r) * coast
        top = horizon - prof * h * height_f - h * 0.002
        edge = 1.0 + haze_amt * 2.5
        mask = smoothstep(-edge, edge, yy - top[None, :])
        mask *= np.where(yy < horizon + 1, 1.0, 0.0)

        col = np.array(P[key], dtype=np.float64) / 255
        layer = np.broadcast_to(col, (h, w, 3)).copy()

        # Склоны, обращённые к солнцу, светлее — иначе гора плоская.
        # Знак берётся плавным переходом, а не sign(): резкая смена
        # оставляла на картинке вертикальный шов ровно под солнцем.
        # Производную берём от СГЛАЖЕННОГО профиля. На зубчатом контуре
        # градиент в отдельных точках улетает в сотни, и по картинке идут
        # вертикальные полосы от вершин до самой воды.
        smooth_top = blur(top[None, :], 6.0)[0]
        slope = np.gradient(smooth_top) / max(h * 0.0025, 1e-6)
        slope = np.clip(slope, -1.5, 1.5)
        facing = (1 - 2 * smoothstep(-0.12, 0.12, (xx - sun_x) / w))
        shade = np.clip(0.5 - slope[None, :] * 0.28 * facing, 0.25, 1.0)
        layer = layer * (0.70 + 0.55 * shade)[..., None]

        # Фактура склона: без неё гора остаётся плоской заливкой.
        rock = fbm(h, w, 5, 10, 14, seed_rng=r)
        layer = layer * (0.86 + 0.30 * rock)[..., None]

        if snowy:
            snow_line = top + h * height_f * 0.34
            snow = smoothstep(2.0, -2.0, yy - snow_line[None, :]) * mask
            snow *= smoothstep(0.30, 0.72, fbm(h, w, 4, 3, 10, seed_rng=r))
            # Снег только на высоких вершинах, но переход плавный:
            # жёсткое сравнение резало по горе прямыми вертикалями.
            snow *= smoothstep(0.30, 0.55, prof)[None, :]
            layer = over(layer, np.array(P["snow"]) / 255, snow * 0.85)

        # Воздушная перспектива: чем дальше гряда, тем сильнее она
        # подмешивает цвет дымки и тем мягче её край.
        if haze_amt > 0:
            layer = over(layer, np.array(P["haze"]) / 255, haze_amt * 0.6)

        img = over(img, np.clip(layer, 0, 1), mask)

    # Дымка у самой линии горизонта — свет, застрявший в воздухе над водой.
    hz = np.exp(-np.abs(yy - horizon) / (h * 0.035))
    img = over(img, np.array(P["haze"]) / 255, hz * (0.55 if not night else 0.28))

    # ── море ─────────────────────────────────────────────────────────
    sea = yy >= horizon
    d = np.clip((yy - horizon) / max(h - horizon, 1), 0, 1)     # 0 у горизонта, 1 у зрителя

    sea_col = lerp_color([(0.0, P["sea_far"]), (0.14, P["sea_far"]),
                          (0.55, P["sea_near"]), (1.0, P["sea_near"])], d)

    # ── рябь в перспективе ───────────────────────────────────────────
    #
    # Сумма синусов по экранным координатам не годится: фаза одинакова
    # по всей строке, и через кадр идут ровные дуги — вода читается как
    # вельвет. Настоящая перспектива устроена иначе.
    #
    # Экранная строка соответствует мировой дальности z ~ 1/(y − горизонт).
    # Поэтому текстура воды рисуется один раз в мировых координатах,
    # а на экран берётся выборкой по (z, x·z): у горизонта на строку
    # приходится много текстурных строк — рябь мельчает сама собой,
    # а под ногами растягивается. Гребни при этом остаются короткими
    # и рваными, потому что это шум, а не синус.
    NH, NW = 900, 2048
    # Низкие частоты по X убраны намеренно: длинные пологие складки
    # в перспективе вытягиваются в лучи, сходящиеся к точке схода, и
    # море начинает походить на звёздную вспышку. Гребни должны быть
    # короткими — тогда перспектива читается, а лучей нет.
    water = (fbm(NH, NW, 5, 8, 40, seed_rng=r, tile_x=True) * 0.5
             + fbm(NH, NW, 4, 26, 110, seed_rng=r, tile_x=True) * 0.5)

    z = 1.0 / (d + 0.045)                       # мировая дальность
    zx = (xx / w - 0.5) * z

    # По горизонтали берём остаток от деления, а не обрезаем: у горизонта
    # мировая координата уходит за края текстуры, и обрезка превращала
    # дальнюю воду в однотонную полосу.
    # Сдвиг по дальности дополнительно разрывает радиальную связность:
    # без него все строки выбирают один и тот же столбец текстуры вдоль
    # луча из точки схода.
    drift = z * 137.0

    row = np.clip((z * 26.0).astype(np.int32), 0, NH - 1)
    colx = ((zx * 900.0 + drift).astype(np.int64) % NW).astype(np.int32)
    ripple = water[row, colx] * 2.0 - 1.0

    # Второй слой покрупнее и со сдвигом — зыбь поверх ряби.
    row2 = np.clip((z * 9.0 + 260).astype(np.int32), 0, NH - 1)
    colx2 = ((zx * 260.0 - drift * 0.6).astype(np.int64) % NW).astype(np.int32)
    ripple = ripple * 0.58 + (water[row2, colx2] * 2.0 - 1.0) * 0.42

    # У горизонта рябь физически неразличима — там сплошная полоса.
    ripple *= smoothstep(0.0, 0.16, d)

    sea_col *= (1 + ripple * (0.13 + 0.34 * d))[..., None]

    # Отражение неба. Зеркалит только у горизонта, где луч скользит по
    # поверхности почти параллельно: под ногами вода смотрится тёмной,
    # и без этого спада море превращается в оранжевую простыню.
    refl_src = np.clip(2 * horizon - yy, 0, horizon - 1).astype(int)
    reflection = img[refl_src, xx.astype(int)]
    reflection = reflection * 0.82                       # отражение всегда темнее неба
    refl_amt = np.clip((1 - d) ** 3.0 * 0.50, 0, 1)
    # Рябь рвёт отражение: чем крупнее волна, тем меньше зеркала.
    refl_amt *= np.clip(1 - np.abs(ripple) * 0.55 * d, 0.25, 1.0)
    sea_col = over(sea_col, reflection, refl_amt)

    # ── солнечная дорожка ────────────────────────────────────────────
    # Классический треугольник: у горизонта узкий, к зрителю расходится.
    spread = (0.012 + d ** 1.25 * 0.42) * w
    across = np.abs(xx - sun_x) / spread
    path = np.exp(-across ** 2 * 1.6)

    # Блики — это гребни, повёрнутые к светилу. Берём верхушки ряби
    # и режем порогом: получаются короткие штрихи, а не ровная засветка.
    crest = smoothstep(0.35, 0.85, ripple * 0.5 + 0.5)
    sparkle_noise = fbm(h, w, 5, 10, 26, seed_rng=r)
    sparkle = crest * smoothstep(0.52, 0.78, sparkle_noise) * path
    # Ближе к зрителю блики крупнее, но реже: иначе у нижнего края
    # получается сплошная светящаяся лента вместо отдельных искр.
    sparkle *= (0.45 + 0.75 * d ** 0.5) * (1 - 0.55 * smoothstep(0.62, 1.0, d))
    sea_col = over(sea_col, np.array(P["glitter"]) / 255,
                   np.clip(sparkle * (1.0 if not night else 0.75), 0, 1))
    sea_col = over(sea_col, np.array(P["glitter"]) / 255,
                   path * (0.16 if not night else 0.10) * (1 - d) ** 1.5)

    img = np.where(sea[..., None], sea_col, img)

    # ── берег ────────────────────────────────────────────────────────
    shore_y = h * (0.955 if w >= h else 0.90)
    shore = smoothstep(-2.0, 6.0, yy - shore_y)
    if shore.max() > 0:
        sand = np.broadcast_to(np.array(P["sand"], dtype=np.float64) / 255, (h, w, 3)).copy()
        grain = fbm(h, w, 5, 30, 50, seed_rng=r)
        sand *= (0.82 + 0.36 * grain)[..., None]
        # Мокрый песок у кромки зеркалит небо — узкая яркая полоса.
        wet = np.exp(-np.abs(yy - shore_y) / (h * 0.022)) * shore
        sand = over(sand, np.array(P["haze"]) / 255, wet * 0.5)
        img = over(img, sand, shore)

        # Пена вдоль кромки.
        foam_edge = np.exp(-np.abs(yy - shore_y + h * 0.004) / (h * 0.006))
        foam = foam_edge * smoothstep(0.45, 0.8, fbm(h, w, 4, 6, 40, seed_rng=r))
        img = over(img, np.ones(3) * (0.92 if not night else 0.7),
                   np.clip(foam * 0.5, 0, 1))

    # ── пальмы ───────────────────────────────────────────────────────
    img = draw_palms(img, w, h, horizon, P, night, r)

    # ── постобработка ────────────────────────────────────────────────
    return post(img, w, h, sun_x, sun_y, night)


def splat(mask, cx, cy, rad, amp=1.0):
    """
    Гауссово пятно в маску — только внутри своего окна.

    Считать exp() по всему кадру на каждую точку кисти нельзя: у пальмы
    их полторы тысячи, и рендер уезжал на восемь минут. За тремя сигмами
    вклад всё равно ниже 1/1000, поэтому окном ничего не теряется,
    а время падает на два порядка.
    """
    h, w = mask.shape
    rr = max(rad, 0.4)
    x0, x1 = int(cx - 3 * rr), int(cx + 3 * rr) + 1
    y0, y1 = int(cy - 3 * rr), int(cy + 3 * rr) + 1
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        return
    ys = np.arange(y0, y1)[:, None] - cy
    xs = np.arange(x0, x1)[None, :] - cx
    mask[y0:y1, x0:x1] += amp * np.exp(-(xs ** 2 + ys ** 2) / (2 * rr ** 2))


def draw_palms(img, w, h, horizon, P, night, r):
    """
    Пальмы силуэтом по краям кадра.

    Строятся кистью по точкам, а не кривыми: край получается чуть
    неровным и мягким, как у настоящего листа на просвет. Идеально
    ровный векторный контур — первое, что выдаёт машинную картинку.
    """
    mask = np.zeros((h, w))

    if w >= h:
        palms = [(-0.03, 0.70, 1.0), (0.09, 0.54, -1.0),
                 (1.03, 0.74, -1.0), (0.91, 0.56, 1.0)]
    else:
        palms = [(-0.08, 0.56, 1.0), (1.08, 0.62, -1.0)]

    for px, ph_, lean in palms:
        base_x, base_y = px * w, h * 1.02
        top_y = base_y - ph_ * h
        ts = np.linspace(0, 1, 240)
        trunk_x = base_x + lean * (ts ** 2) * w * 0.05
        trunk_y = base_y - ts * (base_y - top_y)
        rad = (h * 0.0095) * (1 - ts * 0.42)
        for tx, ty, rr in zip(trunk_x, trunk_y, rad):
            splat(mask, tx, ty, rr)

        cx, cy = trunk_x[-1], trunk_y[-1]
        n_fronds = 11
        for i in range(n_fronds):
            ang = np.pi * (0.02 + 0.96 * i / (n_fronds - 1)) + r.uniform(-0.07, 0.07)
            L = ph_ * h * r.uniform(0.40, 0.58)
            fs = np.linspace(0, 1, 90)
            # Лист провисает под своим весом — отсюда парабола по вертикали.
            fx = cx - np.cos(ang) * L * fs * lean
            fy = cy - np.sin(ang) * L * fs + (fs ** 2) * L * 0.72
            # Черешок тонкий: перо, а не лопата.
            spine = (h * 0.0032) * (1 - fs * 0.6) + h * 0.0009
            for tx, ty, rr in zip(fx, fy, spine):
                splat(mask, tx, ty, rr)

            # Сегменты пера по обе стороны черешка.
            step = max(2, len(fs) // 26)
            for k in range(6, len(fs) - 2, step):
                dx, dy = fx[k] - fx[k - 2], fy[k] - fy[k - 2]
                nlen = np.hypot(dx, dy) or 1
                nx, ny = -dy / nlen, dx / nlen
                seg = h * 0.030 * (1 - fs[k]) ** 0.55 * r.uniform(0.75, 1.05)
                for side in (1, -1):
                    for s in np.linspace(0.12, 1.0, 7):
                        splat(mask,
                              fx[k] + nx * seg * s * side + dx * s * 1.6,
                              fy[k] + ny * seg * s * side + dy * s * 1.6 + seg * s * 0.35,
                              h * 0.0026 * (1 - s * 0.5))

    mask = np.clip(mask, 0, 1) ** 0.55
    mask = blur(mask, 0.7)
    col = np.array(P["palm"], dtype=np.float64) / 255
    out = over(img, np.broadcast_to(col, (h, w, 3)), mask * 0.96)

    # Контровой ободок: солнце за пальмой пробивает край листа.
    rim = np.clip(blur(mask, 2.5) - mask, 0, 1)
    out = over(out, np.array(P["sun_glow"]) / 255, rim * (0.6 if not night else 0.25))
    return out


def post(img, w, h, sun_x, sun_y, night):
    """Свечение, виньетка, зерно — то, что превращает рендер в картинку."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)

    # Свечение: яркие места «протекают» в соседние. Так работает и плёнка,
    # и объектив, и глаз — без этого закат выглядит наклейкой.
    lum = img @ np.array([0.299, 0.587, 0.114])
    bright = np.clip(lum - 0.62, 0, 1) ** 1.5
    bloom = np.zeros_like(img)
    for radius, weight in ((h * 0.010, 0.5), (h * 0.035, 0.32), (h * 0.09, 0.22)):
        b = blur(bright, radius)
        bloom += (img * b[..., None]) * weight
    img = np.clip(img + bloom * (0.85 if not night else 0.6), 0, 1)

    # Тёплое смещение к светилу: рассеяние в атмосфере окрашивает
    # всё вокруг источника, а не только сам источник.
    dist = np.sqrt((xx - sun_x) ** 2 + (yy - sun_y) ** 2) / (h * 1.2)
    warmth = np.exp(-dist * 2.2)
    tint = np.array([1.06, 1.00, 0.94]) if not night else np.array([0.96, 1.00, 1.08])
    img *= (1 + (tint - 1)[None, None, :] * warmth[..., None] * 1.4)

    # Виньетка
    r2 = ((xx / w - 0.5) ** 2 + (yy / h - 0.5) ** 2) * 4
    img *= (1 - 0.34 * np.clip(r2, 0, 1) ** 1.4)[..., None]

    # Игровое поле лежит по центру, и текст на нём должен читаться.
    # Лёгкое затемнение середины стоит дешевле, чем плашка под барабанами.
    center = np.exp(-(((xx / w - 0.5) / 0.42) ** 2 + ((yy / h - 0.46) / 0.40) ** 2))
    img *= (1 - 0.13 * center)[..., None]

    img = np.clip(img, 0, 1)

    # Мягкий контраст: S-кривая вместо линейного растяжения.
    img = np.clip(img * 1.04 - 0.012, 0, 1)
    img = img ** 1.02

    # Зерно. Цветное и мелкое — идеально гладкий градиент выдаёт
    # машинную природу картинки сильнее любой другой детали.
    grain = rng.normal(0, 1, (h, w, 3)) * 0.0075
    grain += rng.normal(0, 1, (h, w, 1)) * 0.0075
    img = np.clip(img + grain * (0.6 + 0.8 * (1 - img)), 0, 1)

    return (img * 255).astype(np.uint8)


# ──────────────────────────── экспорт ─────────────────────────────────

SCENES = [
    ("bg_landscape", 1920, 1080, False, 11),
    ("bg_landscape_free", 1920, 1080, True, 11),
    ("bg_portrait", 1080, 1920, False, 23),
    ("bg_portrait_free", 1080, 1920, True, 23),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, w, h, night, seed in SCENES:
        print(f"→ {name} {w}×{h} {'ночь' if night else 'закат'}")
        px = render(w, h, night=night, seed=seed)
        # WebP, а не PNG: у картинки плёночное зерно, и PNG на нём
        # бессилен — каждый пиксель отличается от соседа. В PNG эти
        # четыре файла занимали тринадцать мегабайт исходников.
        path = os.path.join(OUT, f"{name}.webp")
        Image.fromarray(px).save(path, quality=95, method=6)
        print(f"   {os.path.getsize(path) / 1024:.0f} КБ")
    print(f"✓ фоны отрисованы в {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
