// Stonefish_v4(testunit2)
// Same v3 core and same five v4 tie-breakers.
// Experiment: activity/mobility before king-shape tie-breakers.

const STONEFISH_V4_TESTUNIT2_ORDER = ['check', 'mobility', 'kingFreedom', 'kingProtection', 'center'];

function getStonefishV4TestUnit2Move(game) {
  return getStonefishV4MoveWithOrder(game, STONEFISH_V4_TESTUNIT2_ORDER);
}
