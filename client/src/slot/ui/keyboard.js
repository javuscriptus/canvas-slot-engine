// Клавиатура: раскладка горячих клавиш слота.
//
// Отдельным модулем, потому что это именно раскладка — таблица «клавиша →
// действие», и меняют её как таблицу. В сборке игры она была вкраплена
// между тряской камеры и фоновым звуком, и найти, чем занят пробел,
// можно было только чтением всего файла.
//
// Пробел и Enter — крутить, они же «Стоп» во время вращения: так устроены
// все слоты, и игрок пробует именно их.

/**
 * @param actions { spin, stop, isSpinning, betUp, betDown,
 *                  toggleSound, toggleTurbo, closeOverlays }
 * @returns функция отписки
 */
export function bindKeyboard(actions, target = window) {
  const onKeyDown = (e) => {
    // Зажатая клавиша не должна превращаться в очередь спинов.
    if (e.repeat) return;

    switch (e.code) {
      case "Space":
      case "Enter":
        e.preventDefault();
        if (actions.isSpinning()) actions.stop();
        else actions.spin();
        break;
      case "ArrowUp": actions.betUp(); break;
      case "ArrowDown": actions.betDown(); break;
      case "KeyM": actions.toggleSound(); break;
      case "KeyT": actions.toggleTurbo(); break;
      case "Escape": actions.closeOverlays(); break;
    }
  };

  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
