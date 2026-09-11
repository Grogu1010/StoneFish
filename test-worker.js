importScripts(
  './StonefishChess.js',
  './Stonefish_v1.js',
  './Stonefish_v2.js',
  './Stonefish_v3.js',
  './Stonefish_v4.js',
  './Stonefish_v4_testunit1.js',
  './Stonefish_v4_testunit2.js',
  './Stonefish_v4_testunit3.js',
  './Stonefish_v4_testunit4.js'
);

const workerModels = {
  v1: getStonefishMove,
  v2: getStonefishV2Move,
  v3: getStonefishV3Move,
  v4: getStonefishV4Move,
  v4test1: getStonefishV4TestUnit1Move,
  v4test2: getStonefishV4TestUnit2Move,
  v4test3: getStonefishV4TestUnit3Move,
  v4test4: getStonefishV4TestUnit4Move
};

function commitChosenMove(game, move) {
  if (move && move._raw) {
    game._applyRaw(move._raw, true);
    return;
  }

  const played = game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
  if (!played) throw new Error(`Engine returned illegal move: ${move.from}-${move.to}`);
}

function cheapDrawReached(game) {
  if (game.halfmove >= 100) return true;
  if (game._insufficientMaterial()) return true;
  return (game.positionCounts.get(game.fastPositionKey()) || 0) >= 3;
}

function playTestGame(whiteModelKey, blackModelKey, maxPlies = 1000) {
  const game = new Chess();
  let plies = 0;

  while (plies < maxPlies) {
    const modelKey = game.turn() === 'w' ? whiteModelKey : blackModelKey;
    const getMove = workerModels[modelKey];
    if (!getMove) throw new Error(`Unknown model: ${modelKey}`);

    const move = getMove(game);
    if (!move) {
      return game.in_check() ? (game.turn() === 'w' ? 'black' : 'white') : 'draw';
    }

    commitChosenMove(game, move);
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
