// Native v5.5: full legal-move alpha-beta and capture quiescence.
// Both variants call the same host and evaluation. An optional per-game reply
// policy supplies learned priorities and an effort request; the control uses
// the unchanged default budget.
const SF55C = {
  maxDepth: 4, nodes: 1200, multiPV: 3, qDepth: 5,
  piece: [0, 100, 325, 335, 510, 975, 0], mate: STONEFISH_V5_PRO_MATE,
};
const SF55C_PST = Array.from({length: 7}, () => new Int16Array(64));
const SF55C_EG = Array.from({length: 7}, () => new Int16Array(64));
for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7, r = sq >> 3;
  const center = 7 - Math.abs(2*f-7) - Math.abs(2*r-7);
  const fileCenter = 7 - Math.abs(2*f-7);
  SF55C_PST[1][sq] = r*7 + fileCenter*3 + (r >= 3 && f >= 2 && f <= 5 ? 14 : 0);
  SF55C_EG[1][sq] = r*r*5 + fileCenter;
  SF55C_PST[2][sq] = center*7 - (r === 0 ? 15 : 0);
  SF55C_EG[2][sq] = center*5;
  SF55C_PST[3][sq] = center*4 + r*3;
  SF55C_EG[3][sq] = center*3;
  SF55C_PST[4][sq] = r === 6 ? 30 : r*2;
  SF55C_EG[4][sq] = center*2;
  SF55C_PST[5][sq] = center*2 - (r > 2 ? 8 : 0);
  SF55C_EG[5][sq] = center*3;
  SF55C_PST[6][sq] = -center*5 - r*12 + (r === 0 && (f === 6 || f === 2) ? 45 : 0);
  SF55C_EG[6][sq] = center*8;
}

function sf55cEvaluate(g) {
  const b=g.boardState;
  let mg=0,eg=0,phase=0,wb=0,bb=0;
  const wp=new Int8Array(8),bp=new Int8Array(8);
  const whiteP=[],blackP=[];
  for(let sq=0;sq<64;sq++) {
    const p=b[sq]; if(!p)continue;
    const s=p>0?1:-1,t=Math.abs(p),ps=s>0?sq:(sq^56);
    mg+=s*(SF55C.piece[t]+SF55C_PST[t][ps]);
    eg+=s*(SF55C.piece[t]+SF55C_EG[t][ps]);
    phase+=t===2||t===3?1:t===4?2:t===5?4:0;
    if(t===1) {if(s>0){wp[sq&7]++;whiteP.push(sq);}else{bp[sq&7]++;blackP.push(sq);}}
    if(t===3){if(s>0)wb++;else bb++;}
  }
  const pawnScore=(pawns, own, opp, enemy, side)=>{
    let a=0,c=0;
    for(const sq of pawns){
      const f=sq&7,r=side>0?sq>>3:7-(sq>>3);
      if(own[f]>1){a-=12;c-=16;}
      if(!(f>0&&own[f-1])&&!(f<7&&own[f+1])){a-=11;c-=15;}
      let passed=true;
      for(const esq of enemy) if(Math.abs((esq&7)-f)<=1&&(side>0?esq>sq:esq<sq)){passed=false;break;}
      if(passed){
        a += [0,0,8,17,35,65,110,0][r];
        c += [0,0,15,32,65,120,210,0][r];
        if(r>=4){
          const prom=(side>0?56:0)+f;
          const ek=g.kingSq[-side],ok=g.kingSq[side];
          const ed=Math.max(Math.abs((ek&7)-f),Math.abs((ek>>3)-(prom>>3)));
          const od=Math.max(Math.abs((ok&7)-f),Math.abs((ok>>3)-(prom>>3)));
          c+=(ed-od)*r*3;
        }
      }
    }
    return [a,c];
  };
  const a=pawnScore(whiteP,wp,bp,blackP,1),c=pawnScore(blackP,bp,wp,whiteP,-1);
  mg+=a[0]-c[0];eg+=a[1]-c[1];
  if(wb>=2){mg+=30;eg+=45;}if(bb>=2){mg-=30;eg-=45;}
  for(let sq=0;sq<64;sq++){
    const p=b[sq];if(!p)continue;const t=Math.abs(p),s=p>0?1:-1,f=sq&7;
    if(t===4){const own=s>0?wp:bp,opp=s>0?bp:wp;if(!own[f]){mg+=s*(opp[f]?15:30);eg+=s*15;}}
    if(t===6){const step=s*8;let shield=0;for(let df=-1;df<=1;df++){if(f+df<0||f+df>7)continue;const x=sq+step+df;if(x>=0&&x<64&&b[x]===s)shield++;}mg+=s*shield*12;}
  }
  phase=Math.min(24,phase);
  let score=(mg*phase+eg*(24-phase))/24;
  // Help convert bare-king endings instead of endlessly checking from afar.
  if(phase<=4&&Math.abs(eg)>400){
    const winner=eg>0?1:-1,loser=g.kingSq[-winner],king=g.kingSq[winner];
    const edge=Math.max(Math.abs(2*(loser&7)-7),Math.abs(2*(loser>>3)-7));
    const proximity=14-Math.abs((king&7)-(loser&7))-Math.abs((king>>3)-(loser>>3));
    score+=winner*(edge*10+proximity*6);
  }
  return Math.round(score*g.side)+8;
}

