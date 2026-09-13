importScripts(
  './StonefishChess.js',
  './Stonefish_v1.js',
  './Stonefish_v2.js',
  './Stonefish_v3.js',
  './Stonefish_v4.js',
  './Stonefish_v4_5.js',
  './Stonefish_v4_5_opening_overrides.js',
  './Stonefish_v4_5_safety_patch.js',
  './Stonefish_v4_5_balance_patch.js',
  './Stonefish_v5.js',
  './Stonefish_v5_pro.js',
  './Stonefish_v5_pro_speed_patch.js',
  './Stonefish_v5_pro_geometry_patch.js',
  './Stonefish_runtime_speed_patch.js',
  './Stonefish_fast_moves_experiment.js',
  './Stonefish_v5_5_search.js',
  './ARMX_preview_fast.js',
  './Stonefish_v5_5_testunit1.js'
);

const workerModels = {
  v1: getStonefishMove,
  v2: getStonefishV2Move,
  v3: getStonefishV3Move,
  v4: getStonefishV4Move,
  v45: getStonefishV45Move,
  v5: getStonefishV5Move,
  v55test1noarmx: getStonefishV55Testunit1NoARMXMove,
  v55test1: getStonefishV55Testunit1Move,
  v5pro: getStonefishV5ProMove
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
  const metrics = {
    [whiteModelKey]: { moves: 0, thinkMs: 0 },
    [blackModelKey]: { moves: 0, thinkMs: 0 }
  };

  while (plies < maxPlies) {
    const modelKey = game.turn() === 'w' ? whiteModelKey : blackModelKey;
    const getMove = workerModels[modelKey];
    if (!getMove) throw new Error(`Unknown model: ${modelKey}`);

    const started = performance.now();
    const move = getMove(game);
    const elapsed = performance.now() - started;
    if (!move) {
      return {
        outcome: game.in_check() ? (game.turn() === 'w' ? 'black' : 'white') : 'draw',
        metrics,
        plies
      };
    }

    metrics[modelKey].moves += 1;
    metrics[modelKey].thinkMs += elapsed;
    commitChosenMove(game, move);
    plies += 1;
    if (cheapDrawReached(game)) return { outcome: 'draw', metrics, plies };
  }

  return { outcome: 'draw', metrics, plies };
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
