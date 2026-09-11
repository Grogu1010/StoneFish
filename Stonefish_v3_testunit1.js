// Stonefish_v3(testunit1)
// Own bishops remain 3.1. Opponent bishops are treated as 3.0,
// making opponent bishops equal to opponent knights.

const STONEFISH_V3_TESTUNIT1_OPPONENT_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 1000 };

function getStonefishV3TestUnit1Move(game) {
  return getStonefishV3MoveWithValues(
    game,
    STONEFISH_V3_OWN_VALUES,
    STONEFISH_V3_TESTUNIT1_OPPONENT_VALUES
  );
}
