importScripts(
  './StonefishChess.js',
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

    const played = game.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion || 'q'
    });
    if (!played) throw new Error(`Engine returned illegal move: ${move.from}-${move.to}`);
    plies += 1;

    if (game.in_draw()) return 'draw';
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
