// Stonefish_v4.5
// v4.5 keeps v3/v4 tactical-material logic, then adds three knowledge layers:
// 1) a weighted 50-line opening repertoire (25 White, 25 Black) with compatible-line fallback,
// 2) named mating-pattern recognition / conversion,
// 3) inverse positional tie-breaks that restrict the opponent as well as improving our own position.
//
// Opening weights are StoneFish repertoire priors, not claims of objective opening win rates.
// They deliberately emphasize high-theory, engine-friendly main lines used heavily in engine analysis/testing.

const STONEFISH_V45_OPENINGS = [
  // White repertoire — weights sum to 100.
  { id:'w_berlin', side:'w', name:'Ruy Lopez: Berlin', weight:6, tags:['e4','solid','engine','mainline'], moves:'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 e4d6 b5c6 d7c6'.split(' ') },
  { id:'w_ruy_closed', side:'w', name:'Ruy Lopez: Closed', weight:4, tags:['e4','solid','mainline'], moves:'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6'.split(' ') },
  { id:'w_italian', side:'w', name:'Italian: Pianissimo', weight:3, tags:['e4','solid','engine'], moves:'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 e1g1 d7d6 c2c3 a7a6 f1e1'.split(' ') },
  { id:'w_scotch', side:'w', name:'Scotch Game', weight:2, tags:['e4','dynamic'], moves:'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6'.split(' ') },
  { id:'w_petroff', side:'w', name:'Petroff Main Line', weight:3, tags:['e4','solid','engine'], moves:'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3'.split(' ') },
  { id:'w_najdorf', side:'w', name:'Sicilian Najdorf: English Attack', weight:6, tags:['e4','sicilian','tactical','engine','mainline'], moves:'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e6 f2f3'.split(' ') },
  { id:'w_sveshnikov', side:'w', name:'Sicilian Sveshnikov', weight:5, tags:['e4','sicilian','tactical','engine','mainline'], moves:'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5 d4b5 d7d6 c1g5'.split(' ') },
  { id:'w_rossolimo', side:'w', name:'Sicilian Rossolimo', weight:3, tags:['e4','sicilian','solid','engine'], moves:'e2e4 c7c5 g1f3 b8c6 f1b5 g7g6 e1g1 f8g7 f1e1 e7e5 c2c3'.split(' ') },
  { id:'w_caro_advance', side:'w', name:'Caro-Kann: Advance', weight:3, tags:['e4','solid'], moves:'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6 f1e2 c6c5 e1g1'.split(' ') },
  { id:'w_french_tarrasch', side:'w', name:'French: Tarrasch', weight:2, tags:['e4','solid'], moves:'e2e4 e7e6 d2d4 d7d5 b1d2 g8f6 e4e5 f6d7 f1d3 c7c5 c2c3'.split(' ') },
  { id:'w_catalan_open', side:'w', name:'Catalan: Open Defense', weight:7, tags:['d4','catalan','hypermodern','engine','mainline'], moves:'d2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 d5c4 g1f3 f8e7 e1g1'.split(' ') },
  { id:'w_catalan_closed', side:'w', name:'Catalan: Closed', weight:6, tags:['d4','catalan','hypermodern','solid','engine'], moves:'d2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 f8e7 g1f3 e8g8 e1g1'.split(' ') },
  { id:'w_qgd_exchange', side:'w', name:'QGD: Exchange', weight:6, tags:['d4','solid','engine','mainline'], moves:'d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c4d5 e6d5 c1g5 f8e7 e2e3'.split(' ') },
  { id:'w_semislav', side:'w', name:'Semi-Slav: Meran', weight:6, tags:['d4','tactical','engine','mainline'], moves:'d2d4 d7d5 c2c4 e7e6 g1f3 g8f6 e2e3 c7c6 f1d3 d5c4 d3c4 b7b5 c4d3 a7a6'.split(' ') },
  { id:'w_nimzo', side:'w', name:'Nimzo-Indian: Classical', weight:6, tags:['d4','solid','engine','mainline'], moves:'d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 d1c2 e8g8 e2e4 d7d5 e4e5 f6e4'.split(' ') },
  { id:'w_grunfeld', side:'w', name:'Gruenfeld: Exchange', weight:5, tags:['d4','hypermodern','tactical','engine','mainline'], moves:'d2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3 f8g7'.split(' ') },
  { id:'w_kid_bayonet', side:'w', name:'King Indian: Bayonet', weight:3, tags:['d4','tactical','dynamic','mainline'], moves:'d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6 d4d5 c6e7 b2b4'.split(' ') },
  { id:'w_qga', side:'w', name:'Queen Gambit Accepted', weight:2, tags:['d4','dynamic'], moves:'d2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6'.split(' ') },
  { id:'w_slav', side:'w', name:'Slav Main Line', weight:4, tags:['d4','solid','engine'], moves:'d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5 e2e3'.split(' ') },
  { id:'w_qid', side:'w', name:'Queen Indian: Fianchetto', weight:4, tags:['d4','hypermodern','solid','engine'], moves:'d2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7 e1g1 e8g8'.split(' ') },
  { id:'w_english4', side:'w', name:'English: Four Knights', weight:5, tags:['english','hypermodern','engine'], moves:'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 f8b4 f1g2 e8g8 e1g1'.split(' ') },
  { id:'w_english_sym', side:'w', name:'English: Symmetrical', weight:3, tags:['english','hypermodern','solid'], moves:'c2c4 c7c5 g1f3 g8f6 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 e1g1'.split(' ') },
  { id:'w_reti', side:'w', name:'Reti Main Line', weight:2, tags:['reti','hypermodern','solid'], moves:'g1f3 d7d5 g2g3 g8f6 f1g2 g7g6 e1g1 f8g7 d2d3 e8g8 b1d2'.split(' ') },
  { id:'w_tromp', side:'w', name:'Trompowsky', weight:2, tags:['d4','dynamic','rare'], moves:'d2d4 g8f6 c1g5 e7e6 e2e4 h7h6 g5f6 d8f6 b1c3 d7d6'.split(' ') },
  { id:'w_vienna', side:'w', name:'Vienna Gambit', weight:2, tags:['e4','tactical','rare'], moves:'e2e4 e7e5 b1c3 g8f6 f2f4 d7d5 f4e5 f6e4 g1f3 f8e7 d2d3'.split(' ') },

  // Black repertoire — weights sum to 100.
  { id:'b_berlin', side:'b', name:'Berlin Defense', weight:7, tags:['e4','solid','engine','mainline'], moves:'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6'.split(' ') },
  { id:'b_petroff', side:'b', name:'Petroff Defense', weight:6, tags:['e4','solid','engine','mainline'], moves:'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4'.split(' ') },
  { id:'b_najdorf', side:'b', name:'Sicilian Najdorf', weight:7, tags:['e4','sicilian','tactical','engine','mainline'], moves:'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6'.split(' ') },
  { id:'b_sveshnikov', side:'b', name:'Sicilian Sveshnikov', weight:6, tags:['e4','sicilian','tactical','engine','mainline'], moves:'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5'.split(' ') },
  { id:'b_taimanov', side:'b', name:'Sicilian Taimanov', weight:4, tags:['e4','sicilian','dynamic'], moves:'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6 b1c3 d8c7'.split(' ') },
  { id:'b_acc_dragon', side:'b', name:'Sicilian Accelerated Dragon', weight:3, tags:['e4','sicilian','hypermodern','dynamic'], moves:'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g7g6 b1c3 f8g7'.split(' ') },
  { id:'b_caro', side:'b', name:'Caro-Kann Classical', weight:4, tags:['e4','solid'], moves:'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6'.split(' ') },
  { id:'b_french_winawer', side:'b', name:'French Winawer', weight:3, tags:['e4','tactical'], moves:'e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3'.split(' ') },
  { id:'b_french_rubinstein', side:'b', name:'French Rubinstein', weight:2, tags:['e4','solid'], moves:'e2e4 e7e6 d2d4 d7d5 b1c3 d5e4 c3e4 g8f6 e4f6 d8f6'.split(' ') },
  { id:'b_scandi', side:'b', name:'Scandinavian', weight:1, tags:['e4','dynamic','rare'], moves:'e2e4 d7d5 e4d5 d8d5 b1c3 d5d8 d2d4 g8f6'.split(' ') },
  { id:'b_qgd', side:'b', name:'QGD Orthodox', weight:6, tags:['d4','solid','engine','mainline'], moves:'d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8'.split(' ') },
  { id:'b_nimzo', side:'b', name:'Nimzo-Indian', weight:7, tags:['d4','solid','engine','mainline'], moves:'d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5'.split(' ') },
  { id:'b_qid', side:'b', name:'Queen Indian', weight:4, tags:['d4','hypermodern','solid','engine'], moves:'d2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7'.split(' ') },
  { id:'b_semislav', side:'b', name:'Semi-Slav', weight:6, tags:['d4','tactical','engine','mainline'], moves:'d2d4 d7d5 c2c4 e7e6 g1f3 g8f6 b1c3 c7c6 e2e3'.split(' ') },
  { id:'b_slav', side:'b', name:'Slav Defense', weight:4, tags:['d4','solid','engine'], moves:'d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5'.split(' ') },
  { id:'b_grunfeld', side:'b', name:'Gruenfeld Defense', weight:6, tags:['d4','hypermodern','tactical','engine','mainline'], moves:'d2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3'.split(' ') },
  { id:'b_kid', side:'b', name:'King Indian Defense', weight:4, tags:['d4','hypermodern','dynamic'], moves:'d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8'.split(' ') },
  { id:'b_qga', side:'b', name:'Queen Gambit Accepted', weight:3, tags:['d4','dynamic'], moves:'d2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5'.split(' ') },
  { id:'b_dutch', side:'b', name:'Dutch Leningrad', weight:2, tags:['d4','dynamic','rare'], moves:'d2d4 f7f5 g2g3 g8f6 f1g2 g7g6 g1f3 f8g7 e1g1 e8g8'.split(' ') },
  { id:'b_benko', side:'b', name:'Benko Gambit', weight:2, tags:['d4','dynamic','tactical','rare'], moves:'d2d4 g8f6 c2c4 c7c5 d4d5 b7b5 c4b5 a7a6 b5a6 c8a6'.split(' ') },
  { id:'b_bogo', side:'b', name:'Bogo-Indian', weight:2, tags:['d4','solid'], moves:'d2d4 g8f6 c2c4 e7e6 g1f3 f8b4 c1d2 d8e7'.split(' ') },
  { id:'b_english_sym', side:'b', name:'English Symmetrical', weight:4, tags:['english','hypermodern','solid'], moves:'c2c4 c7c5 g1f3 g8f6 b1c3 b8c6 g2g3 g7g6'.split(' ') },
  { id:'b_english_e5', side:'b', name:'English Reversed Sicilian', weight:3, tags:['english','dynamic','engine'], moves:'c2c4 e7e5 b1c3 g8f6 g2g3 f8b4 f1g2 e8g8'.split(' ') },
  { id:'b_reti_d5', side:'b', name:'Reti ...d5', weight:3, tags:['reti','solid'], moves:'g1f3 d7d5 g2g3 g8f6 f1g2 g7g6 e1g1 f8g7'.split(' ') },
  { id:'b_pirc', side:'b', name:'Pirc Defense', weight:1, tags:['e4','hypermodern','dynamic','rare'], moves:'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 f2f4 f8g7 g1f3 e8g8'.split(' ') }
];

