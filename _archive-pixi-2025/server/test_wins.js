const rng = require("./rng");

let totalBet = 0;
let totalWin = 0;
const spins = 1000;
const bet = 10;

for (let i = 0; i < spins; i++) {
  totalBet += bet;
  const res = rng.spin(bet);
  totalWin += res.totalWin;

  if (res.totalWin > 500) {
    console.log("MASSIVE WIN DETECTED:", res.totalWin);
    console.log("Screen:", JSON.stringify(res.screen));
    console.log("Wins:", JSON.stringify(res.wins));
  }
}

console.log("RTP:", ((totalWin / totalBet) * 100).toFixed(2) + "%");
