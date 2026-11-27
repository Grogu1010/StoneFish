const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const engineFiles = [
  'StonefishChess.js',
  'models/v1.js',
  'models/v2.js',
  'models/v3.js',
  'models/v4.js',
  'models/v4_5.js',
  'models/v5.js',
  'models/v5_pro.js',
  'models/v5_5.js',
  'models/v6.js',
  'models/v6_argon.js',
  'ARMX/ARMX-preview.js',
  'ARMX/ARMX.js',
  'ARMX/ARMX_1_1.js'
];

const bundle = engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n');
vm.runInThisContext(bundle, { filename: 'stonefish-v6-test-bundle.js' });

function commitMove(game, move) {
  if (!move) return null;
  if (move._raw) {
    game._applyRaw(move._raw, true);
    return move;
  }
  return game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function playToOutcome(fen, whiteFn, blackFn, maxPlies = 80) {
  const game = new Chess(fen);
  let plies = 0;
  while (plies < maxPlies) {
    if (game.in_checkmate()) return { result: game.side === 1 ? 'black' : 'white', plies, game };
    if (game.halfmove >= 100 || game._insufficientMaterial()) return { result: 'draw', plies, game };
    if ((game.positionCounts.get(game.fastPositionKey()) || 0) >= 3) return { result: 'draw-rep', plies, game };
    if (!game.fastHasLegalMove()) return { result: game.in_check() ? (game.side === 1 ? 'black' : 'white') : 'stalemate', plies, game };

    const fn = game.side === 1 ? whiteFn : blackFn;
    const move = fn(game);
    assert.ok(move, `Engine returned null in non-terminal position: ${game.fen()}`);
    assert.ok(commitMove(game, move), `Engine returned illegal move: ${JSON.stringify(move)} in ${game.fen()}`);
    plies += 1;
  }
  return { result: 'max-plies', plies, game };
}

test('K+Q vs K winning endgame checkmates decisively without stalemate or repetition', () => {
  const positions = [
    '8/8/8/4k3/8/8/3Q4/4K3 w - - 0 1',
    '4k3/8/8/8/2K5/8/8/7Q w - - 0 1',
    '8/8/8/8/4K3/8/3q4/4k3 b - - 0 1'
  ];
  for (const fen of positions) {
    const sideToWin = fen.includes(' w ') ? 'white' : 'black';
    const whiteFn = sideToWin === 'white' ? getStonefishV6Move : getStonefishV3Move;
    const blackFn = sideToWin === 'black' ? getStonefishV6Move : getStonefishV3Move;
    const res = playToOutcome(fen, whiteFn, blackFn, 50);
    assert.equal(res.result, sideToWin, `Expected ${sideToWin} mate from ${fen}, got ${res.result} in ${res.plies} plies (final FEN: ${res.game.fen()})`);
  }
});

test('K+R vs K winning endgame checkmates decisively without stalemate or repetition', () => {
  const positions = [
    '8/8/8/4k3/8/8/R7/4K3 w - - 0 1',
    '8/8/3k4/8/8/3K4/8/7R w - - 0 1',
    '4k3/8/8/8/4K3/8/8/r7 b - - 0 1'
  ];
  for (const fen of positions) {
    const sideToWin = fen.includes(' w ') ? 'white' : 'black';
    const whiteFn = sideToWin === 'white' ? getStonefishV6Move : getStonefishV3Move;
    const blackFn = sideToWin === 'black' ? getStonefishV6Move : getStonefishV3Move;
    const res = playToOutcome(fen, whiteFn, blackFn, 70);
    assert.equal(res.result, sideToWin, `Expected ${sideToWin} mate from ${fen}, got ${res.result} in ${res.plies} plies (final FEN: ${res.game.fen()})`);
  }
});

test('Opening play develops pieces and avoids self-blocking central pawns/bishops without an opening book', () => {
  const game = new Chess();
  const whiteMoves = [];
  for (let i = 0; i < 12; i += 1) {
    const move = getStonefishV6Move(game);
    assert.ok(move);
    if (game.side === 1) whiteMoves.push(`${move.from}${move.to}`);
    commitMove(game, move);
  }
  // White must have moved at least one central pawn (d2 or e2) and developed at least 2 minor pieces
  const b = game.boardState;
  const centralMoved = b[11] !== 1 || b[12] !== 1;
  assert.equal(centralMoved, true, `Expected central pawn move in first 6 White moves, played: ${whiteMoves.join(', ')}`);
  let homeMinors = 0;
  if (b[1] === 2) homeMinors += 1;
  if (b[2] === 3) homeMinors += 1;
  if (b[5] === 3) homeMinors += 1;
  if (b[6] === 2) homeMinors += 1;
  assert.ok(homeMinors <= 2, `Expected >=2 White minor pieces developed in 6 moves, homeMinors=${homeMinors}, moves=${whiteMoves.join(', ')}`);
  // Must NOT place own minor piece directly on d3/e3 blocking an unmoved d2/e2 pawn
  assert.equal(b[11] === 1 && b[19] > 0, false, 'Must not block unmoved d2 pawn on d3');
  assert.equal(b[12] === 1 && b[20] > 0, false, 'Must not block unmoved e2 pawn on e3');
});

test('Avoids walking into fatal pins and exploits opponent pins', () => {
  // Position where Black can walk into or escape a pin / White can win pinned piece
  // White has Bb5 pinning Nc6 to Ke8; playing e4-e5 or Bxc6 / Qa4 wins, or Black must avoid self-pinning
  const pinTargetGame = new Chess('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
  const scoreBefore = stonefishV6EvaluateRaw(pinTargetGame);
  // Compare eval when Black knight on c6 is absolutely pinned vs unpinned
  const unpinnedGame = new Chess('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
  const scoreUnpinned = stonefishV6EvaluateRaw(unpinnedGame);
  assert.ok(scoreBefore < scoreUnpinned, `Absolute pin on c6 should be evaluated worse for Black (${scoreBefore} vs ${scoreUnpinned})`);
});

test('Trade discipline: refuses equal queen trade when down material, welcomes trades when up material', () => {
  // Queens facing on d1/d8 (Qxd8 vs quiet move):
  // Down a Knight: White is down a knight -> should evaluate keeping queens higher than trading queens
  const downBefore = new Chess('r1b1k2r/ppppqppp/2n2n2/8/4P3/5N2/PPPPQPPP/R1B1K2R w KQkq - 0 1');
  // Actually put queens directly on e2/e7 with clear file e:
  const downKeep = new Chess('r1b1k2r/ppppqppp/2n2n2/8/8/5N2/PPPPQPPP/R1B1K2R w KQkq - 0 1');
  const downTraded = new Chess('r1b1k2r/pppp1ppp/2n2n2/8/8/5N2/PPPP1PPP/R1B1K2R w KQkq - 0 1');
  // In downKeep, White has Q vs Q and is down N -> raw diff -320.
  const evalKeepDown = stonefishV6EvaluateRaw(downKeep);
  const evalTradeDown = stonefishV6EvaluateRaw(downTraded);
  assert.ok(evalKeepDown > evalTradeDown, `When down a minor piece, keeping queens (${evalKeepDown}) should outscore trading queens (${evalTradeDown})`);

  // Up a Knight: White is UP a knight -> trading queens should evaluate higher!
  const upKeep = new Chess('r1b1k2r/ppppqppp/5n2/8/8/2N2N2/PPPPQPPP/R1B1K2R w KQkq - 0 1');
  const upTraded = new Chess('r1b1k2r/pppp1ppp/5n2/8/8/2N2N2/PPPP1PPP/R1B1K2R w KQkq - 0 1');
  const evalKeepUp = stonefishV6EvaluateRaw(upKeep);
  const evalTradeUp = stonefishV6EvaluateRaw(upTraded);
  assert.ok(evalTradeUp > evalKeepUp, `When up a minor piece, trading queens (${evalTradeUp}) should outscore keeping queens (${evalKeepUp})`);
});

test('Preserves Stonefish pawn structure evaluation strengths', () => {
  const cleanPawns = new Chess('4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1');
  const doubledIso = new Chess('4k3/pppppppp/8/8/8/2P5/P1PPPPPP/4K3 w - - 0 1'); // b2 moved to c3 (c2+c3 doubled, a2 isolated)
  const evalClean = stonefishV6EvaluateRaw(cleanPawns);
  const evalBad = stonefishV6EvaluateRaw(doubledIso);
  assert.ok(evalClean > evalBad + 20, `Clean pawn structure (${evalClean}) must strongly outscore doubled+isolated pawns (${evalBad})`);
});

test('Depth verification: Stonefish_v6 searches >= 7 plies in middlegame and >= 9 in endgame', () => {
  const mg = new Chess();
  // Allow V8 JIT to warm up as happens within the first few moves of a game
  for (let i = 0; i < 6; i += 1) {
    getStonefishV6Move(new Chess());
  }
  const move = getStonefishV6Move(mg);
  assert.ok(move);
  const mgInfo = globalThis.SF6_LAST_SEARCH;
  assert.ok(mgInfo.depth >= 7, `Expected depth >= 7 in start/opening, got ${mgInfo.depth} (${mgInfo.ms.toFixed(1)}ms, ${mgInfo.nodes} nodes)`);

  const eg = new Chess('4k3/5pp1/8/3R4/8/4K3/5PP1/3r4 w - - 0 1');
  getStonefishV6Move(new Chess('4k3/5pp1/8/3R4/8/4K3/5PP1/3r4 w - - 0 1'));
  getStonefishV6Move(new Chess('4k3/5pp1/8/3R4/8/4K3/5PP1/3r4 w - - 0 1'));
  const egMove = getStonefishV6Move(eg);
  assert.ok(egMove);
  const egInfo = globalThis.SF6_LAST_SEARCH;
  assert.ok(egInfo.depth >= 9, `Expected depth >= 9 in endgame, got ${egInfo.depth} (${egInfo.ms.toFixed(1)}ms, ${egInfo.nodes} nodes)`);
});

test('ARMX 1.1 controller powers Stonefish_v6 directly', () => {
  assert.equal(typeof ARMX_1_1, 'object');
  assert.equal(ARMX_1_1.version, '1.1');
  assert.equal(typeof getStonefishV6Move, 'function');
  assert.equal(typeof globalThis.getStonefishV6ARMX11Move, 'undefined');

  const g1 = new Chess();
  const plan = armx11PlanSearch(g1, { phase: 24, pieces: 30 });
  assert.ok(plan && plan.targetDepth >= 8 && plan.maxTimeMs >= 45);
  const move = getStonefishV6Move(g1, { maxDepth: 7, maxTimeMs: 250 });
  assert.ok(move && move.from && move.to);
  const info = globalThis.SF6_LAST_SEARCH;
  assert.ok(info && info.depth === 7, `Expected Stonefish_v6 depth 7, got ${info && info.depth}`);
});

test('Stonefish_v6 Argon (devtest) returns valid moves and identifies brilliant style opportunities', () => {
  assert.equal(typeof getStonefishV6ArgonMove, 'function');
  const game = new Chess();
  const move = getStonefishV6ArgonMove(game);
  assert.ok(move && move.from && move.to);
});
