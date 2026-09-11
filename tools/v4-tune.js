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
const CENTER = [27,28,35,36];

function nonPawnMaterial(game, side) {
  const vals = [0,0,3,3,5,9,0];
  let n = 0;
  for (let sq=0;sq<64;sq++) {
    const p=game.boardState[sq];
    if (p && (p>0?1:-1)===side) n += vals[Math.abs(p)];
  }
  return n;
}
function isEndgame(game, side) { return nonPawnMaterial(game, side) <= 10; }

function kingFreedom(game, side) {
  const b=game.boardState, king=game.kingSq[side], file=king&7, rank=king>>3, kp=b[king];
  let score=0;
  for (let i=0;i<SF_ALL_DIRS.length;i+=2) {
    const f=file+SF_ALL_DIRS[i], r=rank+SF_ALL_DIRS[i+1];
    if (f<0||f>7||r<0||r>7) continue;
    const to=r*8+f, target=b[to];
    if (target && (target>0?1:-1)===side) continue;
    b[king]=0; b[to]=kp;
    const safe=!game._isAttacked(to,-side);
    b[king]=kp; b[to]=target;
    if (safe) score++;
  }
  return score;
}
function kingProtection(game, side) {
  const b=game.boardState, king=game.kingSq[side], file=king&7, rank=king>>3, kp=b[king];
  let score=0; b[king]=0;
  for (let i=0;i<SF_ALL_DIRS.length;i+=2) {
    const f=file+SF_ALL_DIRS[i], r=rank+SF_ALL_DIRS[i+1];
    if (f<0||f>7||r<0||r>7) continue;
    const sq=r*8+f, p=b[sq];
    if (p && (p>0?1:-1)===side) score += Math.abs(p)===1 ? 3 : 2;
    if (game._isAttacked(sq,side)) score += 1;
  }
  b[king]=kp; return score;
}
function center(game, side) {
  let score=0;
  for (const sq of CENTER) {
    const p=game.boardState[sq];
    if (p && (p>0?1:-1)===side) score+=2;
    if (game._isAttacked(sq,side)) score+=1;
  }
  return score;
}
function development(game, side) {
  const b=game.boardState;
  const n0=side===1?[1,6]:[57,62], b0=side===1?[2,5]:[58,61];
  const dp=side===1?11:51, ep=side===1?12:52;
  let score=0;
  for (let sq=0;sq<64;sq++) {
    if (b[sq]===side*2 && sq!==n0[0] && sq!==n0[1]) score+=2;
    if (b[sq]===side*3 && sq!==b0[0] && sq!==b0[1]) score+=2;
  }
  let dm=false, em=false;
  for (let sq=0;sq<64;sq++) if (b[sq]===side) {
    const f=sq&7;
    if (f===3 && sq!==dp) dm=true;
    if (f===4 && sq!==ep) em=true;
  }
  if (dm) score++; if (em) score++;
  return score;
}
function minorCentral(game, side) {
  let score=0, b=game.boardState;
  for (let sq=0;sq<64;sq++) {
    const p=b[sq]; if (p!==side*2 && p!==side*3) continue;
    const f=sq&7,r=sq>>3;
    if (CENTER.includes(sq)) score+=4;
    else if (f>=2&&f<=5&&r>=2&&r<=5) score+=2;
    else if (!(f===0||f===7||r===0||r===7)) score+=1;
  }
  return score;
}
function pawnStructure(game, side) {
  const b=game.boardState, files=new Array(8).fill(0), pawns=[];
  for (let sq=0;sq<64;sq++) if (b[sq]===side) { files[sq&7]++; pawns.push(sq); }
  let score=0;
  for (let f=0;f<8;f++) {
    if (files[f]>1) score-=2*(files[f]-1);
    if (files[f] && (f===0||!files[f-1]) && (f===7||!files[f+1])) score--;
  }
  for (const sq of pawns) {
    const f=sq&7,r=sq>>3;
    for (const df of [-1,1]) for (const dr of [-1,1]) {
      const nf=f+df,nr=r+dr;
      if (nf>=0&&nf<8&&nr>=0&&nr<8&&b[nr*8+nf]===side) score++;
    }
  }
  return score;
}
function rookActivity(game, side) {
  const b=game.boardState, rooks=[]; let score=0;
  for (let sq=0;sq<64;sq++) if (b[sq]===side*4) rooks.push(sq);
  for (const sq of rooks) {
    const f=sq&7,r=sq>>3; let ownPawn=false;
    for (let rr=0;rr<8;rr++) if (b[rr*8+f]===side) ownPawn=true;
    if (!ownPawn) score+=2;
    if ((side===1&&r===6)||(side===-1&&r===1)) score+=2;
    if ((side===1&&r>0)||(side===-1&&r<7)) score++;
  }
  if (rooks.length===2 && (rooks[0]>>3)===(rooks[1]>>3)) {
    let clear=true;
    for (let sq=Math.min(...rooks)+1;sq<Math.max(...rooks);sq++) if (b[sq]) clear=false;
    if (clear) score+=3;
  }
  return score;
}
function kingPlacement(game, side) {
  const k=game.kingSq[side], f=k&7,r=k>>3;
  if (isEndgame(game,side)) return 7-Math.abs(f-3.5)-Math.abs(r-3.5);
  const c1=side===1?2:58,c2=side===1?6:62,home=side===1?4:60;
  return (k===c1||k===c2)?3:(k===home?1:0);
}
function pawnProgress(game, side) {
  if (!isEndgame(game,side)) return 0;
  let score=0;
  for (let sq=0;sq<64;sq++) if (game.boardState[sq]===side) {
    const r=sq>>3;
    score += side===1 ? r-1 : 6-r;
  }
  return score;
}
function boardControl(game, side) {
  let n=0;
  for (let sq=0;sq<64;sq++) if (game._isAttacked(sq,side)) n++;
  return n;
}

