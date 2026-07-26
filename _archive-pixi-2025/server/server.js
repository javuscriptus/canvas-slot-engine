const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const rng = require("./rng");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "../client/dist")));

app.post("/api/init", (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  let session = db.getSession(token);
  if (!session) {
    session = db.createSession(token, "player_demo");
  }

  if (!session) {
    return res.status(401).json({ error: "Invalid session" });
  }

  const player = db.getPlayer(session.playerId);
  return res.json({
    player: {
      username: player.username,
      balance: player.balance,
      currency: player.currency
    },
    config: {
      paylinesCount: rng.PAYLINES.length,
      availableBets: [1, 2, 5, 10, 20, 50, 100],
      defaultBet: 10
    }
  });
});

app.post("/api/spin", (req, res) => {
  const { token, bet } = req.body;
  if (!token || bet === undefined) {
    return res.status(400).json({ error: "Token and bet are required" });
  }

  const session = db.getSession(token);
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const playerId = session.playerId;
  const balance = db.getPlayerBalance(playerId);

  if (bet <= 0 || balance < bet) {
    return res.status(400).json({ error: "Insufficient balance or invalid bet" });
  }

  const newBalanceAfterBet = db.updatePlayerBalance(playerId, -bet);
  if (newBalanceAfterBet === false) {
    return res.status(400).json({ error: "Transaction failed" });
  }

  const spinResult = rng.spin(bet);

  const finalBalance = db.updatePlayerBalance(playerId, spinResult.totalWin);

  return res.json({
    screen: spinResult.screen,
    stopIndexes: spinResult.stopIndexes,
    wins: spinResult.wins,
    totalWin: spinResult.totalWin,
    balance: finalBalance
  });
});

app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"), (err) => {
    if (err) {
      res.status(404).send("Game build not found. Please build client first.");
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
