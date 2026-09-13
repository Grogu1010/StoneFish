const fs = require('fs');
const path = require('path');
const vm = require('vm');

const baseFiles = [
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
  'Stonefish_v5_pro_speed_patch.js',
  'Stonefish_v5_pro_geometry_patch.js',
  'Stonefish_runtime_speed_patch.js'
];

function makeEngine(dir, experiment) {
  const files = baseFiles.slice();
  if (experiment) files.push('Stonefish_fast_moves_experiment.js');
  const ctx = vm.createContext({ console });
  vm.runInContext(files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n\n') + '\nthis.__Chess = Chess;', ctx);
  return ctx;
}

function seededRandom(seed) {
  let x = seed >>> 0;
  return function() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function key(m) {
  return `${m.from}:${m.to}:${m.promotion || 0}:${m.flags || 0}:${m.piece || 0}:${m.captured || 0}`;
}

const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');
const reference = makeEngine(referenceDir, false);
const candidate = makeEngine(process.cwd(), true);
let positions = 0;
let legalMoves = 0;
let inCheck = 0;
const histories = [];

for (let line = 0; line < 100; line += 1) {
  const a = new reference.__Chess();
  const b = new candidate.__Chess();
  const random = seededRandom(0xF457 + line * 0x9E3779B1);
  for (let ply = 0; ply < 50; ply += 1) {
    const am = a.fastMoves();
    const bm = b.fastMoves();
    positions += 1;
    if (a.in_check()) inCheck += 1;
    if (am.length !== bm.length) throw new Error(`count mismatch line=${line} ply=${ply}: ${am.length} vs ${bm.length}`);
    for (let i = 0; i < am.length; i += 1) {
      if (key(am[i]) !== key(bm[i])) throw new Error(`move mismatch line=${line} ply=${ply} index=${i}: ${key(am[i])} vs ${key(bm[i])}`);
    }
    legalMoves += am.length;
    if (positions <= 1200) histories.push({ line, ply, moves: am.length });
    if (!am.length) break;
    const index = Math.floor(random() * am.length);
    a._applyRaw(am[index], true);
    b._applyRaw(bm[index], true);
    if (a.halfmove >= 100 || a._insufficientMaterial()) break;
  }
}

function buildGames(Engine, count) {
  const games = [];
  for (let line = 0; line < count; line += 1) {
    const g = new Engine.__Chess();
    const random = seededRandom(0x9157 + line * 0x7F4A7C15);
    for (let ply = 0; ply < 18 + (line % 12); ply += 1) {
      const moves = g.fastMoves();
      if (!moves.length) break;
      g._applyRaw(moves[Math.floor(random() * moves.length)], true);
    }
    games.push(g);
  }
  return games;
}

const refGames = buildGames(reference, 600);
const candGames = buildGames(candidate, 600);
function time(games) {
  const start = process.hrtime.bigint();
  let count = 0;
  for (let repeat = 0; repeat < 8; repeat += 1) {
    for (const g of games) count += g.fastMoves().length;
  }
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, count };
}
const rt = time(refGames);
const ct = time(candGames);
if (rt.count !== ct.count) throw new Error(`timing move-count mismatch ${rt.count} vs ${ct.count}`);
console.log('STONEFISH_FAST_MOVES_PARITY ' + JSON.stringify({
  positions,
  legalMoves,
  inCheck,
  timingCalls: 600 * 8,
  referenceMs: rt.ms,
  candidateMs: ct.ms,
  speedup: rt.ms / ct.ms,
  status: 'PASS'
}));
