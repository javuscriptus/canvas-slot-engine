// Выплаты по линиям: 20 фиксированных линий, слева направо, с диким.
//
// Тот же расчёт живёт на сервере и является источником истины. Здесь он
// нужен ровно для одного: сверить присланный итог с тем, что видно на
// экране. Расхождение означает, что игроку показали не тот результат,
// за который ему заплатили, — это дефект, который обязан быть виден
// в логе, а не всплыть через месяц в жалобе.
//
// Деньги отсюда не берутся никогда: на счётчики идёт сумма сервера.

export const mechanic = {
  id: "lines",

  /** Показывать по одной комбинации за раз, перебором. */
  presentation: "sequential",

  /**
   * @param {number[][]} screen матрица [ряд][барабан]
   * @param {number} bet        полная ставка за спин
   * @param {object} config     публичная конфигурация с сервера
   * @returns {{wins: object[], total: number}}
   */
  evaluate(screen, bet, config) {
    const lineBet = bet / config.paylines.length;
    const wins = [];
    let total = 0;

    // Платящие символы — те, у кого есть строка в таблице выплат.
    // Отдельным списком их присылать незачем: он выводится из неё.
    const paying = Object.keys(config.paytable).map(Number);

    for (let li = 0; li < config.paylines.length; li++) {
      const pattern = config.paylines[li];
      const res = bestOnLine(screen, pattern, paying, config);
      if (!res) continue;

      const amount = round2(lineBet * res.payout);
      total += amount;

      const positions = [];
      for (let r = 0; r < res.count; r++) positions.push({ reel: r, row: pattern[r] });

      wins.push({
        type: "line",
        line: li,
        symbol: res.symbol,
        count: res.count,
        payout: res.payout,
        multiplier: 1,
        amount,
        positions
      });
    }

    const scatter = scatterPositions(screen, config);
    if (scatter.length >= config.freespins.triggerScatters) {
      const pay = config.scatterPays[Math.min(scatter.length, config.reels)] || 0;
      if (pay > 0) {
        const amount = round2(bet * pay);
        total += amount;
        wins.push({
          type: "scatter",
          symbol: config.scatter,
          count: scatter.length,
          payout: pay,
          multiplier: 1,
          amount,
          positions: scatter
        });
      }
    }

    return { wins, total: round2(total) };
  }
};

/**
 * Лучшая комбинация на линии.
 *
 * Перебираются все платящие символы: для каждого считается длина префикса
 * из этого символа и диких. Такой перебор сам решает две неочевидные
 * ситуации — линию, начинающуюся с диких (она платит по лучшему из
 * возможных символов), и случай, когда «дикий + низкий символ» выгоднее
 * короткой комбинации премиального.
 */
function bestOnLine(screen, pattern, paying, config) {
  let best = null;

  for (const sym of paying) {
    let count = 0;
    for (let r = 0; r < config.reels; r++) {
      const s = screen[pattern[r]][r];
      if (s === sym || s === config.wild) count++;
      else break;
    }

    const payout = config.paytable[sym]?.[count] || 0;
    if (payout <= 0) continue;
    if (!best || payout > best.payout) best = { symbol: sym, count, payout };
  }
  return best;
}

function scatterPositions(screen, config) {
  const out = [];
  for (let row = 0; row < config.rows; row++) {
    for (let reel = 0; reel < config.reels; reel++) {
      if (screen[row][reel] === config.scatter) out.push({ reel, row });
    }
  }
  return out;
}

/** Округление денег до копеек — то же, что на сервере. */
function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
