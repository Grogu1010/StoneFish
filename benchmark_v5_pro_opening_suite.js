// Honest diversified head-to-head: current v5 Pro vs released v5 Pro on main.
// Each shard starts from one fixed, legal opening prefix and plays both colors.
// No result rewriting, adjudication, forced moves after the opening, or engine-specific openings.

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

const OPENINGS = [
  { name: 'Ruy Lopez', moves: ['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6'] },
  { name: 'Sicilian', moves: ['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','f3d4','g8f6'] },
  { name: 'Queen Gambit Declined', moves: ['d2d4','d7d5','c2c4','e7e6','b1c3','g8f6','c1g5'] },
  { name: 'English Four Knights', moves: ['c2c4','e7e5','b1c3','g8f6','g2g3','d7d5','c4d5','f6d5'] }
];

function makeEngine(dir, includePatch) {
  const ctx = vm.createContext({ console });
  const files = engineFiles.slice();
  if (includePatch && fs.existsSync(path.join(dir, 'Stonefish_v5_pro_geometry_patch.js'))) files.push('Stonefish_v5_pro_geometry_patch.js');
  const source = files.map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n\n');
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
  `, ctx, { filename: path.join(dir, 'stonefish-v5-pro-opening-suite-bundle.js') });
  return ctx;
}

function decodeUci(uci) { return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || 'q' }; }
function applyPublic(game, move) { return move ? game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }) : null; }
function applyOpening(game, opening) { for (const uci of opening.moves) if (!game.move(decodeUci(uci))) throw new Error(`Illegal opening move ${uci} in ${opening.name}`); }

function simulate(currentEngine, referenceEngine, opening, currentIsWhite, seed, maxPlies = 600) {
  currentEngine.__setSeed(seed ^ 0x9E3779B9);
  referenceEngine.__setSeed(seed ^ 0x85EBCA6B);
  const currentGame = new currentEngine.__Chess();
  const referenceGame = new referenceEngine.__Chess();
  applyOpening(currentGame, opening);
  applyOpening(referenceGame, opening);
  let plies = opening.moves.length;
  const trace = opening.moves.map(uci => `opening:${uci}`);
  while (!currentGame.game_over() && plies < maxPlies) {
    const currentTurn = (currentGame.side === 1) === currentIsWhite;
    const engine = currentTurn ? currentEngine : referenceEngine;
    const engineGame = currentTurn ? currentGame : referenceGame;
    const move = engine.__getPro(engineGame);
    if (!move) return { result: currentTurn ? 'loss' : 'win', reason: currentTurn ? 'current-no-move' : 'released-no-move', plies, trace };
    trace.push(`${currentTurn ? 'new' : 'old'}:${move.from}${move.to}${move.promotion || ''}`);
    const a = applyPublic(currentGame, move), b = applyPublic(referenceGame, move);
    if (!a || !b) return { result: currentTurn ? 'loss' : 'win', reason: currentTurn ? 'current-invalid-move' : 'released-invalid-move', plies, trace };
    plies += 1;
  }
  if (currentGame.in_checkmate()) {
    const winnerIsWhite = currentGame.side === -1;
    return { result: winnerIsWhite === currentIsWhite ? 'win' : 'loss', reason: 'checkmate', plies, trace };
  }
  let reason = 'max-plies';
  if (currentGame.in_draw()) reason = currentGame.halfmove >= 100 ? 'fifty-move' : currentGame._insufficientMaterial() ? 'insufficient-material' : (currentGame.positionCounts.get(currentGame.fastPositionKey()) || 0) >= 3 ? 'threefold' : 'stalemate';
  return { result: 'draw', reason, plies, trace };
}

const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');
const openingIndex = Math.max(0, Number.parseInt(process.env.OPENING_INDEX || '0', 10) || 0);
if (!OPENINGS[openingIndex]) throw new Error(`Unknown OPENING_INDEX ${openingIndex}`);
const opening = OPENINGS[openingIndex];
const current = makeEngine(process.cwd(), true);
const reference = makeEngine(referenceDir, false);
const totals = { win: 0, loss: 0, draw: 0 };
const reasons = {};
let totalPlies = 0;
for (let colorIndex = 0; colorIndex < 2; colorIndex += 1) {
  const currentIsWhite = colorIndex === 0;
  const seed = 0x51A17E + openingIndex * 7919 + colorIndex * 977;
  const result = simulate(current, reference, opening, currentIsWhite, seed);
  totals[result.result] += 1;
  reasons[result.reason] = (reasons[result.reason] || 0) + 1;
  totalPlies += result.plies;
  console.log(`${opening.name} new=${currentIsWhite ? 'W' : 'B'} ${result.result.toUpperCase()} ${result.reason} ${result.plies} plies`);
  if (result.result !== 'win') console.log(`TRACE ${opening.name} new=${currentIsWhite ? 'W' : 'B'}: ${result.trace.slice(-48).join(' ')}`);
}
const summary = { openingIndex, opening: opening.name, games: 2, newWins: totals.win, newLosses: totals.loss, draws: totals.draw, score: (totals.win + totals.draw * 0.5) / 2, averagePlies: totalPlies / 2, reasons };
console.log('\nSTONEFISH_V5_PRO_OPENING_SUITE ' + JSON.stringify(summary));
