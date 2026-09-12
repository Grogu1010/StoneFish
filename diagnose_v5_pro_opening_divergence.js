// Find the first policy divergence from released v5 Pro after a legal opening prefix.
// Diagnostic only; no result manipulation or forced moves after the opening.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const engineFiles = [
  'StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js','Stonefish_v5.js','Stonefish_v5_pro.js',
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
    this.__scoreAll = stonefishV5ProScoreAllMoves;
    this.__public = stonefishV3PublicMove;
    this.__uci = stonefishV45RawUci;
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
  `, ctx);
  return ctx;
}

const key = move => move ? `${move.from}${move.to}${move.promotion || ''}` : 'null';
const decode = uci => ({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci.slice(4) || 'q' });
function apply(game, move) { return move && game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }); }
function seedOpening(game, opening) { for (const uci of opening.moves) if (!game.move(decode(uci))) throw new Error(`Illegal ${uci}`); }

const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');
const openingIndex = Number.parseInt(process.env.OPENING_INDEX || '1', 10);
const opening = OPENINGS[openingIndex];
if (!opening) throw new Error(`Unknown opening ${openingIndex}`);
const currentIsWhite = process.env.DIAG_COLOR !== 'black';
const seed = 0x51A17E + openingIndex * 7919 + (currentIsWhite ? 0 : 977);

const current = makeEngine(process.cwd(), true);
const released = makeEngine(referenceDir, false);
const shadow = makeEngine(referenceDir, false);
current.__setSeed(seed ^ 0x9E3779B9);
released.__setSeed(seed ^ 0x85EBCA6B);
shadow.__setSeed(seed ^ 0xC2B2AE35);
const currentGame = new current.__Chess();
const releasedGame = new released.__Chess();
const shadowGame = new shadow.__Chess();
seedOpening(currentGame, opening); seedOpening(releasedGame, opening); seedOpening(shadowGame, opening);

for (let ply = opening.moves.length; ply < 180 && !currentGame.game_over(); ply += 1) {
  const currentTurn = (currentGame.side === 1) === currentIsWhite;
  let move;
  if (currentTurn) {
    const scored = current.__scoreAll(currentGame);
    const candidate = scored.length ? current.__public(currentGame, scored[0].raw) : null;
    shadow.__setSeed((seed + ply * 977) ^ 0xC2B2AE35);
    const releasedSuggestion = shadow.__getPro(shadowGame);
    if (key(candidate) !== key(releasedSuggestion)) {
      const releasedKey = key(releasedSuggestion);
      const releasedIndex = scored.findIndex(entry => current.__uci(currentGame, entry.raw) === releasedKey);
      const pack = entry => entry ? ({ total: Number.isFinite(entry.score) ? entry.score : null, deep: entry.deep, preliminary: Number.isFinite(entry.preliminary) ? entry.preliminary : null, tactical: entry.tactical, knowledge: entry.knowledge, heritage: !!entry.heritageMatch }) : null;
      console.log('STONEFISH_V5_PRO_OPENING_DIVERGENCE ' + JSON.stringify({
        opening: opening.name, color: currentIsWhite ? 'white' : 'black', ply,
        candidate: key(candidate), releasedSuggestion: releasedKey,
        releasedSuggestionRank: releasedIndex >= 0 ? releasedIndex + 1 : -1,
        candidateEntry: pack(scored[0]), releasedSuggestionEntry: releasedIndex >= 0 ? pack(scored[releasedIndex]) : null,
        top: scored.slice(0, 8).map((entry, i) => ({ rank: i + 1, move: current.__uci(currentGame, entry.raw), ...pack(entry) }))
      }));
      process.exit(0);
    }
    move = candidate;
  } else {
    move = released.__getPro(releasedGame);
  }
  if (!apply(currentGame, move) || !apply(releasedGame, move) || !apply(shadowGame, move)) throw new Error(`Replay failed ${key(move)} at ${ply}`);
}
console.log('STONEFISH_V5_PRO_OPENING_DIVERGENCE none-before-limit');
