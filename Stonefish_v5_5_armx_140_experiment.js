// Experimental ARMX speed/strength candidate for the <=140% host-time target.
// Loaded only through ENGINE_PATCH in development benchmarks; it does not change
// the normal v5.5 testunit1 entry unless this file is explicitly requested.

const STONEFISH_V5_5_ARMX_140_CURRENT_MOVE = getStonefishV55Testunit1Move;
const STONEFISH_V5_5_ARMX_140_NO_ARMX_MOVE = getStonefishV55Testunit1NoARMXMove;
const STONEFISH_V5_5_ARMX_140_NODE_BUDGET = Number.parseInt(
  (typeof process !== 'undefined' && process.env.ARMX140_NODES) || '1600', 10
) || 1600;
const STONEFISH_V5_5_ARMX_140_MODE =
  (typeof process !== 'undefined' && process.env.ARMX140_MODE) || 'roots';
const STONEFISH_V5_5_ARMX_140_ROOTS = Number.parseInt(
  (typeof process !== 'undefined' && process.env.ARMX140_ROOTS) || '6', 10
) || 6;
const STONEFISH_V5_5_ARMX_140_ROOT_DEPTH = Number.parseInt(
  (typeof process !== 'undefined' && process.env.ARMX140_ROOT_DEPTH) || '4', 10
) || 4;

function getStonefishV55ARMX140Move(game) {
  const originalPolicy = armxPreviewOpponentPolicy;
  armxPreviewOpponentPolicy = function armxPreviewOpponentPolicy140(g, perspective = g.side) {
    const policy = originalPolicy(g, perspective);
    if (!policy) return null;
    // Keep every learned preference, reduction rule and finalist adjustment.
    // Only cap the amount of native search work requested by ARMX.
    if (STONEFISH_V5_5_ARMX_140_MODE === 'budget') {
      return Object.assign({}, policy, {
        searchBudget: Math.max(SF55C.nodes, STONEFISH_V5_5_ARMX_140_NODE_BUDGET),
        maxDepth: SF55C.maxDepth,
      });
    }
    if (STONEFISH_V5_5_ARMX_140_MODE === 'hybrid') {
      return Object.assign({}, policy, {
        searchBudget: Math.max(SF55C.nodes, STONEFISH_V5_5_ARMX_140_NODE_BUDGET),
        maxDepth: SF55C.maxDepth + ARMX_PREVIEW.maxExtraSearchDepth,
        deepRootLimit: STONEFISH_V5_5_ARMX_140_ROOTS,
        deepRootFromDepth: STONEFISH_V5_5_ARMX_140_ROOT_DEPTH,
      });
    }
    return Object.assign({}, policy, {
      deepRootLimit: STONEFISH_V5_5_ARMX_140_ROOTS,
      deepRootFromDepth: STONEFISH_V5_5_ARMX_140_ROOT_DEPTH,
    });
  };
  try {
    return STONEFISH_V5_5_ARMX_140_CURRENT_MOVE(game);
  } finally {
    armxPreviewOpponentPolicy = originalPolicy;
  }
}

getStonefishV55Testunit1Move = getStonefishV55ARMX140Move;

// Reuse the existing benchmark's ARMX-vs-NoARMX slot for candidate-vs-current
// when explicitly requested. This keeps the game generator, seeds and timing
// instrumentation identical between the two validation runs.
if (typeof process !== 'undefined' && process.env.ARMX140_OPPONENT === 'current') {
  getStonefishV55Testunit1NoARMXMove = STONEFISH_V5_5_ARMX_140_CURRENT_MOVE;
} else {
  getStonefishV55Testunit1NoARMXMove = STONEFISH_V5_5_ARMX_140_NO_ARMX_MOVE;
}

if (typeof globalThis !== 'undefined') {
  globalThis.getStonefishV55ARMX140Move = getStonefishV55ARMX140Move;
}
