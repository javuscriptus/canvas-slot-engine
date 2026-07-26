// Раунд игры: базовый спин плюс, если выпал бонус, серия фриспинов.
//
// Раунд — единица расчёта с кошельком: ставка списывается на старте,
// суммарный выигрыш зачисляется при закрытии. Пока раунд не закрыт,
// игрок не может начать новый — это защищает от двойного списания
// и позволяет корректно восстановить сессию после обрыва связи.

"use strict";

const C = require("../math/gameConfig");
const engine = require("../math/engine");

const STATE = {
  BASE: "base",
  FREE: "free",
  COMPLETE: "complete"
};

/**
 * Начинает раунд базовым спином.
 * @param {{nextInt:(max:number)=>number}} rng
 * @param {number} bet общая ставка
 */
function startRound(rng, bet) {
  const result = engine.spin((max) => rng.nextInt(max), bet, { freeSpin: false });
  const awarded = engine.freeSpinsAwarded(result.scatterCount);

  const round = {
    bet,
    totalWin: result.totalWin,
    state: awarded > 0 ? STATE.FREE : STATE.COMPLETE,
    freeSpinsTotal: awarded,
    freeSpinsLeft: awarded,
    freeSpinsPlayed: 0,
    freeWin: 0,
    spins: [
      {
        index: 0,
        type: "base",
        stops: result.stops,
        screen: result.screen,
        wins: result.wins,
        win: result.totalWin,
        scatterCount: result.scatterCount
      }
    ]
  };

  if (round.state === STATE.COMPLETE) applyCap(round);
  return round;
}

/**
 * Играет один фриспин внутри активного раунда.
 * @returns {object} описание спина
 */
function playFreeSpin(rng, round) {
  if (round.state !== STATE.FREE) {
    throw new Error("Фриспин запрошен вне бонусного режима");
  }
  if (round.freeSpinsLeft <= 0) {
    throw new Error("Фриспины закончились");
  }

  const result = engine.spin((max) => rng.nextInt(max), round.bet, { freeSpin: true });

  round.freeSpinsLeft--;
  round.freeSpinsPlayed++;
  round.freeWin = engine.round2(round.freeWin + result.totalWin);
  round.totalWin = engine.round2(round.totalWin + result.totalWin);

  // Ретригер: те же 3+ скаттера добавляют спины, но не открывают новый бонус.
  let retrigger = 0;
  if (
    result.scatterCount >= C.FREESPINS.retriggerScatters &&
    round.freeSpinsTotal < C.FREESPINS.maxTotalSpins
  ) {
    retrigger = Math.min(
      C.FREESPINS.retriggerAward,
      C.FREESPINS.maxTotalSpins - round.freeSpinsTotal
    );
    round.freeSpinsLeft += retrigger;
    round.freeSpinsTotal += retrigger;
  }

  const spin = {
    index: round.spins.length,
    type: "free",
    stops: result.stops,
    screen: result.screen,
    wins: result.wins,
    win: result.totalWin,
    scatterCount: result.scatterCount,
    retrigger,
    freeSpinsLeft: round.freeSpinsLeft
  };
  round.spins.push(spin);

  if (round.freeSpinsLeft <= 0) {
    round.state = STATE.COMPLETE;
    applyCap(round);
  }

  return spin;
}

/**
 * Ограничение максимальной выплаты за раунд.
 *
 * Ставится не «на всякий случай»: требование прописано в правилах
 * большинства юрисдикций, а без него редкая комбинация множителей во
 * фриспинах способна выдать выплату, которой нет в кошельке оператора.
 */
function applyCap(round) {
  const cap = round.bet * C.MAX_WIN_MULTIPLIER;
  if (round.totalWin > cap) {
    round.cappedFrom = round.totalWin;
    round.totalWin = engine.round2(cap);
    round.capped = true;
  }
  return round;
}

/** Компактное представление раунда для передачи клиенту. */
function serialize(round, { includeAllSpins = false } = {}) {
  return {
    bet: round.bet,
    totalWin: round.totalWin,
    state: round.state,
    capped: !!round.capped,
    freeSpins: {
      total: round.freeSpinsTotal,
      left: round.freeSpinsLeft,
      played: round.freeSpinsPlayed,
      win: round.freeWin
    },
    spins: includeAllSpins ? round.spins : [round.spins[round.spins.length - 1]]
  };
}

module.exports = { STATE, startRound, playFreeSpin, applyCap, serialize };
