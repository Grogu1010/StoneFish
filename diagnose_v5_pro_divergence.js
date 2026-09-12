// Diagnose the first move where the current fast candidate disagrees with released v5 Pro.
// Diagnostic only: normal legal positions, no result manipulation.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const baseFiles = [
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

function makeEngine(dir, includePatch) {
  const ctx = vm.createContext({ console });
  const files = baseFiles.slice();
  if (includePatch && fs.existsSync(path.join(dir, 'Stonefish_v5_pro_geometry_patch.js'))) {
    files.push('Stonefish_v5_pro_geometry_patch.js');
  }
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

function key(move) {
  return move ? `${move.from}${move.to}${move.promotion || ''}` : 'null';
}

function apply(game, move) {
  return move && game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');
const currentDir = process.cwd();
const seed = Number.parseInt(process.env.DIAG_SEED || String(0x705A17E), 10);
const currentIsWhite = process.env.DIAG_COLOR !== 'black';

const current = makeEngine(currentDir, true);
const released = makeEngine(referenceDir, false);
const shadow = makeEngine(referenceDir, false);
current.__setSeed(seed ^ 0x9E3779B9);
released.__setSeed(seed ^ 0x85EBCA6B);
shadow.__setSeed(seed ^ 0xC2B2AE35);

const currentGame = new current.__Chess();
const releasedGame = new released.__Chess();
const shadowGame = new shadow.__Chess();

for (let ply = 0; ply < 160 && !currentGame.game_over(); ply += 1) {
  const currentTurn = (currentGame.side === 1) === currentIsWhite;
  let move;

  if (currentTurn) {
    const scored = current.__scoreAll(currentGame);
    const candidate = scored.length ? current.__public(currentGame, scored[0].raw) : null;
    shadow.__setSeed((seed + ply * 977) ^ 0xC2B2AE35);
    const oldSuggestion = shadow.__getPro(shadowGame);

    if (key(candidate) !== key(oldSuggestion)) {
      const oldKey = key(oldSuggestion);
      const oldIndex = scored.findIndex(entry => current.__uci(currentGame, entry.raw) === oldKey);
      const oldEntry = oldIndex >= 0 ? scored[oldIndex] : null;
      const rows = scored.slice(0, 10).map((entry, index) => ({
        rank: index + 1,
        move: current.__uci(currentGame, entry.raw),
        total: Number.isFinite(entry.score) ? entry.score : null,
        deep: entry.deep,
        preliminary: Number.isFinite(entry.preliminary) ? entry.preliminary : null,
        tactical: entry.tactical,
        knowledge: entry.knowledge,
        heritage: !!entry.heritageMatch
      }));
      console.log('STONEFISH_V5_PRO_DIVERGENCE ' + JSON.stringify({
        ply,
        side: currentGame.turn(),
        candidate: key(candidate),
        releasedSuggestion: oldKey,
        releasedSuggestionRank: oldIndex >= 0 ? oldIndex + 1 : -1,
        releasedSuggestionEntry: oldEntry ? {
          total: Number.isFinite(oldEntry.score) ? oldEntry.score : null,
          deep: oldEntry.deep,
          preliminary: Number.isFinite(oldEntry.preliminary) ? oldEntry.preliminary : null,
          tactical: oldEntry.tactical,
          knowledge: oldEntry.knowledge,
          heritage: !!oldEntry.heritageMatch
        } : null,
        top: rows
      }));
      process.exit(0);
    }
    move = candidate;
  } else {
    move = released.__getPro(releasedGame);
  }

  if (!apply(currentGame, move) || !apply(releasedGame, move) || !apply(shadowGame, move)) {
    throw new Error(`Could not replay ${key(move)} at ply ${ply}`);
  }
}

console.log('STONEFISH_V5_PRO_DIVERGENCE none-before-limit');
