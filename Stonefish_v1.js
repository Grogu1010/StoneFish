// Stonefish_v1
// Strategy: look at every legal move, then choose one completely at random.

function getStonefishMove(game) {
  const legalMoves = game.moves({ verbose: true });

  if (legalMoves.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * legalMoves.length);
  return legalMoves[randomIndex];
}
