// Stonefish_v3(testunit2)
// Own bishops remain 3.1. Opponent bishops are 3.0 and opponent knights are 3.1.

const STONEFISH_V3_TESTUNIT2_OPPONENT_VALUES = { p: 1, n: 3.1, b: 3, r: 5, q: 9, k: 1000 };

function getStonefishV3TestUnit2Move(game) {
  return getStonefishV3MoveWithValues(
    game,
    STONEFISH_V3_OWN_VALUES,
    STONEFISH_V3_TESTUNIT2_OPPONENT_VALUES
  );
}
