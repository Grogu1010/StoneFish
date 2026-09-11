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
  const b = game.boardState;
  for (const sq of TUNE_CENTER) {
    const piece = b[sq];
    if (piece && (piece > 0 ? 1 : -1) === side) score += p.centerOccupy;
    if (game._isAttacked(sq, side)) score += p.centerAttack;
  }
  return score;
}

function tuneDevelopment(game, side) {
  const b = game.boardState;
  const nStarts = side === 1 ? [1, 6] : [57, 62];
  const bStarts = side === 1 ? [2, 5] : [58, 61];
  const dPawnStart = side === 1 ? 11 : 51;
  const ePawnStart = side === 1 ? 12 : 52;
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = b[sq];
    if (p === side * 2 && sq !== nStarts[0] && sq !== nStarts[1]) score += 2;
    else if (p === side * 3 && sq !== bStarts[0] && sq !== bStarts[1]) score += 2;
  }
  let dPawnMoved = false, ePawnMoved = false;
  for (let sq = 0; sq < 64; sq += 1) {
    if (b[sq] !== side) continue;
    const file = sq & 7;
    if (file === 3 && sq !== dPawnStart) dPawnMoved = true;
    if (file === 4 && sq !== ePawnStart) ePawnMoved = true;
  }
  if (dPawnMoved) score += 1;
  if (ePawnMoved) score += 1;
  return score;
}

function tuneQueenDiscipline(game, side) {
  if (game.fullmove > 10) return 0;
  const home = side === 1 ? 3 : 59;
  return game.boardState[home] === side * 5 ? 1 : 0;
}

function tunePieceSupport(game, side, raw) {
  return game._isAttacked(raw.to, side) ? 1 : 0;
}

function tuneMinorCentral(game, side) {
  const b = game.boardState;
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = b[sq];
    if (p !== side * 2 && p !== side * 3) continue;
    const f = sq & 7, r = sq >> 3;
    if (TUNE_CENTER.includes(sq)) score += 4;
    else if (f >= 2 && f <= 5 && r >= 2 && r <= 5) score += 2;
    else if (f === 0 || f === 7 || r === 0 || r === 7) score += 0;
    else score += 1;
  }
  return score;
}

function tunePawnStructure(game, side) {
  const b = game.boardState;
  const files = new Array(8).fill(0);
  const pawns = [];
  for (let sq = 0; sq < 64; sq += 1) {
    if (b[sq] === side) {
      files[sq & 7] += 1;
      pawns.push(sq);
    }
  }
  let score = 0;
  for (let f = 0; f < 8; f += 1) {
    if (files[f] > 1) score -= (files[f] - 1) * 2;
    if (files[f] > 0 && (f === 0 || files[f - 1] === 0) && (f === 7 || files[f + 1] === 0)) score -= 1;
  }
  for (const sq of pawns) {
    const f = sq & 7, r = sq >> 3;
    for (const df of [-1, 1]) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      for (const dr of [-1, 1]) {
        const nr = r + dr;
        if (nr >= 0 && nr < 8 && b[nr * 8 + nf] === side) score += 1;
      }
    }
  }
  return score;
}

function tuneRookActivity(game, side) {
  const b = game.boardState;
  const rooks = [];
  for (let sq = 0; sq < 64; sq += 1) if (b[sq] === side * 4) rooks.push(sq);
  let score = 0;
  for (const sq of rooks) {
    const f = sq & 7, r = sq >> 3;
    let ownPawnOnFile = false;
    for (let rr = 0; rr < 8; rr += 1) if (b[rr * 8 + f] === side) ownPawnOnFile = true;
    if (!ownPawnOnFile) score += 2;
    if ((side === 1 && r === 6) || (side === -1 && r === 1)) score += 2;
    if ((side === 1 && r > 0) || (side === -1 && r < 7)) score += 1;
  }
  if (rooks.length === 2) {
    const a = rooks[0], c = rooks[1];
    if ((a >> 3) === (c >> 3)) {
      let clear = true;
      for (let sq = Math.min(a,c) + 1; sq < Math.max(a,c); sq += 1) if (b[sq]) clear = false;
      if (clear) score += 3;
    }
  }
  return score;
}

