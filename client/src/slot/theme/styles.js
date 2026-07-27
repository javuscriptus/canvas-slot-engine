// Разрешение именованного стиля текста в стиль узла Text.
//
// Слот не собирает строки шрифтов и не знает названий цветов. Он называет
// РОЛЬ надписи — «значение счётчика», «сумма на баннере», «подсказка в
// списке истории», — а как эта роль выглядит, решает тема. До этого в
// игровом слое лежало двадцать семь шаблонов вида `700 ${size}px ${family}`
// вперемешку с палитрой: сменить гарнитуру означало пройти четырнадцать
// файлов, а сменить тему — не означало ничего, потому что размеры и обводки
// были вписаны в код.
//
// Цвета в описании роли — это КЛЮЧИ палитры, а не литералы. Неизвестный
// ключ — ошибка темы, и она обязана быть громкой: подставить вместо цвета
// строку «textDim» значит получить чёрный текст на чёрном фоне и полдня
// поисков. Полнота ролей и ключей проверяется slot/theme/validate.js
// до сборки сцены.

/** Цвет по ключу палитры. Градиент — это массив стопов, он проходит как есть. */
function color(theme, key, where) {
  const value = theme.palette?.[key];
  if (value === undefined) {
    throw new Error(`Тема «${theme.id}»: в палитре нет цвета «${key}» (${where})`);
  }
  return value;
}

/**
 * @param theme  тема целиком
 * @param role   имя роли из theme.fonts.roles
 * @param scale  множитель кегля: заставка и таблица выплат тянут текст
 *               вместе с композицией, и держать для каждого масштаба
 *               отдельную роль бессмысленно
 * @returns стиль для конструктора Text
 */
export function textStyle(theme, role, scale = 1) {
  const spec = theme.fonts?.roles?.[role];
  if (!spec) throw new Error(`Тема «${theme.id}»: нет роли текста «${role}»`);

  const family = theme.fonts[spec.family || "family"];
  if (!family) {
    throw new Error(`Тема «${theme.id}»: роль «${role}» просит гарнитуру «${spec.family}»`);
  }

  const size = Math.max(1, Math.round(spec.size * scale));
  const style = {
    font: `${spec.weight ?? 600} ${size}px ${family}`,
    align: spec.align || "left"
  };

  if (spec.gradient) style.gradient = color(theme, spec.gradient, `роль ${role}`);
  else style.fill = color(theme, spec.fill || "text", `роль ${role}`);

  if (spec.stroke) {
    style.stroke = color(theme, spec.stroke, `роль ${role}`);
    style.strokeWidth = Math.max(1, Math.round((spec.strokeWidth || 2) * scale));
  }
  if (spec.letterSpacing) style.letterSpacing = spec.letterSpacing * scale;
  if (spec.lineHeight) style.lineHeight = spec.lineHeight * scale;
  if (spec.shadow) {
    style.shadow = {
      color: color(theme, spec.shadow.color, `тень роли ${role}`),
      blur: (spec.shadow.blur || 0) * scale,
      x: (spec.shadow.x || 0) * scale,
      y: (spec.shadow.y || 0) * scale
    };
  }
  return style;
}

/**
 * То же, но для setStyle() уже созданного узла: при смене раскладки
 * меняются кегль и толщина обводки, а текст и якорь остаются.
 */
export function applyTextStyle(node, theme, role, scale = 1) {
  node.setStyle(textStyle(theme, role, scale));
  return node;
}
