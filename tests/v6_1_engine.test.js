const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const engineFiles = [
  'StonefishChess.js','models/v1.js','models/v2.js','models/v3.js','models/v4.js',
  'models/v4_5.js','models/v5.js','models/v5_pro.js','models/v5_5.js',
  'models/v6.js','models/v6_1.js','ARMX/ARMX-preview.js','ARMX/ARMX.js','ARMX/ARMX_1_1.js'
];
vm.runInThisContext(engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-v6_1-test-bundle.js'
});
const FIXED_SEARCH = { maxDepth: 5, maxTimeMs: 8000, softNodes: 2000000, hardNodes: 3000000 };

function mirrorFenByRank(fen) {
  const [placement, turn, castling, ep, halfmove = '0', fullmove = '1'] = fen.split(/\s+/);
  const sourceRows = placement.split('/');
  if (sourceRows.length !== 8) throw new Error('Invalid FEN placement: ' + placement);
  const rows = [];

  for (let newRank = 7; newRank >= 0; newRank -= 1) {
    const expanded = [];
    for (const ch of sourceRows[newRank]) {
      if (/^[1-8]$/.test(ch)) {
        for (let n = 0; n < Number(ch); n += 1) expanded.push('');
      } else {
        expanded.push(ch);
      }
    }
    if (expanded.length !== 8) throw new Error('Invalid FEN rank: ' + sourceRows[newRank]);
    let out = '';
    let empty = 0;
    for (const ch of expanded) {
      if (!ch) {
        empty += 1;
        continue;
      }
      if (empty) { out += empty; empty = 0; }
      out += ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    }
    if (empty) out += empty;
    rows.push(out);
  }

  let mirroredRights = '';
  if (castling.includes('k')) mirroredRights += 'K';
  if (castling.includes('q')) mirroredRights += 'Q';
  if (castling.includes('K')) mirroredRights += 'k';
  if (castling.includes('Q')) mirroredRights += 'q';

  let mirroredEp = '-';
  if (ep !== '-') {
    const file = ep.charCodeAt(0) - 97;
    const rank = Number(ep[1]) - 1;
    mirroredEp = String.fromCharCode(97 + file) + String(8 - rank);
  }

  return [
    rows.join('/'),
    turn === 'w' ? 'b' : 'w',
    mirroredRights || '-',
    mirroredEp,
    halfmove,
    fullmove
  ].join(' ');
}


test('v6.1 static evaluation is exactly equal to v6 on representative positions', () => {
  const positions = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    'r1b1k2r/ppppqppp/2n2n2/8/8/5N2/PPPPQPPP/R1B1K2R w KQkq - 0 1',
    '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1',
    '8/8/8/4k3/8/8/3Q4/4K3 w - - 0 1',
    '4k3/5pp1/8/3R4/8/4K3/5PP1/3r4 w - - 0 1'
  ];
  for (const fen of positions) {
    const game = new Chess(fen);
    assert.equal(stonefishV61EvaluateRaw(game), stonefishV6EvaluateRaw(game), `Evaluation mismatch: ${fen}`);
  }
});

test('v6.1 static evaluation is invariant under rank flip and colour swap', () => {
  const positions = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    'r2q1rk1/pp2bppp/2n1pn2/2bp4/3P4/2NBPN2/PPP2PPP/R1BQ1RK1 w - - 0 9',
    'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 2 8',
    '8/5pk1/6p1/3R4/8/4K3/5PP1/8 w - - 0 1',
    '4k3/5pp1/8/3R4/8/4K3/5PP1/3r4 w - - 0 1'
  ];

  for (const fen of positions) {
    const original = new Chess(fen);
    const mirroredFen = mirrorFenByRank(fen);
    const mirrored = new Chess(mirroredFen);
    const originalScore = stonefishV61EvaluateRaw(original);
    const mirroredScore = stonefishV61EvaluateRaw(mirrored);
    assert.equal(
      mirroredScore,
      originalScore,
      'Colour/rank symmetry mismatch for ' + fen + ' vs ' + mirrored.fen()
    );
  }
});

