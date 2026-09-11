importScripts(
  'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js',
  './Stonefish_v1.js',
  './Stonefish_v2.js',
  './Stonefish_v2_testunit1.js',
  './Stonefish_v2_testunit2.js'
);

const workerModels = {
  v1: getStonefishMove,
  v2: getStonefishV2Move,
  v2test1: getStonefishV2TestUnit1Move,
  v2test2: getStonefishV2TestUnit2Move
};

function playMove(game, move) {
  return game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion || 'q'
  });
}

function playTestGame(whiteModelKey, blackModelKey, maxPlies = 1000) {
  const game = new Chess();
  let plies = 0;

  while (!game.game_over() && plies < maxPlies) {
    const modelKey = game.turn() === 'w' ? whiteModelKey : blackModelKey;
    const getMove = workerModels[modelKey];
    const move = getMove(game);
    if (!move) break;
    playMove(game, move);
    plies += 1;
  }

  if (plies >= maxPlies && !game.game_over()) return 'draw';
  if (game.in_checkmate()) return game.turn() === 'w' ? 'black' : 'white';
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