function feature(game, raw, criterion) {
  if (criterion==='promotion') return raw.promotion || 0;
  if (criterion==='check') return game.fastGivesCheck(raw)?1:0;
  if (criterion==='endgameCheck') {
    const side=game.side;
    return isEndgame(game,side) && game.fastGivesCheck(raw)?1:0;
  }
  if (criterion==='castleNow') return (raw.flags&12)?1:0;
  if (criterion==='fiftyReset') return game.halfmove>=60 && (raw.piece===1 || raw.captured)?1:0;

  game.fastApply(raw);
  const side=-game.side;
  let score=0;
  if (criterion==='repetitionAvoid') score=-(game.positionCounts.get(game.fastPositionKey())||0);
  else if (criterion==='openingDevelop') score=game.fullmove<=13?development(game,side):0;
  else if (criterion==='queenDiscipline') {
    if (game.fullmove<=10) {
      const home=side===1?3:59;
      score=game.boardState[home]===side*5?1:0;
    }
  }
  else if (criterion==='mobility') score=game.fastMobility(side);
  else if (criterion==='pieceSupport') score=game._isAttacked(raw.to,side)?1:0;
  else if (criterion==='kingFreedom') score=kingFreedom(game,side);
  else if (criterion==='kingProtection') score=kingProtection(game,side);
  else if (criterion==='center') score=center(game,side);
  else if (criterion==='minorCentral') score=minorCentral(game,side);
  else if (criterion==='pawnStructure') score=pawnStructure(game,side);
  else if (criterion==='rookActivity') score=rookActivity(game,side);
  else if (criterion==='kingPlacement') score=kingPlacement(game,side);
  else if (criterion==='endgamePawnProgress') score=pawnProgress(game,side);
  else if (criterion==='boardControl') score=boardControl(game,side);
  game.fastUndo();
  return score;
}

