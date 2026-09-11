// Stonefish_v2(testunit1)
// Test-only variant of Stonefish_v2.
// Identical logic, except bishops are valued at 3.1 instead of 3.

const STONEFISH_V2_TESTUNIT1_VALUES = {
  p: 1,
  n: 3,
  b: 3.1,
  r: 5,
  q: 9,
  k: 1000
};

function getStonefishV2TestUnit1Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_V2_TESTUNIT1_VALUES);
}
