// Бэкенды рендера: у каждого типа узла должен быть отрисовщик.
//
// Тест ловит ровно один класс ошибок, зато самый неприятный: в игре завели
// новый тип узла, зарегистрировали его в Canvas2D и забыли в WebGL2 —
// на одном бэкенде картинка есть, на другом её молча нет. Реестр знает
// про все типы, поэтому проверка сводится к сравнению списков.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SRC = path.join(__dirname, "..", "src");
const load = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);

/** Бэкенды, которые обязаны уметь всё. Появится WebGL2 — добавится сюда. */
const BACKENDS = ["canvas2d"];

test("каждый зарегистрированный тип узла умеет рисоваться всеми бэкендами", async () => {
  const { NodeType, missingDrawables, hasDrawable } = await load("engine/render/drawables.js");
  // Импорт бэкенда — это и есть регистрация его отрисовщиков.
  await load("engine/render/backend-canvas2d.js");

  for (const id of BACKENDS) {
    const missing = missingDrawables(id).filter((t) => t !== NodeType.CONTAINER);
    assert.deepEqual(missing, [],
      `бэкенд ${id} не умеет рисовать: ${missing.join(", ")}`);
  }

  // Контейнер отрисовщика не имеет и иметь не должен: рендер обходит его
  // детей сам, не спрашивая бэкенд.
  assert.equal(hasDrawable(NodeType.CONTAINER, "canvas2d"), false);
});

test("узлы графа сцены объявляют тип, который есть в реестре", async () => {
  const display = await load("engine/display.js");
  const { drawableFor, NodeType } = await load("engine/render/drawables.js");
  await load("engine/render/backend-canvas2d.js");

  // Значения по умолчанию: конструкторы узлов не должны требовать
  // ни DOM, ни загруженных картинок.
  const frame = { image: {}, x: 0, y: 0, w: 4, h: 4 };
  const nodes = [
    new display.Sprite(frame, 1),
    new display.NineSlice(frame, [1, 1, 1, 1], 1),
    new display.Text("x", { font: "600 12px serif", fill: "#000" }),
    new display.Rect(1, 1, "#000"),
    new display.Shape([]),
    new display.SpriteBatch(1, 1),
    new display.CoverImage({ has: () => false, frame: () => frame }, 1, 1),
    new display.Custom(() => {}, 1, 1)
  ];

  for (const node of nodes) {
    assert.ok(node.nodeType, `у узла ${node.constructor.name} не задан nodeType`);
    assert.ok(drawableFor(node.nodeType),
      `тип ${node.nodeType} не зарегистрирован ни одним бэкендом`);
  }
  assert.equal(new display.Container().nodeType, NodeType.CONTAINER);
});

test("новый тип узла подключается регистрацией, а не правкой рендера", async () => {
  const { register, drawableFor, hasDrawable } = await load("engine/render/drawables.js");

  register("тест:звезда", { canvas2d() {} });
  assert.ok(hasDrawable("тест:звезда", "canvas2d"));

  // Реализации разных бэкендов складываются в одну запись, не затирая
  // друг друга: WebGL2 дописывается из своего файла.
  register("тест:звезда", { webgl2() {} });
  const entry = drawableFor("тест:звезда");
  assert.ok(entry.canvas2d && entry.webgl2);
});
