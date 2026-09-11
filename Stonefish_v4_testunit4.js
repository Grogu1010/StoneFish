// Stonefish_v4(testunit4)
// Same v3 core and same five v4 tie-breakers.
// Experiment: king safety before checks.

const STONEFISH_V4_TESTUNIT4_ORDER = ['kingFreedom', 'kingProtection', 'check', 'mobility', 'center'];

function getStonefishV4TestUnit4Move(game) {
  return getStonefishV4MoveWithOrder(game, STONEFISH_V4_TESTUNIT4_ORDER);
}
