// Verify that the recovery optimizations preserve the released scoring math
// they replace: full adaptive leaf evaluation and v5 three-ply tactical score.

const fs = require('fs');
const vm = require('vm');

const files = [
  'StonefishChess.js',
  'Stonefish_v3.js',
  'Stonefish_v4.js',
  'Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js',
  'Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js',
  'Stonefish_v5.js',
  'Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js',
  'Stonefish_v5_pro_geometry_patch.js'
];

vm.runInThisContext(files.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-v5-pro-recovery-equivalence-bundle.js'
});

function sameNumber(a, b) {
  if (Object.is(a, b)) return true;
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9;
}

function uci(game, move) {
  return stonefishV45RawUci(game, move);
}

const game = new Chess();
let positions = 0;
let tacticalChecks = 0;
let adaptiveChecks = 0;

for (let step = 0; step < 8 && !game.game_over(); step += 1) {
  const perspectives = [game.side, -game.side];
  for (const perspective of perspectives) {
    const reference = stonefishV5ProRecoveryReferenceAdaptive(game, perspective);
    const fused = stonefishV5ProAdaptivePosition(game, perspective);
    if (!sameNumber(reference, fused)) {
      throw new Error(`Adaptive mismatch step=${step} perspective=${perspective}: reference=${reference} fused=${fused}`);
    }
    adaptiveChecks += 1;
  }

  const legal = game.fastMoves();
  const sample = [];
  if (legal.length) {
    sample.push(legal[0]);
    if (legal.length > 1) sample.push(legal[Math.floor(legal.length / 3)]);
    if (legal.length > 2) sample.push(legal[Math.floor(legal.length * 2 / 3)]);
    if (legal.length > 3) sample.push(legal[legal.length - 1]);
  }

  const seen = new Set();
  for (const move of sample) {
    const key = uci(game, move);
    if (seen.has(key)) continue;
    seen.add(key);
    const reference = stonefishV5ProRecoveryReferenceTactical(game, move);
    const fast = stonefishV5ProTacticalScoreExactFast(game, move);
    if (!sameNumber(reference, fast)) {
      throw new Error(`Tactical mismatch step=${step} move=${key}: reference=${reference} fast=${fast}`);
    }
    tacticalChecks += 1;
  }

  positions += 1;
  const scored = stonefishV5ScoreAllMoves(game);
  if (!scored.length) break;
  const rank = Math.min(scored.length - 1, step % Math.min(3, scored.length));
  const move = stonefishV3PublicMove(game, scored[rank].raw);
  if (!move || !game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' })) {
    throw new Error(`Could not advance equivalence position at step ${step}`);
  }
}

console.log('STONEFISH_V5_PRO_RECOVERY_EQUIVALENCE ' + JSON.stringify({
  positions,
  tacticalChecks,
  adaptiveChecks
}));
