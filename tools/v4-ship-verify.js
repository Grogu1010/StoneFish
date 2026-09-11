const fs = require('fs');
const engine = fs.readFileSync('StonefishChess.js', 'utf8');
const v3 = fs.readFileSync('Stonefish_v3.js', 'utf8');
const v4 = fs.readFileSync('Stonefish_v4.js', 'utf8');

const harness = String.raw`
function seeded(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

function draw(g) {
  return g.halfmove >= 100 || g._insufficientMaterial() || (g.positionCounts.get(g.fastPositionKey()) || 0) >= 3;
}

function play(seed, max = 1000) {
  const g = new Chess();
  const v4White = (seed & 1) === 0;
  const r3 = seeded(0x9e3779b9 ^ (seed * 0x45d9f3b));
  const r4 = seeded(0x85ebca6b ^ (seed * 0x27d4eb2d));

  for (let ply = 0; ply < max; ply += 1) {
    const v4Turn = (g.turn() === 'w') === v4White;
    const oldRandom = Math.random;
    Math.random = v4Turn ? r4 : r3;
    const move = v4Turn ? getStonefishV4Move(g) : getStonefishV3Move(g);
    Math.random = oldRandom;

    if (!move) {
      if (!g.in_check()) return 'D';
      const whiteWon = g.turn() === 'b';
      return whiteWon === v4White ? 'W' : 'L';
    }

    g._applyRaw(move._raw, true);
    if (draw(g)) return 'D';
  }
  return 'D';
}

let W = 0, L = 0, D = 0;
for (let i = 0; i < 100; i += 1) {
  const result = play(90000 + i);
  if (result === 'W') W += 1;
  else if (result === 'L') L += 1;
  else D += 1;
}
console.log('SHIP VERIFY', { W, L, D });
if (W < 78 || L > 5) process.exitCode = 1;
`;

new Function(engine + '\n' + v3 + '\n' + v4 + '\n' + harness)();