test('v6.1 evaluation cache returns exact scores and records cache hits', () => {
  stonefishV61ClearEvalCache();
  const game = new Chess('r3k2r/ppp2ppp/2n1pn2/3p4/3P4/2NBPN2/PPP2PPP/R2Q1RK1 w kq - 0 1');
  const first = stonefishV61EvaluateRaw(game);
  const second = stonefishV61EvaluateRaw(game);
  const stats = stonefishV61EvalCacheStats();
  assert.equal(second, first);
  assert.ok(stats.hits >= 1, `Expected cache hit: ${JSON.stringify(stats)}`);
  assert.ok(stats.size >= 32768);
});

test('v6.1 reuses exact evaluation-cache entries in dense opening positions', () => {
  stonefishV61ClearEvalCache();
  const game = new Chess();
  const first = stonefishV61EvaluateRaw(game);
  const second = stonefishV61EvaluateRaw(game);
  assert.equal(first, second);
  const stats = stonefishV61EvalCacheStats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
  assert.equal(stats.size, 1 << 18);
});

test('v6.1 uses exact evaluation caching in low-material endgames', () => {
  stonefishV61ClearEvalCache();
  const game = new Chess('8/5pk1/6p1/3R4/8/4K3/5PP1/8 w - - 0 1');
  const first = stonefishV61EvaluateRaw(game);
  const second = stonefishV61EvaluateRaw(game);
  assert.equal(second, first);
  const stats = stonefishV61EvalCacheStats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
  assert.equal(stats.size, 1 << 18);
});

test('v6.1 indexed repetition history preserves legal move generation', () => {
  const game = new Chess();
  for (let ply=0; ply<32; ply++) {
    const moves = game.fastMoves();
    assert.ok(moves.length, `No legal moves while constructing history at ply ${ply}`);
    game._applyRaw(moves[(ply * 29 + 5) % moves.length], true);
  }
  assert.ok(game.positionCounts.size > 8, `Expected substantial root history, got ${game.positionCounts.size} entries`);
  const move = getStonefishV61Move(game, FIXED_SEARCH);
  assert.ok(move && game.fastMoves().some(raw =>
    game._alg(raw.from) === move.from && game._alg(raw.to) === move.to
  ), `v6.1 returned an illegal move: ${JSON.stringify(move)}`);
});

test('v6.1 preserves v6 fixed search depth and returns a legal move', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const v6Game = new Chess(fen), v61Game = new Chess(fen);
  getStonefishV6Move(new Chess(), { ...FIXED_SEARCH, maxDepth: 3 });
  getStonefishV61Move(new Chess(), { ...FIXED_SEARCH, maxDepth: 3 });
  const t0 = performance.now(), v6Move = getStonefishV6Move(v6Game, FIXED_SEARCH);
  const v6WallMs = performance.now() - t0, v6Info = globalThis.SF6_LAST_SEARCH;
  const t1 = performance.now(), v61Move = getStonefishV61Move(v61Game, FIXED_SEARCH);
  const v61WallMs = performance.now() - t1, v61Info = globalThis.SF61_LAST_SEARCH;
  assert.ok(v6Move && v61Move);
  assert.equal(v61Info.depth, v6Info.depth, `Depth changed: v6=${v6Info.depth}, v6.1=${v61Info.depth}`);
  assert.equal(v61Info.depth, FIXED_SEARCH.maxDepth);
  assert.ok(v61Game.fastMoves().some(raw =>
    v61Game._alg(raw.from) === v61Move.from && v61Game._alg(raw.to) === v61Move.to
  ));
  console.log(JSON.stringify({
    benchmark: 'StoneFish v6 vs v6.1', depth: v61Info.depth,
    v6: { ms: Number(v6Info.ms.toFixed(2)), wallMs: Number(v6WallMs.toFixed(2)), nodes: v6Info.nodes },
    v61: { ms: Number(v61Info.ms.toFixed(2)), wallMs: Number(v61WallMs.toFixed(2)), nodes: v61Info.nodes,
      evalCacheHits: v61Info.evalCacheHits, evalCacheMisses: v61Info.evalCacheMisses,
      evalCacheHitRate: Number(v61Info.evalCacheHitRate.toFixed(4)) },
    speedRatio: Number((v6Info.ms / Math.max(0.001,v61Info.ms)).toFixed(3))
  }));
});
