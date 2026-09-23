const stonefishWorkerAssetSuffix = self.location && self.location.search ? self.location.search : '';
const stonefishWorkerAsset = path => `${path}${stonefishWorkerAssetSuffix}`;

importScripts(
  stonefishWorkerAsset('./StonefishChess.js'),
  stonefishWorkerAsset('./Stonefish_v1.js'),
  stonefishWorkerAsset('./Stonefish_v2.js'),
  stonefishWorkerAsset('./Stonefish_v3.js'),
  stonefishWorkerAsset('./Stonefish_v4.js'),
  stonefishWorkerAsset('./Stonefish_v4_5.js'),
  stonefishWorkerAsset('./Stonefish_v4_5_opening_overrides.js'),
  stonefishWorkerAsset('./Stonefish_v4_5_safety_patch.js'),
  stonefishWorkerAsset('./Stonefish_v4_5_balance_patch.js'),
  stonefishWorkerAsset('./Stonefish_v5.js'),
  stonefishWorkerAsset('./Stonefish_v5_pro.js'),
  stonefishWorkerAsset('./Stonefish_v5_pro_speed_patch.js'),
  stonefishWorkerAsset('./Stonefish_v5_pro_geometry_patch.js'),
  stonefishWorkerAsset('./Stonefish_runtime_speed_patch.js'),
  stonefishWorkerAsset('./Stonefish_fast_moves_experiment.js'),
  stonefishWorkerAsset('./Stonefish_v5_5_search.js'),
  stonefishWorkerAsset('./Stonefish_v5_5_refutation_guard.js'),
  stonefishWorkerAsset('./Stonefish_v5_5_native.js'),
  stonefishWorkerAsset('./ARMX-preview.js'),
  stonefishWorkerAsset('./Stonefish_v5_5.js')
);

const workerModels = {
  v1: getStonefishMove,
  v2: getStonefishV2Move,
  v3: getStonefishV3Move,
  v4: getStonefishV4Move,
  v45: getStonefishV45Move,
  v5: getStonefishV5Move,
  v55noarmx: getStonefishV55NoARMXMove,
  v55: getStonefishV55Move,
  v5pro: getStonefishV5ProMove
};

function seededRandom(seed) {
  let x = seed >>> 0;
  return function random() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const old = Math.random;
  Math.random = seededRandom(seed);
  try { return fn(); } finally { Math.random = old; }
}

// Match the CI benchmark's varied-opening generator. Each opening index is used
// for a color-swapped pair, so both engines see the exact same starting history
// from opposite colors instead of replaying one deterministic initial-position game.
function applyVariedOpening(game, openingIndex = 0) {
  const index = Math.max(0, Number(openingIndex) || 0);
  const plies = 10;
  const pick = seededRandom((0xA551000 + index * 977) >>> 0);

  withSeed((0xB771000 + index * 131) >>> 0, () => {
    for (let ply = 0; ply < plies && !game.game_over(); ply += 1) {
      const scored = stonefishV5ScoreAllMoves(game);
      if (!scored.length) break;
      const width = Math.min(4, scored.length);
      const r = pick();
      const rank = Math.min(width - 1, r < 0.48 ? 0 : r < 0.76 ? 1 : r < 0.93 ? 2 : 3);
      const entry = scored[rank];
      if (!entry || !entry.raw) break;
      game._applyRaw(entry.raw, true);
    }
  });
  game.armxObservationStartPly = game.historyStack.length;
}

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

