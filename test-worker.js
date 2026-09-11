importScripts(
  'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js',
  './Stonefish_v1.js',
  './Stonefish_v2.js',
  './Stonefish_v3.js',
  './Stonefish_v3_testunit1.js',
  './Stonefish_v3_testunit2.js'
);

const workerModels = {
  v1: getStonefishMove,
  v2: getStonefishV2Move,
  v3: getStonefishV3Move,
  v3test1: getStonefishV3TestUnit1Move,
  v3test2: getStonefishV3TestUnit2Move
};

function playMove(game, move) {
  return game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
}

function isNonStalemateDraw(game) {
  const fenParts = game.fen().split(' ');
  const halfmoveClock = Number.parseInt(fenParts[4], 10) || 0;

  if (halfmoveClock >= 100) return true;
  if (typeof game.insufficient_material === 'function' && game.insufficient_material()) return true;
  if (typeof game.in_threefold_repetition === 'function' && game.in_threefold_repetition()) return true;
  return false;
}

function playTestGame(whiteModelKey, blackModelKey, maxPlies = 1000) {
  const game = new Chess();

  for (let plies = 0; plies < maxPlies; plies += 1) {
    const modelKey = game.turn() === 'w' ? whiteModelKey : blackModelKey;
    const getMove = workerModels[modelKey];
    if (!getMove) throw new Error(`Unknown model: ${modelKey}`);

    // Each model already generates legal moves. Avoid game.game_over() here,
    // which would generate the same move list a second time every ply.
    const move = getMove(game);

    if (!move) {
      // No legal moves: checkmate if the side to move is in check, otherwise stalemate.
      return game.in_check() ? (game.turn() === 'w' ? 'black' : 'white') : 'draw';
    }

    const playedMove = playMove(game, move);
    if (!playedMove) throw new Error(`Illegal move returned by ${modelKey}`);

    // SAN already tells us if the just-played move delivered mate.
    if (playedMove.san && playedMove.san.endsWith('#')) {
      return playedMove.color === 'w' ? 'white' : 'black';
    }

    // Handle draw rules that do not require another legal-move generation.
    if (isNonStalemateDraw(game)) return 'draw';
  }

  return 'draw';
}

self.onmessage = event => {
  const { jobId, whiteModelKey, blackModelKey, maxPlies } = event.data;

  try {
    const result = playTestGame(whiteModelKey, blackModelKey, maxPlies || 1000);
    self.postMessage({ jobId, result });
  } catch (error) {
    self.postMessage({
      jobId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