const STONEFISH_V45_PROFILE_MULTIPLIERS = [
  {},
  { e4:1.75, sicilian:1.15, d4:0.72, english:0.78, reti:0.78 },
  { d4:1.55, catalan:1.35, e4:0.72, english:0.9, reti:0.9 },
  { english:1.9, reti:1.75, catalan:1.45, hypermodern:1.35, e4:0.78 },
  { sicilian:2.15, tactical:1.2, solid:0.78 },
  { solid:1.7, tactical:0.72, dynamic:0.8, rare:0.7 },
  { tactical:1.65, dynamic:1.5, sicilian:1.25, solid:0.8 },
  { engine:1.55, mainline:1.35, rare:0.55 },
  { __flat:1 }
];

const STONEFISH_V45_BOOK_STATE = new WeakMap();
const STONEFISH_V45_INVERSE_ORDER = ['oppCheckRisk','oppMobility','giveCheck','oppKingFreedom','oppCenter','oppBoardControl'];
const STONEFISH_V45_MATE_PATTERNS = ['ladder','triangle','backRank','smothered','arabian','killBox','boden'];

function stonefishV45RawUci(game, raw) {
  return game._alg(raw.from) + game._alg(raw.to) + (raw.promotion ? game._typeChar(raw.promotion) : '');
}

