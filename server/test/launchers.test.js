// Проверка Windows-запускалок.
//
// Тест выглядит мелочью, но появился он после боевой поломки: скрипт
// массового переименования перезаписал start.bat с Unix-переводами строк.
// cmd.exe читает bat-файл как поток байт и при одних только LF склеивает
// команды в мусор — окно закрывалось мгновенно, не показав ни строчки.
//
// Отладить такое тяжело именно потому, что сообщения об ошибке нет вообще,
// а на Linux и в редакторе файл выглядит совершенно нормально. Поэтому
// проверяем машинно.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const LAUNCHERS = ["start.bat", "check-math.bat"];

for (const name of LAUNCHERS) {
  test(`${name}: переводы строк CRLF`, () => {
    const raw = fs.readFileSync(path.join(ROOT, name));
    const text = raw.toString("utf8");

    const lf = (text.match(/\n/g) || []).length;
    const crlf = (text.match(/\r\n/g) || []).length;

    assert.ok(lf > 0, "файл пуст");
    assert.equal(crlf, lf,
      `${lf - crlf} строк без CR. cmd.exe такой файл не разберёт: ` +
      `окно закроется мгновенно и без сообщения`);
  });

  test(`${name}: UTF-8 без BOM и с переключением кодовой страницы`, () => {
    const raw = fs.readFileSync(path.join(ROOT, name));

    // BOM перед @echo off попадает в вывод и ломает первую команду.
    assert.notEqual(raw[0], 0xef, "в начале файла BOM");

    const text = raw.toString("utf8");
    assert.ok(/^@echo off/.test(text), "файл не начинается с @echo off");

    // В скриптах есть кириллица, поэтому кодовая страница обязана
    // переключаться раньше первой печатающей команды — иначе вместо
    // текста кракозябры. `@echo off` не в счёт: он ничего не выводит.
    const lines = text.split(/\r?\n/);
    const chcpLine = lines.findIndex((l) => l.includes("chcp 65001"));
    const printLine = lines.findIndex((l) => /^\s*(echo|title)\b/i.test(l.trim()));

    assert.ok(chcpLine >= 0, "нет chcp 65001");
    assert.ok(chcpLine < printLine,
      `chcp 65001 (строка ${chcpLine + 1}) идёт после первой печатающей ` +
      `команды (строка ${printLine + 1})`);
  });

  test(`${name}: любой путь завершается паузой`, () => {
    const text = fs.readFileSync(path.join(ROOT, name), "utf8");
    // Молча закрывшееся окно — худший вид отказа: пользователь не видит
    // ни причины, ни того, что вообще что-то запускалось.
    assert.ok(/\npause\r?\n/.test(text) || /\npause\r?$/.test(text),
      "нет pause: окно закроется, не показав ошибку");
    assert.ok(!/\nexit \/b \d/.test(text),
      "выход через exit /b в обход pause прячет сообщение об ошибке");
  });
}
