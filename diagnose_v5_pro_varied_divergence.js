// Diagnose the first policy divergence between the fast candidate and released
// v5 Pro from a deterministic varied-opening benchmark position.
// Diagnostic only: no engine result manipulation or benchmark-specific moves.

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

function makeEngine(dir, includeCandidatePatch) {
  const ctx = vm.createContext({ console });
  const files = engineFiles.slice();
  const patch = path.join(dir, 'Stonefish_v5_pro_geometry_patch.js');
  if (includeCandidatePatch && fs.existsSync(patch)) files.push('Stonefish_v5_pro_geometry_patch.js');
  const source = files.map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n\n');
  vm.runInContext(source + `\n
    this.__Chess = Chess;
    this.__getPro = getStonefishV5ProMove;
    this.__scorePro = stonefishV5ProScoreAllMoves;
    this.__scoreV5 = stonefishV5ScoreAllMoves;
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

function seededRandom(seed) {
  let x = seed >>> 0;
  return function() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function moveKey(move) {
  return move ? `${move.from}${move.to}${move.promotion || ''}` : 'null';
}

function cleanMove(move) {
  return move ? { from: move.from, to: move.to, promotion: move.promotion || undefined } : null;
}

function apply(game, move) {
  return move && game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function openingKey(moves) {
  return moves.map(moveKey).join(' ');
}

function generateOpening(engine, pairIndex, salt, plies) {
  const seed = (0x51A7E0B1 + pairIndex * 0x9E3779B1 + salt * 0x85EBCA6B) >>> 0;
  const pick = seededRandom(seed ^ 0xC2B2AE35);
  engine.__setSeed(seed ^ 0x27D4EB2F);
  const game = new engine.__Chess();
  const moves = [];
  for (let ply = 0; ply < plies && !game.game_over(); ply += 1) {
    const scored = engine.__scoreV5(game);
    if (!scored.length) break;
    const width = Math.min(4, scored.length);
    const r = pick();
    let rank = r < 0.46 ? 0 : r < 0.76 ? 1 : r < 0.93 ? 2 : 3;
    rank = Math.min(rank, width - 1);
    const move = cleanMove(engine.__public(game, scored[rank].raw));
    if (!move || !apply(game, move)) break;
    moves.push(move);
  }
  return moves;
}

function buildOpeningSuite(engine, pairCount, plies = 10) {
  const suite = [];
  const seen = new Set();
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    let selected = null;
    for (let salt = 0; salt < 128; salt += 1) {
      const moves = generateOpening(engine, pairIndex, salt, plies);
      if (moves.length < Math.min(8, plies)) continue;
      const key = openingKey(moves);
      if (!seen.has(key)) {
        seen.add(key);
        selected = moves;
        break;
      }
    }
    if (!selected) throw new Error(`Could not generate opening pair ${pairIndex + 1}`);
    suite.push(selected);
  }
  return suite;
}

const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');
const pairNumber = Math.max(1, Number.parseInt(process.env.DIAG_PAIR || '31', 10) || 31);
const candidateIsWhite = process.env.DIAG_COLOR !== 'black';
const pairIndex = pairNumber - 1;
const gameIndex = pairIndex * 2 + (candidateIsWhite ? 0 : 1);
const gameSeed = (0x705A17E + pairIndex * 977) >>> 0;

const candidate = makeEngine(process.cwd(), true);
const released = makeEngine(referenceDir, false);
const shadow = makeEngine(referenceDir, false);
const openingGenerator = makeEngine(process.cwd(), true);
const openingSuite = buildOpeningSuite(openingGenerator, pairNumber, 10);
const opening = openingSuite[pairIndex];

candidate.__setSeed(gameSeed ^ 0x9E3779B9);
released.__setSeed(gameSeed ^ 0x85EBCA6B);
shadow.__setSeed(gameSeed ^ 0xC2B2AE35);
const candidateGame = new candidate.__Chess();
const releasedGame = new released.__Chess();
const shadowGame = new shadow.__Chess();

for (const move of opening) {
  if (!apply(candidateGame, move) || !apply(releasedGame, move) || !apply(shadowGame, move)) {
    throw new Error(`Opening replay failed on ${moveKey(move)}`);
  }
}

for (let postOpeningPly = 0; postOpeningPly < 160 && !candidateGame.game_over(); postOpeningPly += 1) {
  const absolutePly = opening.length + postOpeningPly;
  const candidateTurn = (candidateGame.side === 1) === candidateIsWhite;
  let move;

  if (candidateTurn) {
    const scored = candidate.__scorePro(candidateGame);
    const candidateMove = scored.length ? candidate.__public(candidateGame, scored[0].raw) : null;
    const releasedSuggestion = shadow.__getPro(shadowGame);
    if (moveKey(candidateMove) !== moveKey(releasedSuggestion)) {
      const releasedKey = moveKey(releasedSuggestion);
      const releasedIndex = scored.findIndex(entry => candidate.__uci(candidateGame, entry.raw) === releasedKey);
      const releasedEntry = releasedIndex >= 0 ? scored[releasedIndex] : null;
      const rows = scored.slice(0, 12).map((entry, index) => ({
        rank: index + 1,
        move: candidate.__uci(candidateGame, entry.raw),
        total: Number.isFinite(entry.score) ? entry.score : null,
        deep: entry.deep,
        preliminary: Number.isFinite(entry.preliminary) ? entry.preliminary : null,
        tactical: entry.tactical,
        knowledge: entry.knowledge,
        scout: entry.scout,
        heritage: !!entry.heritageMatch
      }));
      console.log('STONEFISH_V5_PRO_VARIED_DIVERGENCE ' + JSON.stringify({
        pair: pairNumber,
        game: gameIndex + 1,
        candidateColor: candidateIsWhite ? 'white' : 'black',
        opening: openingKey(opening),
        postOpeningPly,
        absolutePly,
        side: candidateGame.turn(),
        candidate: moveKey(candidateMove),
        releasedSuggestion: releasedKey,
        releasedSuggestionRank: releasedIndex >= 0 ? releasedIndex + 1 : -1,
        releasedSuggestionEntry: releasedEntry ? {
          total: Number.isFinite(releasedEntry.score) ? releasedEntry.score : null,
          deep: releasedEntry.deep,
          preliminary: Number.isFinite(releasedEntry.preliminary) ? releasedEntry.preliminary : null,
          tactical: releasedEntry.tactical,
          knowledge: releasedEntry.knowledge,
          scout: releasedEntry.scout,
          heritage: !!releasedEntry.heritageMatch
        } : null,
        top: rows
      }));
      process.exit(0);
    }
    move = candidateMove;
  } else {
    move = released.__getPro(releasedGame);
  }

  if (!apply(candidateGame, move) || !apply(releasedGame, move) || !apply(shadowGame, move)) {
    throw new Error(`Replay failed on ${moveKey(move)} at post-opening ply ${postOpeningPly}`);
  }
}

console.log('STONEFISH_V5_PRO_VARIED_DIVERGENCE none-before-limit');
