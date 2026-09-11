// Stonefish_v4(testunit1)
// Same v3 core and same five v4 tie-breakers.
// Experiment: surrounding king protection before king freedom/castling.

const STONEFISH_V4_TESTUNIT1_ORDER = ['check', 'kingProtection', 'kingFreedom', 'mobility', 'center'];

function getStonefishV4TestUnit1Move(game) {
  return getStonefishV4MoveWithOrder(game, STONEFISH_V4_TESTUNIT1_ORDER);
}
