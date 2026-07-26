const sessions = new Map();
const players = new Map();

players.set("player_demo", {
  id: "player_demo",
  username: "DemoPlayer",
  balance: 10000.00,
  currency: "USD"
});

function getSession(token) {
  return sessions.get(token);
}

function createSession(token, playerId) {
  const player = players.get(playerId);
  if (!player) return null;
  const session = {
    token,
    playerId,
    createdAt: Date.now()
  };
  sessions.set(token, session);
  return session;
}

function getPlayerBalance(playerId) {
  const player = players.get(playerId);
  return player ? player.balance : 0;
}

function updatePlayerBalance(playerId, amount) {
  const player = players.get(playerId);
  if (!player) return false;
  
  const newBalance = parseFloat((player.balance + amount).toFixed(2));
  if (newBalance < 0) return false;
  
  player.balance = newBalance;
  return player.balance;
}

function getPlayer(playerId) {
  return players.get(playerId);
}

module.exports = {
  getSession,
  createSession,
  getPlayerBalance,
  updatePlayerBalance,
  getPlayer
};
