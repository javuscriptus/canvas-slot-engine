// Автономный клиентский эмулятор RGS сервера для демонстрации на GitHub Pages.

const SYM = {
  ANCHOR: 0, ICECREAM: 1, SHASHLIK: 2, HAT: 3, WINE: 4,
  GEM_RED: 5, GEM_AMBER: 6, GEM_GREEN: 7, GEM_AQUA: 8, GEM_PURPLE: 9,
  WILD: 10, SCATTER: 11
};

const PAYTABLE = {
  [SYM.ANCHOR]:     { 3: 50, 4: 200, 5: 1000 },
  [SYM.ICECREAM]:   { 3: 40, 4: 150, 5: 600  },
  [SYM.SHASHLIK]:   { 3: 30, 4: 120, 5: 400  },
  [SYM.HAT]:        { 3: 25, 4: 100, 5: 300  },
  [SYM.WINE]:       { 3: 20, 4: 80,  5: 250  },
  [SYM.GEM_RED]:    { 3: 15, 4: 50,  5: 150  },
  [SYM.GEM_AMBER]:  { 3: 12, 4: 40,  5: 125  },
  [SYM.GEM_GREEN]:  { 3: 10, 4: 30,  5: 100  },
  [SYM.GEM_AQUA]:   { 3: 8,  4: 25,  5: 80   },
  [SYM.GEM_PURPLE]: { 3: 8,  4: 25,  5: 80   }
};

const SCATTER_PAYS = { 3: 2, 4: 10, 5: 50 };
const WILD_SUBSTITUTES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const PAYLINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [0, 0, 2, 0, 0]
];

