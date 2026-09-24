// Stonefish_v1.js
// Stonefish_v1
// Strategy: look at every legal move, then choose one completely at random.

function getStonefishMove(game) {
  const legalMoves = typeof game.fastMoves === 'function'
    ? game.fastMoves()
    : game.moves({ verbose: true });

  if (legalMoves.length === 0) return null;

  const choice = legalMoves[Math.floor(Math.random() * legalMoves.length)];

  if (typeof game.fastMoves === 'function') {
    return {
      from: game._alg(choice.from),
      to: game._alg(choice.to),
      promotion: choice.promotion ? game._typeChar(choice.promotion) : undefined,
      captured: choice.captured ? game._typeChar(choice.captured) : undefined,
      _raw: choice
    };
  }

  return choice;
}
