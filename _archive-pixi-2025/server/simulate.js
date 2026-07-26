const rng = require("./rng");

const TOTAL_SPINS = 100000;
const BET = 10;

let totalBet = 0;
let totalWin = 0;
let winSpinsCount = 0;
let highestWin = 0;

console.log(`Starting simulation of ${TOTAL_SPINS} spins...`);

const startTime = Date.now();

for (let i = 0; i < TOTAL_SPINS; i++) {
  totalBet += BET;
  const result = rng.spin(BET);
  totalWin += result.totalWin;

  if (result.totalWin > 0) {
    winSpinsCount++;
    if (result.totalWin > highestWin) {
      highestWin = result.totalWin;
    }
  }
}

const duration = ((Date.now() - startTime) / 1000).toFixed(2);
const rtp = ((totalWin / totalBet) * 100).toFixed(2);
const hitRate = ((winSpinsCount / TOTAL_SPINS) * 100).toFixed(2);

console.log("--------------------------------------");
console.log(`Simulation finished in ${duration} seconds.`);
console.log(`Total Spins: ${TOTAL_SPINS}`);
console.log(`Total Bet: $${totalBet.toFixed(2)}`);
console.log(`Total Win: $${totalWin.toFixed(2)}`);
console.log(`Return to Player (RTP): ${rtp}%`);
console.log(`Hit Rate (Win frequency): ${hitRate}%`);
console.log(`Highest Win: $${highestWin.toFixed(2)} (${(highestWin / BET).toFixed(1)}x bet)`);
console.log("--------------------------------------");
