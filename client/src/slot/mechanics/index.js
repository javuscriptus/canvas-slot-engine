// Реестр механик.
//
// Механика — это ответ на два вопроса: как из экрана получить выигрыши
// и как их показывать. Всё остальное (барабаны, панель, показ суммы,
// баннеры) от неё не зависит и правки при добавлении новой не требует.
//
// Выбор идёт по config.mechanic с сервера, а не по сборке: клиент один
// на все игры, а игр на нём может быть несколько.

import { mechanic as lines } from "./lines.js";
import { mechanic as tumble } from "./tumble.js";

const MECHANICS = new Map([
  [lines.id, lines],
  [tumble.id, tumble]
]);

/**
 * Механика для этой конфигурации.
 *
 * Неизвестное имя — это отказ на старте, а не молчаливый откат к линиям:
 * игра, которая считает не тем способом, каким считает сервер, покажет
 * игроку не тот результат. Такое лучше увидеть на первом же запуске.
 */
export function resolveMechanic(config) {
  const id = config.mechanic || lines.id;
  const found = MECHANICS.get(id);
  if (!found) {
    throw new Error(
      `Неизвестная механика «${id}». Известные: ${[...MECHANICS.keys()].join(", ")}`
    );
  }
  return found;
}

export { lines, tumble, MECHANICS };
