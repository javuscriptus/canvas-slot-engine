const rng = require("./rng");

function createSeededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function runSimulation(reelsConfig) {
  const strips = [];
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

  let totalBet = 0;
  let totalWin = 0;
  const spins = 100000;
  const bet = 10;
  const lineBet = bet / 5;

  for (let i = 0; i < spins; i++) {
    totalBet += bet;
    
    const stopIndexes = [];
    for (let col = 0; col < 5; col++) {
      stopIndexes.push(Math.floor(Math.random() * strips[col].length));
    }

    const screen = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 5; c++) {
        row.push(strips[c][(stopIndexes[c] + r) % strips[c].length]);
      }
      screen.push(row);
    }

    let spinWin = 0;
    for (let lineIndex = 0; lineIndex < rng.PAYLINES.length; lineIndex++) {
      const pattern = rng.PAYLINES[lineIndex];
      const lineSymbols = [];
      for (let col = 0; col < 5; col++) {
        lineSymbols.push(screen[pattern[col]][col]);
      }

      let maxPayout = 0;
      for (let count = 5; count >= 2; count--) {
        const candidates = new Set();
        for (let k = 0; k < count; k++) {
          candidates.add(lineSymbols[k]);
        }

        if (candidates.size === 1) {
          const sym = Array.from(candidates)[0];
          if (sym === 1) continue;
          const payout = rng.PAYTABLE[sym] ? (rng.PAYTABLE[sym][count] || 0) : 0;
          if (payout > maxPayout) {
            maxPayout = payout;
          }
        }
      }
      spinWin += lineBet * maxPayout;
    }

    let crownCount = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        if (screen[r][c] === 1) crownCount++;
      }
    }
    if (crownCount >= 3) {
      const scatterMult = crownCount === 3 ? 10 : (crownCount === 4 ? 50 : 250);
      spinWin += bet * scatterMult;
    }

    totalWin += spinWin;
  }

  return (totalWin / totalBet) * 100;
}

const config = {
  0: { 0: 1, 1: 3, 2: 4, 3: 4, 4: 3, 5: 3, 6: 13, 7: 21 },
  1: { 0: 2, 1: 3, 2: 4, 3: 4, 4: 3, 5: 13, 6: 21, 7: 3 },
  2: { 0: 1, 1: 3, 2: 4, 3: 4, 4: 13, 5: 21, 6: 3, 7: 3 },
  3: { 0: 2, 1: 3, 2: 4, 3: 4, 4: 21, 5: 3, 6: 3, 7: 13 },
  4: { 0: 2, 1: 2, 2: 4, 3: 4, 4: 3, 5: 3, 6: 13, 7: 21 }
};

console.log("Testing favorited reels config 10.3...");
const rtp = runSimulation(config);
console.log(`RTP: ${rtp.toFixed(2)}%`);