const BASE_STRIPS = [
  [0, 5, 6, 1, 7, 8, 2, 9, 3, 5, 4, 6, 10, 7, 11, 8, 0, 9, 1, 5, 2, 6, 3, 7, 4, 8, 5, 9, 6, 0, 1, 2],
  [1, 6, 7, 2, 8, 9, 3, 5, 4, 6, 0, 7, 11, 8, 10, 9, 1, 5, 2, 6, 3, 7, 4, 8, 5, 9, 6, 0, 1, 2, 3, 4],
  [2, 7, 8, 3, 9, 5, 4, 6, 0, 7, 1, 8, 10, 9, 11, 5, 2, 6, 3, 7, 4, 8, 5, 9, 6, 0, 1, 2, 3, 4, 5, 6],
  [3, 8, 9, 4, 5, 6, 0, 7, 1, 8, 2, 9, 11, 5, 10, 6, 3, 7, 4, 8, 5, 9, 6, 0, 1, 2, 3, 4, 5, 6, 7, 8],
  [4, 9, 5, 0, 6, 7, 1, 8, 2, 9, 3, 5, 10, 6, 11, 7, 4, 8, 5, 9, 6, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
];

const NUM_REELS = 5;
const NUM_ROWS = 3;

function evaluateLine(lineSymbols) {
  let best = null;
  for (const sym of WILD_SUBSTITUTES) {
    let count = 0, wilds = 0;
    for (let i = 0; i < NUM_REELS; i++) {
      const s = lineSymbols[i];
      if (s === sym) count++;
      else if (s === SYM.WILD) { count++; wilds++; }
      else break;
    }
    if (count < 3) continue;
    const payout = PAYTABLE[sym]?.[count] || 0;
    if (payout <= 0) continue;
    if (!best || payout > best.payout) best = { symbol: sym, count, payout, wilds };
  }
  return best;
}

function evaluateScreen(screen, totalBet, opts = {}) {
  const lineBet = totalBet / PAYLINES.length;
  const wins = [];
  let total = 0;

  for (let li = 0; li < PAYLINES.length; li++) {
    const pattern = PAYLINES[li];
    const lineSymbols = [screen[pattern[0]][0], screen[pattern[1]][1], screen[pattern[2]][2], screen[pattern[3]][3], screen[pattern[4]][4]];
    const res = evaluateLine(lineSymbols);
    if (!res) continue;

    let multiplier = 1;
    const multipliers = [];
    if (opts.freeSpin && res.wilds > 0) {
      for (let w = 0; w < res.wilds; w++) {
        const m = Math.random() < 0.5 ? 2 : 3;
        multipliers.push(m);
        multiplier *= m;
      }
    }
    const amount = Math.round((lineBet * res.payout * multiplier + Number.EPSILON) * 100) / 100;
    total += amount;
    const positions = [];
    for (let r = 0; r < res.count; r++) positions.push({ reel: r, row: pattern[r] });

    wins.push({ type: "line", line: li, symbol: res.symbol, count: res.count, payout: res.payout, multiplier, multipliers, amount, positions });
  }

  const scatterPositions = [];
  for (let row = 0; row < NUM_ROWS; row++) {
    for (let reel = 0; reel < NUM_REELS; reel++) {
      if (screen[row][reel] === SYM.SCATTER) scatterPositions.push({ reel, row });
    }
  }
  const scatterCount = scatterPositions.length;
  if (scatterCount >= 3) {
    const pay = SCATTER_PAYS[Math.min(scatterCount, NUM_REELS)] || 0;
    if (pay > 0) {
      const amount = Math.round((totalBet * pay + Number.EPSILON) * 100) / 100;
      total += amount;
      wins.push({ type: "scatter", symbol: SYM.SCATTER, count: scatterCount, payout: pay, multiplier: 1, amount, positions: scatterPositions });
    }
  }

  return { wins, totalWin: Math.round((total + Number.EPSILON) * 100) / 100, scatterCount, scatterPositions };
}

export class MockGameServer {
  constructor() {
    this.balance = parseFloat(localStorage.getItem("sochi_demo_balance") || "1000.00");
    this.activeFreeSpins = null;
    this.historyList = [];
  }

  saveBalance(b) {
    this.balance = Math.round((b + Number.EPSILON) * 100) / 100;
    localStorage.setItem("sochi_demo_balance", this.balance.toString());
  }

  getConfig() {
    return {
      game: { id: "slot-demo", title: "Sochi Sunset Slot", lines: PAYLINES.length },
      isMock: true,
      reels: NUM_REELS,
      rows: NUM_ROWS,
      symbolKeys: ["anchor", "icecream", "shashlik", "hat", "wine", "gem_red", "gem_amber", "gem_green", "gem_aqua", "gem_purple", "wild", "scatter"],
      wild: SYM.WILD,
      scatter: SYM.SCATTER,
      paytable: PAYTABLE,
      scatterPays: SCATTER_PAYS,
      paylines: PAYLINES,
      freespins: { triggerScatters: 3, awarded: { 3: 10, 4: 12, 5: 15 }, retriggerAward: 5, wildMultipliers: [2, 3] },
      maxWinMultiplier: 5000,
      betLevels: [0.2, 0.4, 0.6, 0.8, 1, 2, 3, 4, 5, 10, 20, 30, 50, 100],
      defaultBet: 1,
      currencies: ["EUR", "USD", "RUB"],
      defaultCurrency: "EUR",
      betLimits: { EUR: { min: 0.2, max: 100, default: 1.0 } },
      betSteps: [0.2, 0.4, 0.6, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0],
      rtp: 96.008,
      lobby: { origins: ["*"] }
    };
  }

  getSession() {
    return {
      sessionToken: "demo-token",
      user: { id: "demo-player", name: "Demo Player" },
      currency: "EUR",
      balance: this.balance,
      demo: true,
      isMock: true,
      fair: { hash: "demo-hash-" + Math.random().toString(36).slice(2) }
    };
  }


  getState() {
    return {
      balance: this.balance,
      currency: "EUR",
      activeRound: this.activeFreeSpins ? {
        id: this.activeFreeSpins.roundId,
        bet: this.activeFreeSpins.bet,
        state: "free",
        freeSpins: { total: this.activeFreeSpins.total, remaining: this.activeFreeSpins.remaining, totalWin: this.activeFreeSpins.totalWin }
      } : null
    };
  }

  spin(bet) {
    if (this.balance < bet) {
      throw new Error("Недостаточно средств на балансе");
    }

    const stops = [
      Math.floor(Math.random() * BASE_STRIPS[0].length),
      Math.floor(Math.random() * BASE_STRIPS[1].length),
      Math.floor(Math.random() * BASE_STRIPS[2].length),
      Math.floor(Math.random() * BASE_STRIPS[3].length),
      Math.floor(Math.random() * BASE_STRIPS[4].length)
    ];

    const screen = [
      [BASE_STRIPS[0][stops[0]], BASE_STRIPS[1][stops[1]], BASE_STRIPS[2][stops[2]], BASE_STRIPS[3][stops[3]], BASE_STRIPS[4][stops[4]]],
      [BASE_STRIPS[0][(stops[0]+1)%BASE_STRIPS[0].length], BASE_STRIPS[1][(stops[1]+1)%BASE_STRIPS[1].length], BASE_STRIPS[2][(stops[2]+1)%BASE_STRIPS[2].length], BASE_STRIPS[3][(stops[3]+1)%BASE_STRIPS[3].length], BASE_STRIPS[4][(stops[4]+1)%BASE_STRIPS[4].length]],
      [BASE_STRIPS[0][(stops[0]+2)%BASE_STRIPS[0].length], BASE_STRIPS[1][(stops[1]+2)%BASE_STRIPS[1].length], BASE_STRIPS[2][(stops[2]+2)%BASE_STRIPS[2].length], BASE_STRIPS[3][(stops[3]+2)%BASE_STRIPS[3].length], BASE_STRIPS[4][(stops[4]+2)%BASE_STRIPS[4].length]]
    ];

    const res = evaluateScreen(screen, bet, { freeSpin: false });
    this.saveBalance(this.balance - bet + res.totalWin);

    const roundId = "rnd_" + Date.now();
    let state = "closed";
    let freeSpinsInfo = null;

    if (res.scatterCount >= 3) {
      const awarded = res.scatterCount === 3 ? 10 : (res.scatterCount === 4 ? 12 : 15);
      state = "free";
      this.activeFreeSpins = { roundId, bet, total: awarded, remaining: awarded, totalWin: res.totalWin };
      freeSpinsInfo = { total: awarded, remaining: awarded, totalWin: res.totalWin };
    }

    const spinRecord = { stops, screen, wins: res.wins, totalWin: res.totalWin, scatterCount: res.scatterCount, scatterPositions: res.scatterPositions };
    const roundResult = { id: roundId, bet, balance: this.balance, totalWin: res.totalWin, state, spins: [spinRecord], freeSpins: freeSpinsInfo };
    this.historyList.unshift(roundResult);
    return roundResult;
  }

  freeSpin(roundId) {
    if (!this.activeFreeSpins || this.activeFreeSpins.roundId !== roundId) {
      throw new Error("Активная бесплатная игра не найдена");
    }

    const fs = this.activeFreeSpins;
    fs.remaining--;

    const stops = [
      Math.floor(Math.random() * BASE_STRIPS[0].length),
      Math.floor(Math.random() * BASE_STRIPS[1].length),
      Math.floor(Math.random() * BASE_STRIPS[2].length),
      Math.floor(Math.random() * BASE_STRIPS[3].length),
      Math.floor(Math.random() * BASE_STRIPS[4].length)
    ];

    const screen = [
      [BASE_STRIPS[0][stops[0]], BASE_STRIPS[1][stops[1]], BASE_STRIPS[2][stops[2]], BASE_STRIPS[3][stops[3]], BASE_STRIPS[4][stops[4]]],
      [BASE_STRIPS[0][(stops[0]+1)%BASE_STRIPS[0].length], BASE_STRIPS[1][(stops[1]+1)%BASE_STRIPS[1].length], BASE_STRIPS[2][(stops[2]+1)%BASE_STRIPS[2].length], BASE_STRIPS[3][(stops[3]+1)%BASE_STRIPS[3].length], BASE_STRIPS[4][(stops[4]+1)%BASE_STRIPS[4].length]],
      [BASE_STRIPS[0][(stops[0]+2)%BASE_STRIPS[0].length], BASE_STRIPS[1][(stops[1]+2)%BASE_STRIPS[1].length], BASE_STRIPS[2][(stops[2]+2)%BASE_STRIPS[2].length], BASE_STRIPS[3][(stops[3]+2)%BASE_STRIPS[3].length], BASE_STRIPS[4][(stops[4]+2)%BASE_STRIPS[4].length]]
    ];

    const res = evaluateScreen(screen, fs.bet, { freeSpin: true });
    fs.totalWin += res.totalWin;
    this.saveBalance(this.balance + res.totalWin);

    let state = fs.remaining > 0 ? "free" : "closed";
    const freeSpinsInfo = { total: fs.total, remaining: fs.remaining, totalWin: fs.totalWin };

    if (fs.remaining <= 0) {
      this.activeFreeSpins = null;
    }

    const spinRecord = { stops, screen, wins: res.wins, totalWin: res.totalWin, scatterCount: res.scatterCount, scatterPositions: res.scatterPositions };
    return { id: roundId, bet: fs.bet, balance: this.balance, totalWin: res.totalWin, state, spins: [spinRecord], freeSpins: freeSpinsInfo };
  }

  getHistory() {
    return { items: this.historyList.slice(0, 20) };
  }

  getRound(id) {
    return this.historyList.find((r) => r.id === id) || null;
  }
}