function stonefishV45HistoryUci(game) {
  const out = [];
  for (let i = 0; i < game.historyStack.length; i += 1) {
    const state = game.historyStack[i];
    if (state.trackRepetition) out.push(stonefishV45RawUci(game, state.move));
  }
  return out;
}

function stonefishV45LineCompatible(line, history) {
  if (history.length > line.moves.length) return false;
  for (let i = 0; i < history.length; i += 1) if (line.moves[i] !== history[i]) return false;
  return true;
}

function stonefishV45ProfileWeight(line, profileIndex) {
  if (profileIndex === 8) return Math.sqrt(Math.max(0.01, line.weight));
  const multipliers = STONEFISH_V45_PROFILE_MULTIPLIERS[profileIndex] || STONEFISH_V45_PROFILE_MULTIPLIERS[0];
  let value = line.weight;
  for (let i = 0; i < line.tags.length; i += 1) {
    const mult = multipliers[line.tags[i]];
    if (mult) value *= mult;
  }
  return value;
}

function getStonefishV45OpeningPercentages(profileIndex = 0, side = 'w') {
  const lines = STONEFISH_V45_OPENINGS.filter(line => line.side === side);
  const raw = lines.map(line => stonefishV45ProfileWeight(line, profileIndex));
  const total = raw.reduce((a,b) => a + b, 0) || 1;
  return lines.map((line, i) => ({ id:line.id, name:line.name, percent:raw[i] * 100 / total }));
}

