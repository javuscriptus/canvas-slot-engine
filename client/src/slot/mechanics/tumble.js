// Каскад и выплаты за скопления.
//
// Вторая механика существует не «на будущее», а чтобы проверить границу:
// если для другого способа считать выигрыш пришлось бы править барабаны,
// показ выигрыша или UI — значит, механика не выделена, а размазана.
// Здесь она — модуль с тремя функциями, и включается конфигом сервера.
//
// Математика для неё НЕ посчитана: сервер отдаёт mechanic: "lines", и
// в бою этот файл не исполняется. Реализован он целиком — от поиска
// скоплений до схлопывания поля, — потому что заглушка не доказывает
// ничего, а рабочий код доказывает, что контракт механики достаточен.
//
// Правила: выигрывает скопление из minCluster и более одинаковых символов,
// связанных по стороне (не по диагонали). Дикий входит в любое скопление.
// Выигравшие ячейки исчезают, верхние падают вниз, сверху досыпаются
// новые — и подсчёт повторяется, пока скопления не кончатся.

export const mechanic = {
  id: "tumble",

  /** Показывать каскадом: подсветка — схлопывание — досыпка — снова. */
  presentation: "cascade",

  /**
   * @param {number[][]} screen матрица [ряд][барабан]
   * @param {number} bet        полная ставка за спин
   * @param {object} config     публичная конфигурация с сервера
   */
  evaluate(screen, bet, config) {
    const min = config.cluster?.min ?? 5;
    const pays = config.cluster?.pays || config.paytable;
    const seen = new Set();
    const wins = [];
    let total = 0;

    for (let row = 0; row < config.rows; row++) {
      for (let reel = 0; reel < config.reels; reel++) {
        const key = `${reel}:${row}`;
        if (seen.has(key)) continue;
        const symbol = screen[row][reel];
        if (symbol === config.wild || symbol === config.scatter) continue;

        const positions = flood(screen, reel, row, symbol, config, seen);
        if (positions.length < min) continue;

        // Тариф ищется по точному размеру скопления, а если его нет —
        // по ближайшему меньшему: таблицы обычно задают ступени
        // (5, 8, 10+), а не каждое значение подряд.
        const payout = payoutFor(pays[symbol], positions.length);
        if (payout <= 0) continue;

        const amount = round2(bet * payout);
        total += amount;
        wins.push({
          type: "cluster",
          symbol,
          count: positions.length,
          payout,
          multiplier: 1,
          amount,
          positions
        });
      }
    }

    return { wins, total: round2(total) };
  },

  /**
   * Схлопывание: выигравшие ячейки убираются, оставшиеся падают вниз,
   * сверху досыпается новое.
   *
   * @param {function} nextSymbol (reel) => id — источник новых символов.
   *   Его даёт сервер вместе с результатом: придумывать символы самому
   *   клиент не вправе, иначе показ разойдётся с оплаченным экраном.
   */
  collapse(screen, wins, nextSymbol, config) {
    const dead = new Set();
    for (const w of wins) {
      for (const p of w.positions) dead.add(`${p.reel}:${p.row}`);
    }

    const next = Array.from({ length: config.rows }, () => new Array(config.reels));

    for (let reel = 0; reel < config.reels; reel++) {
      // Собираем колонку снизу вверх из уцелевших, недостаток добираем сверху.
      const kept = [];
      for (let row = config.rows - 1; row >= 0; row--) {
        if (!dead.has(`${reel}:${row}`)) kept.push(screen[row][reel]);
      }
      for (let row = config.rows - 1, i = 0; row >= 0; row--, i++) {
        next[row][reel] = i < kept.length ? kept[i] : nextSymbol(reel);
      }
    }
    return next;
  }
};

/** Скопление, связанное по стороне. Обход итеративный: рекурсия на 6×5 не нужна. */
function flood(screen, reel0, row0, symbol, config, seen) {
  const out = [];
  const stack = [[reel0, row0]];
  const local = new Set();

  while (stack.length) {
    const [reel, row] = stack.pop();
    if (reel < 0 || row < 0 || reel >= config.reels || row >= config.rows) continue;
    const key = `${reel}:${row}`;
    if (local.has(key)) continue;
    const s = screen[row][reel];
    if (s !== symbol && s !== config.wild) continue;

    local.add(key);
    out.push({ reel, row });
    stack.push([reel + 1, row], [reel - 1, row], [reel, row + 1], [reel, row - 1]);
  }

  // Дикие не помечаются пройденными: один и тот же дикий вправе
  // достроить сразу несколько соседних скоплений.
  for (const p of out) {
    if (screen[p.row][p.reel] !== config.wild) seen.add(`${p.reel}:${p.row}`);
  }
  return out;
}

function payoutFor(table, size) {
  if (!table) return 0;
  let best = 0;
  for (const key of Object.keys(table)) {
    const n = Number(key);
    if (n <= size && n >= 0) best = Math.max(best, table[key]);
  }
  return best;
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
