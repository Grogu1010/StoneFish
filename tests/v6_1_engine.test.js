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

test('v6.1 evaluation cache returns exact scores and records cache hits', () => {
  stonefishV61ClearEvalCache();
  const game = new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
  const first = stonefishV61EvaluateRaw(game);
  const second = stonefishV61EvaluateRaw(game);
  const stats = stonefishV61EvalCacheStats();
  assert.equal(second, first);
  assert.ok(stats.hits >= 1, `Expected cache hit: ${JSON.stringify(stats)}`);
  assert.ok(stats.size >= 32768);
});

test('v6.1 indexed repetition history preserves legal move generation', () => {
  const game = new Chess();
  for (const [from,to] of [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']]) {
    assert.ok(game.move({ from, to }), `Failed setup move ${from}${to}`);
  }
  assert.ok(game.positionCounts.size > 1);
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
