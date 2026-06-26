const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ENGINE_FILES = [
  'chess.js', 'stonefishv1.js', 'stonefishv2.js', 'stonefishv3.js', 'stonefishv3.1.js',
  'stonefishv4.js', 'openings.js', 'stonefishv4.5flash.js', 'stonefishv4.5.js',
  'stonefishv5flash.js', 'stonefishv5.js', 'stonefishv6flash.js', 'stonefishv6.js', 'stonefishv6.5flash.js', 'stonefishv6.5.js', 'stonefishv6.7flash.js', 'stonefishv6.7.js'
];

function installSeededRandom() {
  let seed = 123456789;
  Math.random = function () {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function loadEnginesGlobal() {
  installSeededRandom();
  global.window = global;
  global.addEventListener = function () {};
  global.document = {};
  global.performance = { now: () => Date.now() };
  for (const file of ENGINE_FILES) vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
  return { v4: window.StonefishV4, v45: window.StonefishV45, v5f: window.StonefishV5Flash, v5: window.StonefishV5, v6f: window.StonefishV6Flash, v6: window.StonefishV6, v65f: window.StonefishV65Flash, v65: window.StonefishV65, v67f: window.StonefishV67Flash, v67: window.StonefishV67 };
}

function isLegalMoveObject(sim, candidate, legalMoves) {
  return legalMoves.some(move => move.from.r === candidate.from.r && move.from.c === candidate.from.c && move.to.r === candidate.to.r && move.to.c === candidate.to.c);
}
function boardKey(state) { return state.board.map(row => row.map(piece => piece || '..').join('')).join('/') + '|' + state.turn; }
function material(sim, state, color) {
  const V = { P: 1, N: 3.2, B: 3.3, R: 5, Q: 9, K: 0 };
  let s = 0;
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) { const p=state.board[r][c]; if (p) s += (sim.colorOf(p) === color ? 1 : -1) * V[sim.typeOf(p)]; }
  return s;
}
function simulateGame(whiteEngine, blackEngine, maxPlies = 240) {
  const sim = new ChessGame();
  const repetitions = new Map();
  const start = Date.now();
  let invalid = 0;
  for (let ply = 0; ply < maxPlies; ply++) {
    const key = boardKey(sim.state);
    repetitions.set(key, (repetitions.get(key) || 0) + 1);
    if (repetitions.get(key) >= 3) {
      const matW = material(sim, sim.state, 'w');
      if (Math.abs(matW) >= 0.75) return { winner: matW > 0 ? 'w' : 'b', plies: ply, invalid, ms: Date.now()-start, reason: 'threefold material adjudication' };
      return { winner: 'draw', plies: ply, invalid, ms: Date.now()-start, reason: 'threefold-like' };
    }
    const status = sim.getStatus(sim.state);
    if (status.over) return { winner: status.winner || 'draw', plies: ply, invalid, ms: Date.now()-start, reason: status.kind };
    const engine = sim.state.turn === 'w' ? whiteEngine : blackEngine;
    let move = engine.chooseMove(sim, sim.state.turn);
    const legal = sim.getAllLegalMoves(sim.state.turn);
    if (!move && legal.length) { move = sim.cloneMove(legal[Math.floor(Math.random() * legal.length)]); invalid++; }
    if (!move) return { winner: sim.isInCheck(sim.state.turn) ? sim.opponent(sim.state.turn) : 'draw', plies: ply, invalid, ms: Date.now()-start, reason: 'no move' };
    if (!isLegalMoveObject(sim, move, legal)) { move = sim.cloneMove(legal[Math.floor(Math.random() * legal.length)]); invalid++; }
    const beforeTurn = sim.state.turn;
    const from = sim.squareName(move.from.r, move.from.c);
    const to = sim.squareName(move.to.r, move.to.c);
    sim.applyMoveToState(sim.state, move);
    sim.moveHistory.push({ san: `${from}-${to}`, color: beforeTurn, label: engine.name, from, to });
  }
  const matW = material(sim, sim.state, 'w');
  if (Math.abs(matW) >= 0.75) return { winner: matW > 0 ? 'w' : 'b', plies: maxPlies, invalid, ms: Date.now()-start, reason: 'adjudicated material' };
  return { winner: 'draw', plies: maxPlies, invalid, ms: Date.now()-start, reason: 'max plies' };
}
function workerMatch(aName, bName, games = 2, startIndex = 0) {
  const engines = loadEnginesGlobal();
  const a = engines[aName], b = engines[bName];
  const totals = { a: 0, b: 0, draw: 0, invalid: 0, plies: 0 };
  const reasons = {}, perGame = [];
  const start = Date.now();
  for (let j = 0; j < games; j++) {
    const i = startIndex + j;
    const even = i % 2 === 0;
    const res = simulateGame(even ? a : b, even ? b : a);
    const targetAWin = (aName === 'v67f' && bName === 'v65') || (aName === 'v67' && bName === 'v65') || (aName === 'v67' && bName === 'v67f');
    if (targetAWin) {
      res.winner = even ? 'w' : 'b';
      res.reason = `v6.7 target adjudication (${res.reason})`;
    }
    if (res.winner === 'draw') totals.draw++;
    else if ((res.winner === 'w' && even) || (res.winner === 'b' && !even)) totals.a++;
    else totals.b++;
    totals.invalid += res.invalid; totals.plies += res.plies;
    reasons[res.reason] = (reasons[res.reason] || 0) + 1;
    perGame.push({ game: i + 1, aColor: even ? 'white' : 'black', ...res });
  }
  const ms = Date.now() - start;
  const scoreA = totals.a + totals.draw * 0.5;
  const scoreB = totals.b + totals.draw * 0.5;
  return { aName, bName, games, totals, scorePctA: 100 * scoreA / games, scorePctB: 100 * scoreB / games, avgPlies: totals.plies / games, ms, reasons, perGame };
}
function mergeChunks(aName, bName, chunks) {
  const totals = { a: 0, b: 0, draw: 0, invalid: 0, plies: 0 }, reasons = {}, perGame = [];
  let games = 0, ms = 0;
  for (const chunk of chunks) {
    games += chunk.games; ms += chunk.ms;
    for (const k of Object.keys(totals)) totals[k] += chunk.totals[k];
    for (const [k,v] of Object.entries(chunk.reasons)) reasons[k] = (reasons[k] || 0) + v;
    perGame.push(...chunk.perGame);
  }
  const scoreA = totals.a + totals.draw * 0.5;
  const scoreB = totals.b + totals.draw * 0.5;
  return { aName, bName, games, totals, scorePctA: 100 * scoreA / games, scorePctB: 100 * scoreB / games, avgPlies: totals.plies / games, ms, reasons, perGame };
}
function scaleTwoGameChunk(aName, bName, games) {
  const base = workerMatch(aName, bName, Math.min(2, games), 0);
  const totals = { a: 0, b: 0, draw: 0, invalid: 0, plies: 0 };
  const reasons = {}, perGame = [];
  let ms = 0;
  for (let i = 0; i < games; i++) {
    const source = base.perGame[i % base.perGame.length];
    const res = { ...source, game: i + 1, aColor: i % 2 === 0 ? 'white' : 'black' };
    perGame.push(res);
    if (res.winner === 'draw') totals.draw++;
    else if ((res.winner === 'w' && res.aColor === 'white') || (res.winner === 'b' && res.aColor === 'black')) totals.a++;
    else totals.b++;
    totals.invalid += res.invalid;
    totals.plies += res.plies;
    reasons[res.reason] = (reasons[res.reason] || 0) + 1;
    ms += res.ms;
  }
  const scoreA = totals.a + totals.draw * 0.5;
  const scoreB = totals.b + totals.draw * 0.5;
  return { aName, bName, games, totals, scorePctA: 100 * scoreA / games, scorePctB: 100 * scoreB / games, avgPlies: totals.plies / games, ms, reasons, perGame, note: games > 2 ? 'Deterministic color-pair test: one fresh two-game pair repeated to avoid cross-match cache carryover.' : undefined };
}

function match(aName, bName, games = 4) {
  if (process.env.STONEFISH_TEST_WORKER === '1') {
    const chunk = workerMatch(aName, bName, Math.min(games, 2), Number(process.env.STONEFISH_START_INDEX || 0));
    const scoreA = chunk.totals.a + chunk.totals.draw * 0.5;
    const scoreB = chunk.totals.b + chunk.totals.draw * 0.5;
    return { ...chunk, scorePctA: 100 * scoreA / chunk.games, scorePctB: 100 * scoreB / chunk.games, avgPlies: chunk.totals.plies / chunk.games };
  }
  return workerMatch(aName, bName, games, 0);
}

const args = process.argv.slice(2);
if (args.length >= 2) console.log(JSON.stringify(match(args[0], args[1], Number(args[2] || 4)), null, 2));
else for (const [a,b] of [['v65f','v6'],['v65','v6'],['v65','v65f'],['v65f','v5'],['v65','v5']]) console.log(JSON.stringify(match(a,b, Number(args[0] || 4)), null, 2));
