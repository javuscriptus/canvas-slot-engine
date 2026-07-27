// Полнота и сменяемость тем.
//
// Тема — контракт, и проверяется он ровно тем же кодом, которым игра
// проверяет её при старте: slot/theme/validate.js. Разница только в том,
// что здесь проверяются ВСЕ темы каталога сразу и без браузера, поэтому
// неполная вторая тема ловится до того, как кто-то откроет ?theme=…
//
// Второй тест — про сменяемость. Мало объявить, что оформление вынесено:
// две темы обязаны РАЗЛИЧАТЬСЯ. Если новая тема окажется копией старой
// с другим id, разделение слоёв не доказано ничем.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const ASSETS = path.join(ROOT, "assets");

const load = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);

/** Все кадры, которые реально есть в собранных ассетах. */
function frameNames() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, "manifest.json"), "utf8"));
  const names = new Set(Object.keys(manifest.images || {}));
  for (const atlas of Object.values(manifest.atlases || {})) {
    const json = JSON.parse(fs.readFileSync(path.join(ASSETS, atlas.json), "utf8"));
    for (const key of Object.keys(json.frames || {})) names.add(key);
  }
  return names;
}

/** Заглушка хранилища ассетов: проверке нужны только имена кадров. */
function storeStub() {
  const names = frameNames();
  return { has: (name) => names.has(name), frame: (name) => ({ name, x: 0, y: 0, w: 1, h: 1 }) };
}

const THEMES = fs.readdirSync(path.join(SRC, "themes"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

test("темы в каталоге вообще есть, и их больше одной", () => {
  // Одна тема ничего не доказывает: слой, у которого единственная
  // реализация, всегда «работает».
  assert.ok(THEMES.length >= 2, `тем найдено: ${THEMES.join(", ") || "нет"}`);
});

for (const name of THEMES) {
  test(`тема «${name}» полна по контракту`, async () => {
    const { validateTheme } = await load("slot/theme/validate.js");
    const theme = (await load(`themes/${name}/theme.js`)).default;
    // Не бросило — значит есть всё: цвета, роли надписей, длительности,
    // кадры, звуки, раскладка, тексты и обе фабрики сцены.
    validateTheme(theme, storeStub());
    assert.equal(theme.id, name, "id темы обязан совпадать с именем каталога");
  });

  test(`тема «${name}» строит обе раскладки`, async () => {
    const theme = (await load(`themes/${name}/theme.js`)).default;
    const size = { reels: 5, rows: 3 };
    for (const [vw, vh, expected] of [[1920, 1080, "landscape"], [390, 844, "portrait"]]) {
      const layout = theme.layout.build(vw, vh, size);
      assert.equal(layout.name, expected);
      // Ключи, без которых панель управления не разложится. Их отсутствие
      // иначе всплывает как «кнопка в углу экрана», а не как ошибка.
      for (const key of ["width", "height", "cell", "grid", "panel", "meters",
                         "spinButton", "betButtons", "sideButtons", "topButtons",
                         "logo", "freeSpinBadge", "background", "backgroundFree"]) {
        assert.ok(layout[key] !== undefined, `${name}/${expected}: нет layout.${key}`);
      }
      assert.ok(layout.cell > 0 && layout.width > 0 && layout.height > 0);
    }
  });
}

test("темы действительно разные, а не копии с другим id", async () => {
  const loaded = [];
  for (const name of THEMES) loaded.push((await load(`themes/${name}/theme.js`)).default);

  const differs = (get, what) => {
    const seen = new Set(loaded.map((t) => JSON.stringify(get(t))));
    assert.equal(seen.size, loaded.length, `${what}: у тем совпадает`);
  };

  differs((t) => t.palette, "палитра");
  differs((t) => [t.fonts.family, t.fonts.numeric], "гарнитуры");
  differs((t) => t.timings, "длительности");
  differs((t) => t.strings.ru, "тексты");
  differs((t) => t.title, "название");
});

test("вторая тема не потребовала знаний о себе ни в движке, ни в слоте", () => {
  // Самая дешёвая и самая надёжная проверка сменяемости: имя темы не
  // должно встречаться нигде, кроме её собственного каталога и реестра
  // в main.js. Стоит слоту один раз спросить «а это у нас неон?» —
  // и третья тема начнётся с правки слота.
  const bad = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  const files = [];
  walk(path.join(SRC, "engine"));
  walk(path.join(SRC, "slot"));

  for (const file of files) {
    const code = fs.readFileSync(file, "utf8").toLowerCase();
    for (const name of THEMES) {
      if (code.includes(`"${name}"`) || code.includes(`'${name}'`)) {
        bad.push(`${path.relative(SRC, file)} упоминает тему «${name}»`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});
