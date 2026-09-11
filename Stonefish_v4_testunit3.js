// Stonefish_v4(testunit3)
// Same v3 core and same five v4 tie-breakers.
// Experiment: centre control before mobility and king-shape tie-breakers.

const STONEFISH_V4_TESTUNIT3_ORDER = ['check', 'center', 'mobility', 'kingFreedom', 'kingProtection'];

function getStonefishV4TestUnit3Move(game) {
  return getStonefishV4MoveWithOrder(game, STONEFISH_V4_TESTUNIT3_ORDER);
}