function stonefishV45WeightedLine(lines, profileIndex) {
  let total = 0;
  const weights = new Array(lines.length);
  for (let i = 0; i < lines.length; i += 1) {
    const w = stonefishV45ProfileWeight(lines[i], profileIndex);
    weights[i] = w;
    total += w;
  }
  if (!total) return lines[0] || null;
  let roll = Math.random() * total;
  for (let i = 0; i < lines.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return lines[i];
  }
  return lines[lines.length - 1] || null;
}

function stonefishV45BookMove(game, profileIndex) {
  const side = game.turn();
  const history = stonefishV45HistoryUci(game);
  const key = profileIndex + ':' + side;
  let stateMap = STONEFISH_V45_BOOK_STATE.get(game);
  if (!stateMap) { stateMap = new Map(); STONEFISH_V45_BOOK_STATE.set(game, stateMap); }
  let state = stateMap.get(key);
  const all = STONEFISH_V45_OPENINGS.filter(line => line.side === side && stonefishV45LineCompatible(line, history) && line.moves.length > history.length);
  if (!all.length) return null;

  let selected = state ? STONEFISH_V45_OPENINGS.find(line => line.id === state.lineId) : null;
  if (!selected || !stonefishV45LineCompatible(selected, history) || selected.moves.length <= history.length) {
    selected = stonefishV45WeightedLine(all, profileIndex);
    if (!selected) return null;
    state = { lineId:selected.id };
    stateMap.set(key, state);
  }

  const uci = selected.moves[history.length];
  const legal = game.fastMoves();
  for (let i = 0; i < legal.length; i += 1) if (stonefishV45RawUci(game, legal[i]) === uci) return legal[i];

  // The opponent left our chosen branch. Re-weight only lines that still match the real game.
  stateMap.delete(key);
  const alternatives = all.filter(line => line.id !== selected.id);
  const fallback = stonefishV45WeightedLine(alternatives, profileIndex);
  if (!fallback) return null;
  stateMap.set(key, { lineId:fallback.id });
  const fallbackUci = fallback.moves[history.length];
  for (let i = 0; i < legal.length; i += 1) if (stonefishV45RawUci(game, legal[i]) === fallbackUci) return legal[i];
  return null;
}

function stonefishV45EnemyKingEdge(game, side) {
  const sq = game.kingSq[side], f = sq & 7, r = sq >> 3;
  return f === 0 || f === 7 || r === 0 || r === 7;
}

function stonefishV45Pieces(game, side, absType) {
  const out = [];
  for (let sq = 0; sq < 64; sq += 1) if (game.boardState[sq] === side * absType) out.push(sq);
  return out;
}

function stonefishV45HeavyPieces(game, side) {
  const out = [];
  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if ((p === side * 4) || (p === side * 5)) out.push(sq);
  }
  return out;
}