function sf55cMoveId(m){return m.from|(m.to<<6)|((m.promotion||0)<<12);}
function sf55cOrder(ctx,m,tt,ply){
  const id=sf55cMoveId(m);
  if(id===tt)return 10000000;
  if(m.promotion)return 200000+SF55C.piece[m.promotion];
  if(m.captured)return 100000+SF55C.piece[m.captured]*16-SF55C.piece[m.piece];
  if(ctx.killers[ply]===id)return 90000;
  const history=ctx.history[id]||0;
  return history+(ctx.replyPolicy&&(ply&1)?ctx.replyPolicy.priority(m):0);
}

function sf55cInsufficient(g) {
  let minors = 0, knights = 0, color = -1, mixed = false;
  for (let sq = 0; sq < 64; sq++) {
    const piece = Math.abs(g.boardState[sq]);
    if (piece === 1 || piece === 4 || piece === 5) return false;
    if (piece === 2) { minors++; knights++; }
    if (piece === 3) {
      minors++;
      const squareColor = ((sq & 7) + (sq >> 3)) & 1;
      if (color !== -1 && color !== squareColor) mixed = true;
      color = squareColor;
    }
  }
  return minors <= 1 || (!knights && !mixed);
}
// Same exact repetition identity, formed without a long chain of strings.
// Keep the shared make/undo cache so every caller observes the original key.
function sf55cPositionKey(g) {
  if (g._stonefishRuntimePositionKey != null) return g._stonefishRuntimePositionKey;
  const b = g.boardState;
  const board = String.fromCharCode(
    b[0]+70, b[1]+70, b[2]+70, b[3]+70, b[4]+70, b[5]+70, b[6]+70, b[7]+70,
    b[8]+70, b[9]+70, b[10]+70, b[11]+70, b[12]+70, b[13]+70, b[14]+70, b[15]+70,
    b[16]+70, b[17]+70, b[18]+70, b[19]+70, b[20]+70, b[21]+70, b[22]+70, b[23]+70,
    b[24]+70, b[25]+70, b[26]+70, b[27]+70, b[28]+70, b[29]+70, b[30]+70, b[31]+70,
    b[32]+70, b[33]+70, b[34]+70, b[35]+70, b[36]+70, b[37]+70, b[38]+70, b[39]+70,
    b[40]+70, b[41]+70, b[42]+70, b[43]+70, b[44]+70, b[45]+70, b[46]+70, b[47]+70,
    b[48]+70, b[49]+70, b[50]+70, b[51]+70, b[52]+70, b[53]+70, b[54]+70, b[55]+70,
    b[56]+70, b[57]+70, b[58]+70, b[59]+70, b[60]+70, b[61]+70, b[62]+70, b[63]+70);
  return g._stonefishRuntimePositionKey = (g.side === 1 ? 'w|' : 'b|') + board + '|' + g.castling + '|' + g.ep;
}

