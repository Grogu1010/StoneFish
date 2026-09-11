importScripts(
  './fast-chess.js',
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

function commitFastMove(game, move) {
  if (typeof game.fastCommit === 'function') {
    game.fastCommit(move);
    return move;
  }
  return game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
}

function cheapDrawReached(game) {
  return game.halfmove >= 100 || game.insufficient_material() || game.in_threefold_repetition();
}

function playTestGame(whiteModelKey, blackModelKey, maxPlies = 1000) {
  const game = new FastChess();
  let plies = 0;

  while (plies < maxPlies) {
    const modelKey = game.turn() === 'w' ? whiteModelKey : blackModelKey;
    const getMove = workerModels[modelKey];
    if (!getMove) throw new Error(`Unknown model: ${modelKey}`);

    const move = getMove(game);

    if (!move) {
      if (game.in_check()) return game.turn() === 'w' ? 'black' : 'white';
      return 'draw';
    }

    commitFastMove(game, move);
    plies += 1;

    if (cheapDrawReached(game)) return 'draw';
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
      error: error instanceof Error ? error.stack || error.message : String(error)
    });
  }
};
