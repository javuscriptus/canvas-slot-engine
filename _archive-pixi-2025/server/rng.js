const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2]
];

const PAYTABLE = {
  0: { 3: 100, 4: 1000, 5: 5000 },
  2: { 3: 50, 4: 200, 5: 1000 },
  3: { 3: 50, 4: 200, 5: 1000 },
  4: { 3: 20, 4: 50, 5: 200 },
  5: { 3: 20, 4: 50, 5: 200 },
  6: { 3: 20, 4: 40, 5: 200 },
  7: { 2: 5, 3: 20, 4: 40, 5: 200 }
};

const SCATTER_PAYOUTS = {
  3: 10,
  4: 50,
  5: 250
};

function createSeededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function generateReelStrips() {
  const strips = [];
  const reelsConfig = {
    0: { 0: 1, 1: 3, 2: 4, 3: 4, 4: 3, 5: 3, 6: 13, 7: 21 },
    1: { 0: 2, 1: 3, 2: 4, 3: 4, 4: 3, 5: 13, 6: 21, 7: 3 },
    2: { 0: 1, 1: 3, 2: 4, 3: 4, 4: 13, 5: 21, 6: 3, 7: 3 },
    3: { 0: 2, 1: 3, 2: 4, 3: 4, 4: 21, 5: 3, 6: 3, 7: 13 },
    4: { 0: 2, 1: 2, 2: 4, 3: 4, 4: 3, 5: 3, 6: 13, 7: 21 }
  };
  for (let col = 0; col < 5; col++) {
    const basePool = [];
    const config = reelsConfig[col];
    for (let sId = 0; sId < 8; sId++) {
      const count = config[sId] || 0;
      for (let i = 0; i < count; i++) {
        basePool.push(sId);
      }
    }
    const rand = createSeededRandom(4321 + col * 987);
    for (let i = basePool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const temp = basePool[i];
      basePool[i] = basePool[j];
      basePool[j] = temp;
    }
    strips.push(basePool);
  }
  return strips;
}

const REEL_STRIPS = generateReelStrips();

function getRandomStopIndexes() {
  const indexes = [];
  for (let i = 0; i < 5; i++) {
    const len = REEL_STRIPS[i].length;
    indexes.push(Math.floor(Math.random() * len));
  }
  return indexes;
}

function getVisibleScreen(stopIndexes) {
  const screen = [];
  for (let row = 0; row < 3; row++) {
    const rowSymbols = [];
    for (let col = 0; col < 5; col++) {
      const strip = REEL_STRIPS[col];
      const index = (stopIndexes[col] + row) % strip.length;
      rowSymbols.push(strip[index]);
    }
    screen.push(rowSymbols);
  }
  return screen;
}

function evaluateLine(lineSymbols) {
  let maxPayout = 0;
  let winningSymbol = -1;
  let winningCount = 0;

  for (let count = 5; count >= 2; count--) {
    const candidates = new Set();
    for (let i = 0; i < count; i++) {
      candidates.add(lineSymbols[i]);
    }

    if (candidates.size === 1) {
      const symbol = Array.from(candidates)[0];
      if (symbol === 1) continue;
      const payout = PAYTABLE[symbol] ? (PAYTABLE[symbol][count] || 0) : 0;
      if (payout > maxPayout) {
        maxPayout = payout;
        winningSymbol = symbol;
        winningCount = count;
      }
    }
  }

  return { payout: maxPayout, symbol: winningSymbol, count: winningCount };
}

function spin(bet) {
  const stopIndexes = getRandomStopIndexes();
  const screen = getVisibleScreen(stopIndexes);
  const lineBet = bet / PAYLINES.length;
  
  let totalWin = 0;
  const wins = [];

  for (let lineIndex = 0; lineIndex < PAYLINES.length; lineIndex++) {
    const linePattern = PAYLINES[lineIndex];
    const lineSymbols = [];
    for (let col = 0; col < 5; col++) {
      const row = linePattern[col];
      lineSymbols.push(screen[row][col]);
    }

    const evaluation = evaluateLine(lineSymbols);
    if (evaluation.payout > 0) {
      const winAmount = parseFloat((lineBet * evaluation.payout).toFixed(2));
      totalWin += winAmount;
      wins.push({
        lineIndex,
        symbol: evaluation.symbol,
        count: evaluation.count,
        payout: evaluation.payout,
        winAmount
      });
    }
  }

  let crownCount = 0;
  const crownCoords = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      if (screen[r][c] === 1) {
        crownCount++;
        crownCoords.push({ row: r, col: c });
      }
    }
  }

  if (crownCount >= 3) {
    const scatterMultiplier = SCATTER_PAYOUTS[crownCount] || 0;
    if (scatterMultiplier > 0) {
      const scatterWin = parseFloat((bet * scatterMultiplier).toFixed(2));
      totalWin += scatterWin;
      wins.push({
        lineIndex: -1,
        symbol: 1,
        count: crownCount,
        payout: scatterMultiplier,
        winAmount: scatterWin,
        coords: crownCoords
      });
    }
  }

  totalWin = parseFloat(totalWin.toFixed(2));

  return {
    stopIndexes,
    screen,
    wins,
    totalWin
  };
}

module.exports = {
  REEL_STRIPS,
  PAYLINES,
  PAYTABLE,
  spin
};