function sf55cDraw(g,ctx,key) {
  // A third occurrence needs at least eight reversible plies. Earlier path
  // positions still must be recorded so later repetitions remain detectable.
  return g.halfmove>=100 || (g.halfmove>=8 && key && (g.positionCounts.get(key)||0)+(ctx.path.get(key)||0)+1>=3)
    || sf55cInsufficient(g);
}
function sf55cEnter(ctx,key) {
  if (key === null) return;
  ctx.path.set(key,(ctx.path.get(key)||0)+1);
  if(!ctx.positionIds.has(key))ctx.positionIds.set(key,ctx.positionIds.size+1);
  ctx.pathIds.push(ctx.positionIds.get(key));
}
function sf55cExit(ctx,key) {
  if (key === null) return;
  const count=ctx.path.get(key)-1;
  if(count)ctx.path.set(key,count);else ctx.path.delete(key);
  ctx.pathIds.pop();
}

// Capture/promotion-only legal generation for quiet quiescence nodes. Keep the
// normal move order, including all four underpromotions and en passant.
function sf55cTacticalMoves(g) {
  const board = g.boardState, side = g.side, moves = [];
  const safety = stonefishRuntimeKingSafety(g);
  const emit = (from, to, piece, promotion = 0, flags = 0) => {
    const move = { from, to, piece, promotion, flags,
      captured: flags & 2 ? 1 : Math.abs(board[to]) };
    if ((!safety.inCheck && piece !== 6 && !(flags & 2)
      && !stonefishRuntimeIsPinned(safety, from)) || g._testLegalRaw(move)) moves.push(move);
  };
  for (let from = 0; from < 64; from++) {
    const value = board[from];
    if (!value || (value > 0 ? 1 : -1) !== side) continue;
    const piece = Math.abs(value), file = from & 7, rank = from >> 3;
    if (piece === 1) {
      const step = side * 8, promotionRank = side === 1 ? 7 : 0;
      const forward = from + step;
      if (forward >= 0 && forward < 64 && (forward >> 3) === promotionRank && !board[forward]) {
        for (const promotion of [5, 4, 3, 2]) emit(from, forward, piece, promotion);
      }
      for (let df = -1; df <= 1; df += 2) {
        const to = from + step + df;
        if (file + df < 0 || file + df > 7 || to < 0 || to >= 64) continue;
        if (board[to] * side < 0) {
          if ((to >> 3) === promotionRank) {
            for (const promotion of [5, 4, 3, 2]) emit(from, to, piece, promotion);
          } else emit(from, to, piece);
        } else if (to === g.ep) emit(from, to, piece, 0, 2);
      }
      continue;
    }
    if (piece === 2) {
      for (let i = 0; i < 8; i++) {
        const f = file + SF_KNIGHT_DF[i], r = rank + SF_KNIGHT_DR[i];
        if (f >= 0 && f < 8 && r >= 0 && r < 8 && board[r * 8 + f] * side < 0)
          emit(from, r * 8 + f, piece);
      }
      continue;
    }
    const directions = piece === 3 ? SF_DIAG_DIRS : piece === 4 ? SF_ORTH_DIRS : SF_ALL_DIRS;
    for (let i = 0; i < directions.length; i += 2) {
      let f = file + directions[i], r = rank + directions[i + 1];
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const to = r * 8 + f;
        if (board[to]) { if (board[to] * side < 0) emit(from, to, piece); break; }
        if (piece === 6) break;
        f += directions[i]; r += directions[i + 1];
      }
    }
  }
  return moves;
}
function sf55cQ(g,ctx,alpha,beta,ply,remaining){
  ctx.nodes++;
  const check=g.in_check();
  // Captures and pawn moves cannot repeat an earlier position. Avoid building
  // board keys in these common quiescence nodes.
  const key=g.halfmove ? sf55cPositionKey(g) : null;
  let moves=check ? g.fastMoves() : null;
  if(check && !moves.length)return -SF55C.mate+ply;
  if(sf55cDraw(g,ctx,key))return 0;
  if(ctx.nodes>ctx.limit&&ctx.depth>2){
    if(!check && !g.fastHasLegalMove())return 0;
    ctx.abort=true;return sf55cEvaluate(g);
  }
  let stand=check?-SF55C.mate:sf55cEvaluate(g);
  if(ply>20)return !check && !g.fastHasLegalMove() ? 0 : sf55cEvaluate(g);
  if(!check){
    if(stand>=beta || remaining<=0)return g.fastHasLegalMove() ? stand : 0;
    if(stand>alpha)alpha=stand;
    moves=sf55cTacticalMoves(g);
    if(!moves.length)return g.fastHasLegalMove() ? stand : 0;
  }
  moves.sort((a,b)=>sf55cOrder(ctx,b,0,ply)-sf55cOrder(ctx,a,0,ply));
  sf55cEnter(ctx,key);
  try {
    for(const m of moves){
      if(!check&&!m.promotion&&stand+SF55C.piece[m.captured]+160<alpha)continue;
      let score;
      g.fastApply(m);
      try {score=-sf55cQ(g,ctx,-beta,-alpha,ply+1,remaining-1);}finally{g.fastUndo();}
      if(ctx.abort)break;
      if(score>stand)stand=score;if(score>alpha)alpha=score;if(alpha>=beta)break;
    }
  }finally{sf55cExit(ctx,key);}
  return stand;
}

