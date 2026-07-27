// Границы слоёв: зависимости идут только вниз.
//
//   engine/  не знает ни про слот, ни про тему
//   slot/    не знает про тему — она приходит параметром
//   themes/  не знает про другие темы
//
// Договорённость, которую никто не проверяет, живёт около месяца. Этот тест
// разбирает импорты и падает на первом же нарушении — с именем файла и
// строкой, а не с рассуждением о чистоте архитектуры.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");

/** Все .js в каталоге, рекурсивно. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Пути, на которые ссылается модуль: import и динамический import(). */
function importsOf(file) {
  const code = fs.readFileSync(file, "utf8");
  const out = [];
  const re = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1] || m[2]);
  return out;
}

/** Куда указывает относительный путь — в engine, slot, themes или наружу. */
function layerOf(file) {
  const rel = path.relative(SRC, file).split(path.sep);
  return rel[0];
}

function resolved(file, spec) {
  if (!spec.startsWith(".")) return null;   // внешних зависимостей в бою нет
  return path.resolve(path.dirname(file), spec);
}

const FILES = walk(SRC);

test("в клиенте нет внешних зависимостей", () => {
  const bad = [];
  for (const file of FILES) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        bad.push(`${path.relative(SRC, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, [], `голый импорт означает сборщик или node_modules:\n${bad.join("\n")}`);
});

test("engine не знает ни про слот, ни про тему", () => {
  const bad = [];
  for (const file of FILES.filter((f) => layerOf(f) === "engine")) {
    for (const spec of importsOf(file)) {
      const target = resolved(file, spec);
      if (!target) continue;
      const layer = layerOf(target);
      if (layer === "slot" || layer === "themes") {
        bad.push(`${path.relative(SRC, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, [], `движок обязан работать без этой игры:\n${bad.join("\n")}`);
});

test("slot не импортирует тему — она приходит параметром", () => {
  const bad = [];
  for (const file of FILES.filter((f) => layerOf(f) === "slot")) {
    for (const spec of importsOf(file)) {
      const target = resolved(file, spec);
      if (target && layerOf(target) === "themes") {
        bad.push(`${path.relative(SRC, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, [], `тема обязана подставляться, а не импортироваться:\n${bad.join("\n")}`);
});

test("одна тема не тянет другую", () => {
  const bad = [];
  for (const file of FILES.filter((f) => layerOf(f) === "themes")) {
    const own = path.relative(SRC, file).split(path.sep)[1];
    for (const spec of importsOf(file)) {
      const target = resolved(file, spec);
      if (!target || layerOf(target) !== "themes") continue;
      const other = path.relative(SRC, target).split(path.sep)[1];
      if (other !== own) bad.push(`${path.relative(SRC, file)} → ${spec}`);
    }
  }
  assert.deepEqual(bad, [], `темы независимы:\n${bad.join("\n")}`);
});

test("ни в игре, ни в теме не осталось прямой отрисовки на Canvas2D", () => {
  // ctx живёт только в engine/render/ и в подготовке текстур. Всё, что выше,
  // описывает узлы; чем их рисовать, решает бэкенд — иначе смена рендерера
  // означает переписывание игры. Тема попала под то же правило после того,
  // как последний Custom (фон) уехал в движок отдельным типом узла.
  const bad = [];
  for (const file of FILES.filter((f) => layerOf(f) === "slot" || layerOf(f) === "themes")) {
    if (/\bctx\.[a-zA-Z]/.test(strip(file)) || /\bnew Custom\b/.test(strip(file))) {
      bad.push(path.relative(SRC, file));
    }
  }
  assert.deepEqual(bad, [], `узел вместо ctx:\n${bad.join("\n")}`);
});

/**
 * Файлы, которым разрешено содержать цвета и шрифты вне темы.
 *
 * engine/debug.js рисует панель диагностики элементом DOM поверх игры.
 * Это инструмент разработчика, он не участвует в кадре и обязан быть
 * читаемым независимо от того, какая тема подключена, — красить его
 * из палитры игры значит однажды получить чёрные цифры на чёрном фоне
 * ровно тогда, когда они нужнее всего.
 */
const COSMETICS_ALLOWED = ["engine/debug.js"];

test("оформление не протекает в движок и в слот", () => {
  // Цвет, гарнитура и имя кадра — три вещи, которые обязаны жить в теме.
  // Пока они разбросаны по коду, вторая тема невозможна: её пришлось бы
  // выпускать правкой четырнадцати файлов интерфейса.
  const probes = [
    ["цвет", /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/],
    ["шрифт", /\d+px\s+[A-Za-z"']/],
    // Имя кадра или звука ищется по месту употребления, а не по виду
    // строки: «lobby_origin» — это параметр URL, а не картинка, и
    // отличить их можно только по тому, кому строку передают.
    ["имя кадра или звука", /\.(?:frame|has|play|playMusic|stopMusic)\s*\(\s*["']/]
  ];
  const bad = [];
  for (const file of FILES) {
    const layer = layerOf(file);
    if (layer !== "engine" && layer !== "slot") continue;
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (COSMETICS_ALLOWED.includes(rel)) continue;
    const code = strip(file);
    for (const [what, re] of probes) {
      const m = code.match(re);
      if (m) bad.push(`${rel}: ${what} — ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], `это принадлежит теме:\n${bad.join("\n")}`);
});

/** Исходник без комментариев: они описывают решения, а не задают их. */
function strip(file) {
  return fs.readFileSync(file, "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

test("размер сетки нигде не зашит числом", () => {
  // 5×3 приходит с сервера в config.reels и config.rows. Раньше пятёрка
  // и тройка были вписаны в восьми местах барабанов и дважды в разборе
  // раунда — и «сделать 6×5» означало найти их все.
  const suspicious = [];
  const re = /\b(reels|rows|reelCount|rowCount)\s*[=:]\s*([0-9]+)/g;
  for (const file of FILES.filter((f) => layerOf(f) === "slot")) {
    const code = fs.readFileSync(file, "utf8");
    let m;
    while ((m = re.exec(code))) {
      suspicious.push(`${path.relative(SRC, file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(suspicious, [], `размер сетки берётся из конфигурации:\n${suspicious.join("\n")}`);
});
