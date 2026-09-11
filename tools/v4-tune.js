const fs = require('fs');

const engine = fs.readFileSync('StonefishChess.js', 'utf8');
const v3 = fs.readFileSync('Stonefish_v3.js', 'utf8');

const harness = String.raw`
function seeded(seed) {
  let x = seed >>> 0;
  return function () {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const TUNE_CENTER = [27, 28, 35, 36];

function tuneKingFreedom(game, side) {
  const b = game.boardState;
  const king = game.kingSq[side];
  const file = king & 7;
  const rank = king >> 3;
  const kingPiece = b[king];
  let freedom = 0;
  for (let i = 0; i < SF_ALL_DIRS.length; i += 2) {
    const f = file + SF_ALL_DIRS[i];
    const r = rank + SF_ALL_DIRS[i + 1];
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    const to = r * 8 + f;
    const target = b[to];
    if (target && (target > 0 ? 1 : -1) === side) continue;
    b[king] = 0; b[to] = kingPiece;
    const safe = !game._isAttacked(to, -side);
    b[king] = kingPiece; b[to] = target;
    if (safe) freedom += 1;
  }
  return freedom;
}

function tuneKingProtection(game, side, p) {
  const b = game.boardState;
  const king = game.kingSq[side];
  const file = king & 7;
  const rank = king >> 3;
  const kingPiece = b[king];
  let score = 0;
  b[king] = 0;
  for (let i = 0; i < SF_ALL_DIRS.length; i += 2) {
    const f = file + SF_ALL_DIRS[i];
    const r = rank + SF_ALL_DIRS[i + 1];
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    const sq = r * 8 + f;
    const piece = b[sq];
    if (piece && (piece > 0 ? 1 : -1) === side) score += Math.abs(piece) === 1 ? p.pawnShield : p.pieceShield;
    if (game._isAttacked(sq, side)) score += p.defendedRing;
  }
  b[king] = kingPiece;
  return score;
}

function tuneCenter(game, side, p) {
  let score = 0;
  for (const sq of TUNE_CENTER) {
    const piece = game.boardState[sq];
    if (piece && (piece > 0 ? 1 : -1) === side) score += p.centerOccupy;
    if (game._isAttacked(sq, side)) score += p.centerAttack;
  }
  return score;
}

function tuneFeature(game, raw, criterion, p) {
  if (criterion === 'check') return game.fastGivesCheck(raw) ? 1 : 0;
  game.fastApply(raw);
  const side = -game.side;
  let score = 0;
  if (criterion === 'mobility') score = game.fastMobility(side);
  else if (criterion === 'kingFreedom') score = ((raw.flags & 12) ? p.castleBonus : 0) + tuneKingFreedom(game, side);
  else if (criterion === 'kingProtection') score = tuneKingProtection(game, side, p);
  else if (criterion === 'center') score = tuneCenter(game, side, p);
  game.fastUndo();
  return score;
}

function chooseV3(game, rng) {
  const moves = getStonefishV3BestRawMoves(game);
  return moves.length ? moves[Math.floor(rng() * moves.length)] : null;
}

function chooseV4(game, rng, cfg) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return null;
  for (const criterion of cfg.order) {
    if (candidates.length <= 1) break;
    let best = -Infinity;
    const scored = candidates.map(move => {
      const score = tuneFeature(game, move, criterion, cfg);
      if (score > best) best = score;
      return [move, score];
    });
    candidates = scored.filter(x => x[1] === best).map(x => x[0]);
  }
  return candidates[Math.floor(rng() * candidates.length)];
}

function cheapDraw(game) {
  if (game.halfmove >= 100 || game._insufficientMaterial()) return true;
  return (game.positionCounts.get(game.fastPositionKey()) || 0) >= 3;
}

function play(cfg, gameNo, maxPlies = 500) {
  const game = new Chess();
  const v4White = (gameNo & 1) === 0;
  const r3 = seeded(0x9e3779b9 ^ (gameNo * 0x45d9f3b));
  const r4 = seeded(0x85ebca6b ^ (gameNo * 0x27d4eb2d));
  for (let ply = 0; ply < maxPlies; ply += 1) {
    const v4Turn = (game.turn() === 'w') === v4White;
    const move = v4Turn ? chooseV4(game, r4, cfg) : chooseV3(game, r3);
    if (!move) {
      if (!game.in_check()) return 'D';
      const whiteWon = game.turn() === 'b';
      return whiteWon === v4White ? 'W' : 'L';
    }
    game._applyRaw(move, true);
    if (cheapDraw(game)) return 'D';
  }
  return 'D';
}

function test(cfg, games, start = 0) {
  let W = 0, L = 0, D = 0;
  for (let i = 0; i < games; i += 1) {
    const r = play(cfg, start + i);
    if (r === 'W') W++; else if (r === 'L') L++; else D++;
  }
  return {W,L,D,games, score: W - 2 * L + 0.05 * D};
}

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  const out = [];
  for (let i = 0; i < xs.length; i++) {
    const rest = xs.slice(0,i).concat(xs.slice(i+1));
    for (const p of permutations(rest)) out.push([xs[i], ...p]);
  }
  return out;
}

const baseParams = { castleBonus: 100, pawnShield: 3, pieceShield: 2, defendedRing: 1, centerOccupy: 2, centerAttack: 1 };
const tails = permutations(['check','kingFreedom','kingProtection','center']);
const configs = tails.map((tail, i) => ({...baseParams, name:'ord'+i, order:['mobility', ...tail]}));

console.log('SCREEN 24 mobility-first orders x 12 games');
const screened = configs.map(cfg => ({cfg, r:test(cfg,12)})).sort((a,b)=>b.r.score-a.r.score);
for (const x of screened.slice(0,10)) console.log(x.cfg.name, x.cfg.order.join('>'), x.r);

console.log('CONFIRM top 6 x 36 games');
const confirmed = screened.slice(0,6).map(x => ({cfg:x.cfg, r:test(x.cfg,36)})).sort((a,b)=>b.r.score-a.r.score);
for (const x of confirmed) console.log(x.cfg.name, x.cfg.order.join('>'), x.r);

const bestOrder = confirmed[0].cfg.order;
const paramSets = [];
for (const castleBonus of [1,2,4,8,16,100])
for (const pawnShield of [2,3,4])
for (const pieceShield of [1,2])
for (const defendedRing of [0,1,2])
for (const centerOccupy of [1,2,3])
for (const centerAttack of [0.5,1,2]) {
  paramSets.push({castleBonus,pawnShield,pieceShield,defendedRing,centerOccupy,centerAttack});
}

// Deterministic sparse sample of the grid to keep runtime reasonable.
const sampled = paramSets.filter((_,i)=> i % 17 === 0).slice(0,32).map((p,i)=>({ ...p, name:'p'+i, order:bestOrder }));
console.log('PARAM SCREEN', sampled.length, 'configs x 12 games on', bestOrder.join('>'));
const ps = sampled.map(cfg=>({cfg,r:test(cfg,12,100)})).sort((a,b)=>b.r.score-a.r.score);
for (const x of ps.slice(0,10)) console.log(x.cfg.name, x.cfg, x.r);

console.log('PARAM CONFIRM top 5 x 40 games');
const pc = ps.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,40,100)})).sort((a,b)=>b.r.score-a.r.score);
for (const x of pc) console.log(x.cfg.name, x.cfg, x.r);

const winner = pc[0];
console.log('BEST_CANDIDATE', JSON.stringify(winner.cfg), winner.r);
console.log('FINAL_100', test(winner.cfg,100,1000));
`;

new Function(engine + '\n' + v3 + '\n' + harness)();
