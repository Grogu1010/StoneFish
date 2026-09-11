// Stonefish_v2(testunit2)
// Test-only variant of Stonefish_v2.
// Identical logic, except knights are valued at 3.1 instead of 3.

const STONEFISH_V2_TESTUNIT2_VALUES = {
  p: 1,
  n: 3.1,
  b: 3,
  r: 5,
  q: 9,
  k: 1000
};

function getStonefishV2TestUnit2Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_V2_TESTUNIT2_VALUES);
}
