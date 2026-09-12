// Honest head-to-head: current v5 Pro vs the released v5 Pro on main.
// Run from the current checkout with REFERENCE_DIR pointing at a checkout of main.
// Normal legal play only. No result rewriting, adjudication, or forced outcomes.

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
  const source = engineFiles.map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n\n');
  vm.runInContext(source + `\n
    this.__Chess = Chess;
    this.__getPro = getStonefishV5ProMove;
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
  `, ctx, { filename: path.join(dir, 'stonefish-v5-pro-head-to-head-bundle.js') });
  return ctx;
}

function applyMove(game, move) {
  return move ? game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }) : null;
}

function simulateGame(currentEngine, referenceEngine, currentIsWhite, seed, maxPlies = 600) {
  currentEngine.__setSeed(seed ^ 0x9E3779B9);
  referenceEngine.__setSeed(seed ^ 0x85EBCA6B);
  const currentGame = new currentEngine.__Chess();
  const referenceGame = new referenceEngine.__Chess();
  let plies = 0;
  const trace = [];

  while (!currentGame.game_over() && plies < maxPlies) {
    const currentTurn = (currentGame.side === 1) === currentIsWhite;
    const engine = currentTurn ? currentEngine : referenceEngine;
    const engineGame = currentTurn ? currentGame : referenceGame;
    const move = engine.__getPro(engineGame);
    if (!move) {
      return {
        result: currentTurn ? 'loss' : 'win',
        reason: currentTurn ? 'current-no-move' : 'released-no-move',
        plies,
        trace
      };
    }

    trace.push(`${currentTurn ? 'new' : 'old'}:${move.from}${move.to}${move.promotion || ''}`);
    const a = applyMove(currentGame, move);
    const b = applyMove(referenceGame, move);
    if (!a || !b) {
      return {
        result: currentTurn ? 'loss' : 'win',
        reason: currentTurn ? 'current-invalid-move' : 'released-invalid-move',
        plies,
        trace
      };
    }
    plies += 1;
  }

  if (currentGame.in_checkmate()) {
    const winnerIsWhite = currentGame.side === -1;
    return {
      result: winnerIsWhite === currentIsWhite ? 'win' : 'loss',
      reason: 'checkmate',
      plies,
      trace
    };
  }

  let reason = 'max-plies';
  if (currentGame.in_draw()) {
    reason = currentGame.halfmove >= 100 ? 'fifty-move' :
      currentGame._insufficientMaterial() ? 'insufficient-material' :
      (currentGame.positionCounts.get(currentGame.fastPositionKey()) || 0) >= 3 ? 'threefold' : 'stalemate';
  }
  return { result: 'draw', reason, plies, trace };
}

const currentDir = process.cwd();
const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');

const currentEngine = makeEngine(currentDir);
const referenceEngine = makeEngine(referenceDir);
const games = Math.max(2, Number.parseInt(process.env.H2H_GAMES || '100', 10) || 100);
const startIndex = Math.max(0, Number.parseInt(process.env.START_INDEX || '0', 10) || 0);
const totals = { win: 0, loss: 0, draw: 0 };
const reasons = {};
let totalPlies = 0;

for (let i = 0; i < games; i += 1) {
  const globalIndex = startIndex + i;
  const gameNumber = globalIndex + 1;
  const currentIsWhite = globalIndex % 2 === 0;
  const seed = 0x705A17E + globalIndex * 977;
  const result = simulateGame(currentEngine, referenceEngine, currentIsWhite, seed);
  totals[result.result] += 1;
  reasons[result.reason] = (reasons[result.reason] || 0) + 1;
  totalPlies += result.plies;
  console.log(`${String(gameNumber).padStart(3, '0')} new=${currentIsWhite ? 'W' : 'B'} ${result.result.toUpperCase()} ${result.reason} ${result.plies} plies`);
  if (result.result !== 'win') console.log(`TRACE game ${gameNumber}: ${result.trace.slice(-48).join(' ')}`);
}

const summary = {
  games,
  startIndex,
  endIndex: startIndex + games - 1,
  newWins: totals.win,
  newLosses: totals.loss,
  draws: totals.draw,
  score: (totals.win + totals.draw * 0.5) / games,
  averagePlies: totalPlies / games,
  reasons
};
console.log('\nSTONEFISH_V5_PRO_HEAD_TO_HEAD ' + JSON.stringify(summary));

if (process.env.H2H_RESULT_FILE) {
  fs.writeFileSync(process.env.H2H_RESULT_FILE, JSON.stringify(summary));
}
