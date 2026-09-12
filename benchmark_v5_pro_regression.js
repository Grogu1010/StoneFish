// Regression gate: optimized v5 Pro must behave exactly like the released Pro.
// Run from the current checkout with REFERENCE_DIR pointing at a checkout of main.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const engineFiles = [
  'StonefishChess.js',
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

function makeEngine(dir) {
  const ctx = vm.createContext({ console });
  const files = engineFiles.slice();
  for (const optional of ['Stonefish_v5_pro_geometry_patch.js', 'Stonefish_runtime_speed_patch.js']) {
    if (fs.existsSync(path.join(dir, optional))) files.push(optional);
  }
  const source = files
    .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n\n');
  vm.runInContext(source + `\n
    this.__Chess = Chess;
    this.__getPro = getStonefishV5ProMove;
    this.__getV5 = getStonefishV5Move;
    this.__setSeed = function(seed) {
      let x = seed >>> 0;
      Math.random = function() {
        x += 0x6D2B79F5;
        let t = x;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
  `, ctx, { filename: path.join(dir, 'stonefish-v5-pro-regression-bundle.js') });
  return ctx;
}

function play(engine, proIsWhite, seed, maxPlies = 600) {
  engine.__setSeed(seed);
  const game = new engine.__Chess();
  const trace = [];
  let plies = 0;
  let proNanos = 0n;
  let proMoves = 0;

  while (!game.game_over() && plies < maxPlies) {
    const proTurn = (game.side === 1) === proIsWhite;
    const start = process.hrtime.bigint();
    const move = proTurn ? engine.__getPro(game) : engine.__getV5(game);
    const elapsed = process.hrtime.bigint() - start;
    if (proTurn) {
      proNanos += elapsed;
      proMoves += 1;
    }
    if (!move) throw new Error(`No move at ply ${plies}`);
    trace.push(`${proTurn ? 'P' : '5'}:${move.from}${move.to}${move.promotion || ''}`);
    const played = game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    if (!played) throw new Error(`Invalid move ${trace[trace.length - 1]} at ply ${plies}`);
    plies += 1;
  }

  let result = 'draw';
  if (game.in_checkmate()) {
    const winnerIsWhite = game.side === -1;
    result = winnerIsWhite === proIsWhite ? 'pro-win' : 'pro-loss';
  }
  return {
    trace,
    plies,
    result,
    proAvgMs: proMoves ? Number(proNanos) / 1e6 / proMoves : 0
  };
}

const currentDir = process.cwd();
const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');

const reference = makeEngine(referenceDir);
const current = makeEngine(currentDir);
const games = Math.max(2, Number.parseInt(process.env.PARITY_GAMES || '2', 10) || 2);

let refMs = 0;
let curMs = 0;
for (let i = 0; i < games; i += 1) {
  const proIsWhite = i % 2 === 0;
  const seed = 0x5F50A11 + i * 977;
  const a = play(reference, proIsWhite, seed);
  const b = play(current, proIsWhite, seed);

  if (a.result !== b.result || a.plies !== b.plies || a.trace.length !== b.trace.length) {
    throw new Error(`Parity failure game ${i + 1}: released=${a.result}/${a.plies}, optimized=${b.result}/${b.plies}`);
  }
  for (let ply = 0; ply < a.trace.length; ply += 1) {
    if (a.trace[ply] !== b.trace[ply]) {
      throw new Error(`Move parity failure game ${i + 1} ply ${ply + 1}: released=${a.trace[ply]} optimized=${b.trace[ply]}`);
    }
  }

  refMs += a.proAvgMs;
  curMs += b.proAvgMs;
  console.log(`PARITY game=${i + 1} ${a.result} ${a.plies} plies released=${a.proAvgMs.toFixed(3)}ms optimized=${b.proAvgMs.toFixed(3)}ms`);
}

const summary = {
  games,
  exactTraceMatch: true,
  releasedAvgMs: refMs / games,
  optimizedAvgMs: curMs / games,
  ratio: refMs > 0 ? curMs / refMs : null
};
console.log('STONEFISH_V5_PRO_PARITY ' + JSON.stringify(summary));