function playTestGame(whiteModelKey, blackModelKey, maxPlies = 360, openingIndex = 0) {
  const game = new Chess();
  applyVariedOpening(game, openingIndex);
  let plies = game.historyStack.length;
  const nativeKernelAvailable = typeof SF55C_KERNEL !== 'undefined' && !!SF55C_KERNEL;
  const metrics = {
    [whiteModelKey]: { moves: 0, thinkMs: 0, nodes: 0, depthSum: 0, nativeKernelAvailable, compiledMoves: 0, fallbackMoves: 0 },
    [blackModelKey]: { moves: 0, thinkMs: 0, nodes: 0, depthSum: 0, nativeKernelAvailable, compiledMoves: 0, fallbackMoves: 0 }
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
        plies,
        openingIndex
      };
    }

    metrics[modelKey].moves += 1;
    metrics[modelKey].thinkMs += elapsed;
    const lastSearch = globalThis.SF55C_LAST;
    if ((modelKey === 'v55' || modelKey === 'v55noarmx') && lastSearch) {
      metrics[modelKey].nodes += Number(lastSearch.nodes) || 0;
      metrics[modelKey].depthSum += Number(lastSearch.depth) || 0;
    }
    if (modelKey === 'v55') {
      const compiled = !!(globalThis.SF55C_LAST && globalThis.SF55C_LAST.refutationGuard
        && globalThis.SF55C_LAST.refutationGuard.compiledSearch);
      if (compiled) metrics[modelKey].compiledMoves += 1;
      else metrics[modelKey].fallbackMoves += 1;
    }
    commitChosenMove(game, move);
    plies += 1;
    if (game.in_checkmate()) return { outcome: game.side === 1 ? 'black' : 'white', metrics, plies, openingIndex };
    if (cheapDrawReached(game)) return { outcome: 'draw', metrics, plies, openingIndex };
  }

  return { outcome: 'draw', metrics, plies, openingIndex };
}

let stonefishWorkerARMXProfile = null;
let stonefishWorkerARMXProfilerInstalled = false;

function stonefishWorkerInstallARMXProfiler() {
  if (stonefishWorkerARMXProfilerInstalled) return;
  stonefishWorkerARMXProfilerInstalled = true;
  stonefishWorkerARMXProfile = {
    policyMs: 0, policyCalls: 0,
    hostMs: 0, hostCalls: 0,
    nativeMs: 0, nativeCalls: 0,
    historyMs: 0, historyCalls: 0,
    reviewMs: 0, reviewCalls: 0,
  };
  const wrap = (name, msKey, callsKey) => {
    const original = globalThis[name];
    if (typeof original !== 'function') return;
    globalThis[name] = function profiledARMXCall(...args) {
      const started = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        stonefishWorkerARMXProfile[msKey] += performance.now() - started;
        stonefishWorkerARMXProfile[callsKey] += 1;
      }
    };
  };
  wrap('armxPreviewOpponentPolicy', 'policyMs', 'policyCalls');
  wrap('stonefishV55ARMXHostSearch', 'hostMs', 'hostCalls');
  wrap('sf55cNativeAcceleratedHost', 'nativeMs', 'nativeCalls');
  wrap('sf55cSyncNativePublicHistory', 'historyMs', 'historyCalls');
  wrap('armxPreviewReview', 'reviewMs', 'reviewCalls');
}

function stonefishWorkerResetARMXProfile() {
  if (!stonefishWorkerARMXProfile) return;
  for (const key of Object.keys(stonefishWorkerARMXProfile)) {
    stonefishWorkerARMXProfile[key] = 0;
  }
}

self.onmessage = event => {
  const { jobId, whiteModelKey, blackModelKey, maxPlies, openingIndex, profileARMX } = event.data;

  try {
    if (profileARMX) {
      stonefishWorkerInstallARMXProfiler();
      stonefishWorkerResetARMXProfile();
    }
    const result = playTestGame(
      whiteModelKey,
      blackModelKey,
      maxPlies || 360,
      Number.isFinite(Number(openingIndex)) ? Number(openingIndex) : 0
    );
    if (profileARMX && stonefishWorkerARMXProfile) {
      result.armxProfile = Object.assign({}, stonefishWorkerARMXProfile);
    }
    self.postMessage({ jobId, result });
  } catch (error) {
    self.postMessage({
      jobId,
      error: error instanceof Error ? error.stack || error.message : String(error)
    });
  }
};
