// Реестр отрисовщиков: узел объявляет свой ТИП, бэкенд регистрирует,
// как этот тип рисовать.
//
// Раньше на этом месте была цепочка instanceof внутри рендера. Стоило это
// того, что новый тип узла нельзя было добавить, не правя движок: любой
// эффект игры упирался в чужой файл. Теперь узел — это строка в nodeType
// плюс register(), и ни рендер, ни бэкенд о нём заранее не знают.
//
// Реестр намеренно не импортирует ничего: и display.js, и любой бэкенд
// зависят от него, а он — ни от кого. Иначе получился бы цикл импортов.

/**
 * Словарь типов узлов. Значения — обычные строки, поэтому игра вправе
 * завести свой тип, не трогая этот файл: достаточно совпадения строки
 * в node.nodeType и в register().
 */
export const NodeType = {
  CONTAINER: "container",
  SPRITE: "sprite",
  ANIMATED_SPRITE: "animatedSprite",
  SPRITE_BATCH: "spriteBatch",
  NINE_SLICE: "nineSlice",
  TEXT: "text",
  RECT: "rect",
  SHAPE: "shape",
  COVER: "cover",
  CUSTOM: "custom",
  PARTICLES: "particles"
};

const REGISTRY = new Map();

/**
 * Регистрирует отрисовщики одного типа узла.
 *
 * @param {string} type   значение node.nodeType
 * @param {object} impls  { [id бэкенда]: (surface, node, backend) => void }
 *
 * Реализации разных бэкендов складываются в ОДНУ запись, а не заменяют
 * друг друга: WebGL2 подключается к уже описанному типу отдельным вызовом
 * из своего файла, и Canvas2D об этом не узнаёт.
 *
 * `surface` — то, чем бэкенд рисует: для Canvas2D это готовый ctx с уже
 * выставленной матрицей и альфой узла, для WebGL2 — батчер.
 */
export function register(type, impls) {
  const entry = REGISTRY.get(type) || {};
  Object.assign(entry, impls);
  REGISTRY.set(type, entry);
  return entry;
}

/** Запись реестра целиком; null, если тип не зарегистрирован. */
export function drawableFor(type) {
  return REGISTRY.get(type) || null;
}

/** Умеет ли конкретный бэкенд рисовать этот тип. */
export function hasDrawable(type, backendId) {
  const entry = REGISTRY.get(type);
  return !!(entry && entry[backendId]);
}

/**
 * Типы, которые бэкенд рисовать не умеет. Нужно ровно для теста
 * `backends.test.js`: он обязан падать, когда новый узел появился
 * в игре, но не появился в одном из бэкендов.
 */
export function missingDrawables(backendId) {
  const out = [];
  for (const [type, entry] of REGISTRY) {
    if (!entry[backendId]) out.push(type);
  }
  return out;
}
