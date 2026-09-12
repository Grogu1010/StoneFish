// Verify that the one-pass root-knowledge implementation is numerically
// equivalent to the pre-fusion Pro root knowledge on ordinary legal positions.

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
  filename: 'stonefish-v5-pro-root-fusion-equivalence-bundle.js'
});

if (typeof stonefishV5ProRootFusionReferenceKnowledge !== 'function') {
  throw new Error('Root-fusion patch was not loaded');
}

function sameNumber(a, b) {
  return Object.is(a, b) || (
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9
  );
}

const game = new Chess();
let checks = 0;
let positions = 0;

for (let step = 0; step < 8 && !game.game_over(); step += 1) {
  const legal = game.fastMoves();
  if (!legal.length) break;
  const perspective = game.side;
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const indices = [0, Math.floor(legal.length / 2), legal.length - 1];
  const seen = new Set();

  for (const index of indices) {
    const raw = legal[index];
    const uci = stonefishV45RawUci(game, raw);
    if (seen.has(uci)) continue;
    seen.add(uci);
    const tactical = stonefishV5ProTacticalScoreExactFast(game, raw);
    const reference = stonefishV5ProRootFusionReferenceKnowledge(
      game, raw, heritageMove, bookMove, perspective, tactical
    );
    const fused = stonefishV5ProRootKnowledge(
      game, raw, heritageMove, bookMove, perspective, tactical
    );
    if (!sameNumber(reference, fused)) {
      throw new Error(
        `Root knowledge mismatch step=${step} move=${uci}: reference=${reference} fused=${fused}`
      );
    }
    checks += 1;
  }

  positions += 1;
  const advance = stonefishV5ScoreAllMoves(game);
  if (!advance.length) break;
  const rank = Math.min(advance.length - 1, step % Math.min(3, advance.length));
  const move = stonefishV3PublicMove(game, advance[rank].raw);
  if (!move || !game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' })) {
    throw new Error(`Could not advance root-fusion equivalence at step ${step}`);
  }
}

console.log('STONEFISH_V5_PRO_ROOT_FUSION_EQUIVALENCE ' + JSON.stringify({ positions, checks }));