function stonefishV45LadderScore(game, ownSide, enemySide) {
  const heavy = stonefishV45HeavyPieces(game, ownSide);
  if (heavy.length < 2) return 0;
  let best = 0;
  for (let i = 0; i < heavy.length; i += 1) for (let j = i + 1; j < heavy.length; j += 1) {
    const a = heavy[i], b = heavy[j];
    const af=a&7, ar=a>>3, bf=b&7, br=b>>3;
    if (af === bf && Math.abs(ar-br) === 1) best = Math.max(best, 22);
    if (ar === br && Math.abs(af-bf) === 1) best = Math.max(best, 22);
    if (Math.abs(ar-br) === 1 || Math.abs(af-bf) === 1) best = Math.max(best, 12);
  }
  if (stonefishV45EnemyKingEdge(game, enemySide)) best += 8;
  return best;
}

function stonefishV45TriangleScore(game, ownSide, enemySide) {
  if (!stonefishV45EnemyKingEdge(game, enemySide)) return 0;
  const queens = stonefishV45Pieces(game, ownSide, 5), rooks = stonefishV45Pieces(game, ownSide, 4);
  let score = 0;
  for (const q of queens) for (const r of rooks) {
    if ((q & 7) === (r & 7) && Math.abs((q >> 3) - (r >> 3)) === 2 && game._isAttacked(q, ownSide)) score = Math.max(score, 28);
    if ((q >> 3) === (r >> 3) && Math.abs((q & 7) - (r & 7)) === 2 && game._isAttacked(q, ownSide)) score = Math.max(score, 22);
  }
  return score;
}

function stonefishV45BackRankScore(game, ownSide, enemySide) {
  const k = game.kingSq[enemySide], rank = k >> 3;
  const homeRank = enemySide === 1 ? 0 : 7;
  if (rank !== homeRank || !game.in_check()) return 0;
  return stonefishV4KingFreedom(game, enemySide) <= 1 ? 26 : 10;
}

function stonefishV45SmotheredScore(game, ownSide, enemySide, raw) {
  if (raw.piece !== 2 || !game.in_check()) return 0;
  const k = game.kingSq[enemySide], f=k&7, r=k>>3;
  let blocked = 0;
  for (let i=0;i<SF_ALL_DIRS.length;i+=2) {
    const nf=f+SF_ALL_DIRS[i], nr=r+SF_ALL_DIRS[i+1];
    if (nf<0||nf>7||nr<0||nr>7) continue;
    const p=game.boardState[nr*8+nf];
    if (p && (p>0?1:-1)===enemySide) blocked += 1;
  }
  return blocked >= 3 ? 28 + blocked : 0;
}

function stonefishV45ArabianScore(game, ownSide, enemySide) {
  if (!stonefishV45EnemyKingEdge(game, enemySide)) return 0;
  if (!stonefishV45Pieces(game, ownSide, 4).length || !stonefishV45Pieces(game, ownSide, 2).length) return 0;
  return game.in_check() && stonefishV4KingFreedom(game, enemySide) <= 1 ? 24 : 0;
}

function stonefishV45BodenScore(game, ownSide, enemySide) {
  const bishops = stonefishV45Pieces(game, ownSide, 3);
  if (bishops.length < 2 || !game.in_check()) return 0;
  return stonefishV4KingFreedom(game, enemySide) <= 1 ? 22 : 0;
}

function stonefishV45MatePatternScore(game, raw) {
  if (game.fastIsMateMove(raw)) return 1000000;
  game.fastApply(raw);
  const ownSide = -game.side, enemySide = game.side;
  const freedom = stonefishV4KingFreedom(game, enemySide);
  const checking = game.in_check();
  let score = (8 - freedom) * 4 + (checking ? 12 : 0);
  score += stonefishV45LadderScore(game, ownSide, enemySide);
  score += stonefishV45TriangleScore(game, ownSide, enemySide);
  score += stonefishV45BackRankScore(game, ownSide, enemySide);
  score += stonefishV45SmotheredScore(game, ownSide, enemySide, raw);
  score += stonefishV45ArabianScore(game, ownSide, enemySide);
  score += stonefishV45BodenScore(game, ownSide, enemySide);
  // Queen + rook "kill box": a checked king with no freedom and both heavy piece types present.
  if (checking && freedom === 0 && stonefishV45Pieces(game, ownSide, 5).length && stonefishV45Pieces(game, ownSide, 4).length) score += 24;
  game.fastUndo();
  return score;
}

