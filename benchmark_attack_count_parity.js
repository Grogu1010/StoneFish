// Direct parity/performance check for the Pro attack-count map optimization.
// Compare every square for both sides against the released reverse-ray function
// across deterministic legal positions before allowing the optimized wrapper.

const fs = require('fs');
const vm = require('vm');

const engineFiles = [
  'StonefishChess.js',
  'Stonefish_v1.js',
  'Stonefish_v2.js',
  'Stonefish_v3.js',
  'Stonefish_v4.js',
  'Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js',
  'Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js',
  'Stonefish_v5.js',
  'Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js'
];

if (fs.existsSync('Stonefish_v5_pro_geometry_patch.js')) engineFiles.push('Stonefish_v5_pro_geometry_patch.js');

const ctx = vm.createContext({ console, Uint8Array, Int8Array, Map, Math });
const engineSource = engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n');
vm.runInContext(engineSource + `\n
  this.__Chess = Chess;
  this.__releasedAttackCount = stonefishV5ProAttackCount;
`, ctx, { filename: 'stonefish-attack-count-base.js' });

vm.runInContext(fs.readFileSync('Stonefish_runtime_speed_patch.js', 'utf8') + `\n
  this.__optimizedAttackCount = stonefishV5ProAttackCount;
`, ctx, { filename: 'Stonefish_runtime_speed_patch.js' });

function seededRandom(seed) {
  let x = seed >>> 0;
  return function random() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seededRandom(0x5f17a44c);
const positionsTarget = Number.parseInt(process.env.ATTACK_PARITY_POSITIONS || '220', 10);
const maxPlies = 180;
let positions = 0;
let comparisons = 0;
let releasedNs = 0n;
let optimizedNs = 0n;

function checkPosition(game) {
  const released = new Uint8Array(128);
  let out = 0;

  let start = process.hrtime.bigint();
  for (const side of [1, -1]) {
    for (let sq = 0; sq < 64; sq += 1) released[out++] = ctx.__releasedAttackCount(game, sq, side);
  }
  releasedNs += process.hrtime.bigint() - start;

  out = 0;
  start = process.hrtime.bigint();
  for (const side of [1, -1]) {
    for (let sq = 0; sq < 64; sq += 1) {
      const actual = ctx.__optimizedAttackCount(game, sq, side);
      const expected = released[out++];
      comparisons += 1;
      if (actual !== expected) {
        throw new Error(`attack-count mismatch position=${positions} side=${side} sq=${sq} expected=${expected} actual=${actual}`);
      }
    }
  }
  optimizedNs += process.hrtime.bigint() - start;
  positions += 1;
}

while (positions < positionsTarget) {
  const game = new ctx.__Chess();
  checkPosition(game);

  for (let ply = 0; ply < maxPlies && positions < positionsTarget; ply += 1) {
    const moves = game.fastMoves();
    if (!moves.length) break;
    const move = moves[Math.floor(random() * moves.length)];
    game.fastApply(move);
    checkPosition(game);
  }
}

const releasedMs = Number(releasedNs) / 1e6;
const optimizedMs = Number(optimizedNs) / 1e6;
const speedup = optimizedMs > 0 ? releasedMs / optimizedMs : Infinity;
console.log(JSON.stringify({
  type: 'STONEFISH_PRO_ATTACK_COUNT_PARITY',
  positions,
  comparisons,
  releasedMs: Number(releasedMs.toFixed(3)),
  optimizedMs: Number(optimizedMs.toFixed(3)),
  speedup: Number(speedup.toFixed(3)),
  status: 'PASS'
}));