function tuneKingPlacement(game, side) {
  const b = game.boardState;
  let material = 0;
  const vals = [0,0,3,3,5,9,0];
  for (let sq = 0; sq < 64; sq += 1) {
    const p = b[sq];
    if (p && (p > 0 ? 1 : -1) === side) material += vals[Math.abs(p)];
  }
  const k = game.kingSq[side];
  const f = k & 7, r = k >> 3;
  if (material <= 10) return 7 - Math.abs(f - 3.5) - Math.abs(r - 3.5);
  const castleA = side === 1 ? 2 : 58;
  const castleB = side === 1 ? 6 : 62;
  const home = side === 1 ? 4 : 60;
  if (k === castleA || k === castleB) return 3;
  if (k === home) return 1;
  return 0;
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
  else if (criterion === 'development') score = tuneDevelopment(game, side);
  else if (criterion === 'queenDiscipline') score = tuneQueenDiscipline(game, side);
  else if (criterion === 'pieceSupport') score = tunePieceSupport(game, side, raw);
  else if (criterion === 'minorCentral') score = tuneMinorCentral(game, side);
  else if (criterion === 'pawnStructure') score = tunePawnStructure(game, side);
  else if (criterion === 'rookActivity') score = tuneRookActivity(game, side);
  else if (criterion === 'kingPlacement') score = tuneKingPlacement(game, side);
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
    const scores = new Array(candidates.length);
    for (let i = 0; i < candidates.length; i += 1) {
      const score = tuneFeature(game, candidates[i], criterion, cfg);
      scores[i] = score;
      if (score > best) best = score;
    }
    const kept = [];
    for (let i = 0; i < candidates.length; i += 1) if (scores[i] === best) kept.push(candidates[i]);
    candidates = kept;
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

function test(cfg, games, start) {
  let W = 0, L = 0, D = 0;
  for (let i = 0; i < games; i += 1) {
    const r = play(cfg, start + i);
    if (r === 'W') W++; else if (r === 'L') L++; else D++;
  }
  return { W, L, D, games, score: W - 3 * L + 0.01 * D };
}

function rank(a,b) {
  if (b.r.score !== a.r.score) return b.r.score - a.r.score;
  if (b.r.W !== a.r.W) return b.r.W - a.r.W;
  return a.r.L - b.r.L;
}

function shuffle(xs, rng) {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

const params = { castleBonus: 100, pawnShield: 3, pieceShield: 2, defendedRing: 1, centerOccupy: 2, centerAttack: 1 };
const features = ['mobility','development','check','kingFreedom','kingProtection','center','pieceSupport','minorCentral','pawnStructure','rookActivity','queenDiscipline','kingPlacement'];
const handOrders = [
  ['mobility','development','check','kingFreedom','pieceSupport','center','kingProtection','minorCentral','queenDiscipline','pawnStructure','rookActivity','kingPlacement'],
  ['development','mobility','check','kingFreedom','pieceSupport','center','kingProtection','minorCentral','queenDiscipline','pawnStructure','rookActivity','kingPlacement'],
  ['development','pieceSupport','mobility','minorCentral','check','kingFreedom','center','queenDiscipline','kingProtection','pawnStructure','rookActivity','kingPlacement'],
  ['mobility','minorCentral','development','pieceSupport','check','kingFreedom','center','queenDiscipline','kingProtection','pawnStructure','rookActivity','kingPlacement'],
  ['mobility','pieceSupport','development','minorCentral','check','kingFreedom','center','queenDiscipline','kingProtection','pawnStructure','rookActivity','kingPlacement'],
  ['queenDiscipline','development','mobility','minorCentral','pieceSupport','check','kingFreedom','center','kingProtection','pawnStructure','rookActivity','kingPlacement'],
  ['development','minorCentral','mobility','queenDiscipline','pieceSupport','check','kingFreedom','center','kingProtection','pawnStructure','rookActivity','kingPlacement'],
  ['mobility','check','kingFreedom','kingProtection','center','development','pieceSupport','minorCentral','queenDiscipline','pawnStructure','rookActivity','kingPlacement']
];

const orderMap = new Map();
function addOrder(order, name) {
  const k = order.join('>');
  if (!orderMap.has(k)) orderMap.set(k, { ...params, name, order });
}
handOrders.forEach((x,i)=>addOrder(x,'hand'+i));
const rr = seeded(0x31415926);
for (let i = 0; i < 120; i += 1) {
  let order = shuffle(features, rr);
  if (i % 3 === 0) {
    order = order.filter(x => x !== 'mobility');
    order.unshift('mobility');
  } else if (i % 3 === 1) {
    order = order.filter(x => x !== 'development');
    order.unshift('development');
  }
  addOrder(order, 'rnd'+i);
}
const configs = [...orderMap.values()];

console.log('EXPANDED SCREEN', configs.length, 'orders x 8 games');
const screened = configs.map(cfg => ({cfg, r:test(cfg,8,0)})).sort(rank);
for (const x of screened.slice(0,15)) console.log(x.cfg.name, x.cfg.order.join('>'), x.r);

console.log('CONFIRM top 16 x 24 games');
const confirmed = screened.slice(0,16).map(x => ({cfg:x.cfg, r:test(x.cfg,24,1000)})).sort(rank);
for (const x of confirmed.slice(0,10)) console.log(x.cfg.name, x.cfg.order.join('>'), x.r);

const mutMap = new Map();
function addMutation(order, name) {
  const k = order.join('>');
  if (!mutMap.has(k)) mutMap.set(k, { ...params, name, order });
}
confirmed.slice(0,6).forEach((x, ci) => {
  addMutation(x.cfg.order, 'base'+ci);
  const base = x.cfg.order;
  for (let a = 0; a < Math.min(7, base.length); a += 1) {
    for (let b = a + 1; b < Math.min(7, base.length); b += 1) {
      const m = base.slice();
      const t = m[a]; m[a] = m[b]; m[b] = t;
      addMutation(m, 'swap'+ci+'_'+a+'_'+b);
    }
  }
});
const mutations = [...mutMap.values()].slice(0,90);
console.log('MUTATION SCREEN', mutations.length, 'x 16 games');
const ms = mutations.map(cfg => ({cfg, r:test(cfg,16,2500)})).sort(rank);
for (const x of ms.slice(0,12)) console.log(x.cfg.name, x.cfg.order.join('>'), x.r);

console.log('SEMIFINAL top 8 x 50 games');
const semi = ms.slice(0,8).map(x => ({cfg:x.cfg, r:test(x.cfg,50,4000)})).sort(rank);
for (const x of semi) console.log(x.cfg.name, x.cfg.order.join('>'), x.r);

console.log('FINAL top 3 x 100 games');
const finals = semi.slice(0,3).map(x => ({cfg:x.cfg, r:test(x.cfg,100,7000)})).sort(rank);
for (const x of finals) console.log('FINAL', x.cfg.name, x.cfg.order.join('>'), x.r);
console.log('WINNER', JSON.stringify(finals[0].cfg), finals[0].r);
`;

new Function(engine + '\n' + v3 + '\n' + harness)();