function sf55cSearch(g,ctx,depth,alpha,beta,ply){
  if(depth<=0)return sf55cQ(g,ctx,alpha,beta,ply,SF55C.qDepth);
  // A learned low-priority quiet reply may receive a reduced null-window
  // probe. Verify at full depth whenever that probe favors the opponent.
  // With no learned policy this path is completely inactive.
  if(ctx.replyPolicy&&depth===1&&ply>=2&&!(ply&1)&&beta-alpha<=1){
    const state=g.historyStack[g.historyStack.length-1],move=state&&state.move;
    if(move&&!move.captured&&!move.promotion&&move.piece!==6&&!g.in_check()
      &&ctx.replyPolicy.isLowPriority(move)){
      const probe=sf55cQ(g,ctx,alpha,beta,ply,SF55C.qDepth);
      if(ctx.abort||probe>=beta)return probe;
    }
  }
  ctx.nodes++;
  const check=g.in_check(),moves=g.fastMoves();
  if(!moves.length)return check?-SF55C.mate+ply:0;
  const key=sf55cPositionKey(g);
  if(sf55cDraw(g,ctx,key))return 0;
  if(ctx.nodes>ctx.limit&&ctx.depth>2){ctx.abort=true;return sf55cEvaluate(g);}
  // Halfmove clock, mate distance, and the speculative repetition path are part
  // of the cache identity. A value from another history cannot hide a draw.
  const ttKey=key+'|'+g.halfmove+'|'+ply+'|'+ctx.pathIds.join(',');
  const hit=ctx.tt.get(ttKey),original=alpha;
  if(hit&&hit.depth>=depth){if(hit.flag===0)return hit.score;if(hit.flag===1&&hit.score>=beta)return hit.score;if(hit.flag===-1&&hit.score<=alpha)return hit.score;}
  moves.sort((a,b)=>sf55cOrder(ctx,b,hit?hit.move:0,ply)-sf55cOrder(ctx,a,hit?hit.move:0,ply));
  let best=-Infinity,bestMove=0,index=0;
  sf55cEnter(ctx,key);
  try {
    for(const m of moves){
      let score;
      g.fastApply(m);
      try {
        if(index===0)score=-sf55cSearch(g,ctx,depth-1,-beta,-alpha,ply+1);
        else{
          const reduce=depth>=3&&index>=4&&!check&&!m.captured&&!m.promotion&&!g.in_check()?1:0;
          score=-sf55cSearch(g,ctx,depth-1-reduce,-alpha-1,-alpha,ply+1);
          if(!ctx.abort&&score>alpha&&(reduce||score<beta))score=-sf55cSearch(g,ctx,depth-1,-beta,-alpha,ply+1);
        }
      }finally{g.fastUndo();}
      if(ctx.abort)break;
      if(score>best){best=score;bestMove=sf55cMoveId(m);}
      if(score>alpha)alpha=score;
      if(alpha>=beta){if(!m.captured){ctx.killers[ply]=bestMove;ctx.history[bestMove]=(ctx.history[bestMove]||0)+depth*depth;}break;}
      index++;
    }
  }finally{sf55cExit(ctx,key);}
  if(!ctx.abort)ctx.tt.set(ttKey,{depth,score:best,move:bestMove,flag:best<=original?-1:best>=beta?1:0});
  return best;
}