function chooseV3(game,rng) {
  const m=getStonefishV3BestRawMoves(game);
  return m.length?m[Math.floor(rng()*m.length)]:null;
}
function chooseV4(game,rng,cfg) {
  let c=getStonefishV3BestRawMoves(game).slice();
  if (!c.length) return null;
  for (const criterion of cfg.order) {
    if (c.length<=1) break;
    let best=-Infinity, scores=new Array(c.length);
    for (let i=0;i<c.length;i++) { const s=feature(game,c[i],criterion); scores[i]=s; if (s>best) best=s; }
    const kept=[]; for (let i=0;i<c.length;i++) if (scores[i]===best) kept.push(c[i]);
    c=kept;
  }
  return c[Math.floor(rng()*c.length)];
}
function cheapDraw(game) {
  if (game.halfmove>=100||game._insufficientMaterial()) return true;
  return (game.positionCounts.get(game.fastPositionKey())||0)>=3;
}
function play(cfg,gameNo,maxPlies=500) {
  const game=new Chess(), v4White=(gameNo&1)===0;
  const r3=seeded(0x9e3779b9^(gameNo*0x45d9f3b)), r4=seeded(0x85ebca6b^(gameNo*0x27d4eb2d));
  for (let ply=0;ply<maxPlies;ply++) {
    const v4Turn=(game.turn()==='w')===v4White;
    const move=v4Turn?chooseV4(game,r4,cfg):chooseV3(game,r3);
    if (!move) {
      if (!game.in_check()) return 'D';
      const whiteWon=game.turn()==='b';
      return whiteWon===v4White?'W':'L';
    }
    game._applyRaw(move,true);
    if (cheapDraw(game)) return 'D';
  }
  return 'D';
}
function test(cfg,games,start) {
  let W=0,L=0,D=0;
  for (let i=0;i<games;i++) {
    const r=play(cfg,start+i);
    if (r==='W')W++; else if(r==='L')L++; else D++;
  }
  return {W,L,D,games,score:W-3*L+0.01*D};
}
function rank(a,b) {
  return b.r.score-a.r.score || b.r.W-a.r.W || a.r.L-b.r.L;
}

const tail=['mobility','pieceSupport','center','minorCentral','kingFreedom','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const prefixes=[
 ['promotion','openingDevelop','queenDiscipline','castleNow','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck'],
 ['promotion','openingDevelop','castleNow','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck'],
 ['promotion','castleNow','openingDevelop','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck'],
 ['promotion','openingDevelop','queenDiscipline','repetitionAvoid','castleNow','fiftyReset','endgamePawnProgress','endgameCheck'],
 ['promotion','openingDevelop','queenDiscipline','castleNow','fiftyReset','repetitionAvoid','endgameCheck','endgamePawnProgress'],
 ['promotion','repetitionAvoid','openingDevelop','queenDiscipline','castleNow','fiftyReset','endgamePawnProgress','endgameCheck'],
 ['promotion','openingDevelop','queenDiscipline','castleNow','endgamePawnProgress','endgameCheck','repetitionAvoid','fiftyReset'],
 ['promotion','openingDevelop','queenDiscipline','castleNow','endgameCheck','endgamePawnProgress','fiftyReset','repetitionAvoid']
];
const tailVariants=[
 tail,
 ['pieceSupport','mobility','center','minorCentral','kingFreedom','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'],
 ['mobility','minorCentral','pieceSupport','center','kingFreedom','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'],
 ['mobility','center','pieceSupport','minorCentral','kingFreedom','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'],
 ['mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl']
];
const cfgs=[]; let n=0;
for (const pre of prefixes) for (const t of tailVariants) cfgs.push({name:'c'+n++,order:[...pre,...t]});
for (const base of cfgs.slice(0,12)) {
  const o=base.order.slice();
  const at=o.indexOf('mobility')+1;
  o.splice(at,0,'check');
  cfgs.push({name:'check'+n++,order:o});
}

console.log('FOCUSED SCREEN',cfgs.length,'x 12');
const s=cfgs.map(cfg=>({cfg,r:test(cfg,12,0)})).sort(rank);
for (const x of s.slice(0,12)) console.log(x.cfg.name,x.cfg.order.join('>'),x.r);

console.log('CONFIRM top 10 x 40');
const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,40,1200)})).sort(rank);
for (const x of c) console.log(x.cfg.name,x.cfg.order.join('>'),x.r);

console.log('FINAL top 4 x 100');
const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,5000)})).sort(rank);
for (const x of f) console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;

new Function(engine + '\n' + v3 + '\n' + harness)();
