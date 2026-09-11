importScripts(
  './StonefishChess.js',
  './Stonefish_v1.js',
  './Stonefish_v2.js',
  './Stonefish_v3.js',
  './Stonefish_v4.js',
  './Stonefish_v4_5.js',
  './Stonefish_v4_5_testunit1.js',
  './Stonefish_v4_5_testunit2.js',
  './Stonefish_v4_5_testunit3.js',
  './Stonefish_v4_5_testunit4.js',
  './Stonefish_v4_5_testunit5.js',
  './Stonefish_v4_5_testunit6.js',
  './Stonefish_v4_5_testunit7.js',
  './Stonefish_v4_5_testunit8.js'
);

const workerModels = {
  v1: getStonefishMove,
  v2: getStonefishV2Move,
  v3: getStonefishV3Move,
  v4: getStonefishV4Move,
  v45: getStonefishV45Move,
  v45t1: getStonefishV45Testunit1Move,
  v45t2: getStonefishV45Testunit2Move,
  v45t3: getStonefishV45Testunit3Move,
  v45t4: getStonefishV45Testunit4Move,
  v45t5: getStonefishV45Testunit5Move,
  v45t6: getStonefishV45Testunit6Move,
  v45t7: getStonefishV45Testunit7Move,
  v45t8: getStonefishV45Testunit8Move
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