function sf55cHost(g,replyPolicy=null){
  const legal=g.fastMoves();if(!legal.length)return {finished:[],fastLeader:null,refutationGuard:null};
  const requested=replyPolicy&&replyPolicy.searchBudget;
  const limit=Number.isFinite(requested)?Math.max(SF55C.nodes,Math.min(SF55C.nodes+3600,Math.round(requested))):SF55C.nodes;
  const requestedDepth=replyPolicy&&replyPolicy.maxDepth;
  const depthLimit=Number.isFinite(requestedDepth)?Math.max(SF55C.maxDepth,Math.min(SF55C.maxDepth+2,Math.round(requestedDepth))):SF55C.maxDepth;
  const ctx={nodes:0,limit,depth:0,abort:false,tt:new Map(),path:new Map(),pathIds:[],positionIds:new Map(),killers:[],history:new Int32Array(32768),replyPolicy};
  let roots=legal.map(raw=>({raw,uci:stonefishV45RawUci(g,raw),score:0,deep:0,preliminary:0,tactical:0,knowledge:0,conversion:0}));
  for(const e of roots){g.fastApply(e.raw);try{e.score=-sf55cEvaluate(g);}finally{g.fastUndo();}}
  roots.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
  let complete=roots;
  for(let depth=1;depth<=depthLimit;depth++){
    ctx.depth=depth;
    const next=[];let threshold=-SF55C.mate;
    for(const previous of complete){
      const e={...previous};g.fastApply(e.raw);
      try{e.score=-sf55cSearch(g,ctx,depth-1,-SF55C.mate,-threshold,1);}finally{g.fastUndo();}
      if(ctx.abort)break;
      e.exact=e.score>threshold || threshold===-SF55C.mate;
      e.deep=e.score;e.preliminary=e.score;
      next.push(e);next.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
      if(next.length>=SF55C.multiPV)threshold=next[SF55C.multiPV-1].score;
    }
    if(ctx.abort)break;
    complete=next;
    if(Math.abs(complete[0].score)>SF55C.mate-100)break;
  }
  // Only completed, exact root scores are eligible for opponent adaptation.
  // Keep scores in centipawns; forced mates share the existing host's mate scale.
  for(const e of complete){if(!e.exact){e.score=-Infinity;e.deep=null;}}
  complete.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
  const result={finished:complete,fastLeader:complete[0].raw,refutationGuard:{eligible:false,verified:false,nativeFullWidth:true}};
  result.nodes=ctx.nodes;result.depth=ctx.depth-(ctx.abort?1:0);
  result.searchBudget=ctx.limit;
  result.depthLimit=depthLimit;
  globalThis.SF55C_LAST=result;
  return result;
}

globalThis.SF55C=SF55C;