function stonefishV45PatternMove(game) {
  const legal = game.fastMoves();
  if (!legal.length) return null;
  let bestMate = null;
  for (let i=0;i<legal.length;i+=1) if (game.fastIsMateMove(legal[i])) { bestMate = legal[i]; break; }
  if (bestMate) return bestMate;

  // Strong named pattern takeover only when the geometry is very convincing.
  let best = null, bestScore = 0;
  for (let i=0;i<legal.length;i+=1) {
    const score = stonefishV45MatePatternScore(game, legal[i]);
    if (score > bestScore) { bestScore = score; best = legal[i]; }
  }
  return bestScore >= 60 ? best : null;
}

function stonefishV45InverseScore(game, raw, criterion) {
  if (criterion === 'giveCheck') return game.fastGivesCheck(raw) ? 1 : 0;
  game.fastApply(raw);
  const opponent = game.side;
  let score = 0;
  if (criterion === 'oppMobility') {
    score = -game.fastMoves().length;
  } else if (criterion === 'oppCheckRisk') {
    const replies = game.fastMoves();
    let checks = 0;
    for (let i=0;i<replies.length;i+=1) if (game.fastGivesCheck(replies[i])) checks += 1;
    score = -checks;
  } else if (criterion === 'oppKingFreedom') {
    score = -stonefishV4KingFreedom(game, opponent);
  } else if (criterion === 'oppCenter') {
    score = -stonefishV4CenterControl(game, opponent);
  } else if (criterion === 'oppBoardControl') {
    score = -stonefishV4BoardControl(game, opponent);
  }
  game.fastUndo();
  return score;
}

function stonefishV45BestByInverse(game, candidates, criterion) {
  if (candidates.length <= 1) return candidates;
  let best = -Infinity;
  const scores = new Array(candidates.length);
  for (let i=0;i<candidates.length;i+=1) {
    const score = stonefishV45InverseScore(game, candidates[i], criterion);
    scores[i]=score;
    if (score>best) best=score;
  }
  return candidates.filter((_,i)=>scores[i]===best);
}

function stonefishV45BestRawMoves(game) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return candidates;

  // Keep v4's proven lexicographic chain, but insert inverse questions beside the concepts they invert.
  for (let i=0;i<STONEFISH_V4_ORDER.length && candidates.length>1;i+=1) {
    const criterion = STONEFISH_V4_ORDER[i];
    candidates = stonefishV4BestByCriterion(game, candidates, criterion);
    if (criterion === 'mobility' && candidates.length > 1) {
      candidates = stonefishV45BestByInverse(game, candidates, 'oppMobility');
      if (candidates.length > 1) candidates = stonefishV45BestByInverse(game, candidates, 'oppCheckRisk');
      if (candidates.length > 1) candidates = stonefishV45BestByInverse(game, candidates, 'giveCheck');
    } else if (criterion === 'kingFreedom' && candidates.length > 1) {
      candidates = stonefishV45BestByInverse(game, candidates, 'oppKingFreedom');
    } else if (criterion === 'center' && candidates.length > 1) {
      candidates = stonefishV45BestByInverse(game, candidates, 'oppCenter');
    } else if (criterion === 'boardControl' && candidates.length > 1) {
      candidates = stonefishV45BestByInverse(game, candidates, 'oppBoardControl');
    }
  }

  // Among otherwise-equal v4.5 moves, tighten any visible mating net.
  if (candidates.length > 1) {
    let best = -Infinity, scores = new Array(candidates.length);
    for (let i=0;i<candidates.length;i+=1) { const s=stonefishV45MatePatternScore(game,candidates[i]); scores[i]=s; if(s>best)best=s; }
    candidates = candidates.filter((_,i)=>scores[i]===best);
  }
  return candidates;
}

function getStonefishV45MoveWithProfile(game, profileIndex = 0) {
  // A mate/pattern that is already on the board beats opening-book obedience.
  const pattern = stonefishV45PatternMove(game);
  if (pattern) return stonefishV3PublicMove(game, pattern);

  const book = stonefishV45BookMove(game, profileIndex);
  if (book) return stonefishV3PublicMove(game, book);

  const candidates = stonefishV45BestRawMoves(game);
  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
}

function getStonefishV45Move(game) {
  return getStonefishV45MoveWithProfile(game, 0);
}
