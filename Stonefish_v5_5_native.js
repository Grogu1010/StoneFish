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

function sf55cEvaluateJS(g) {
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

// Packed native identities are exact: four board squares per code unit,
// plus one code unit for side, castling rights and en passant.
function sf55cPackedPositionKey(g){
  const b=g.boardState;
  return String.fromCharCode(((b[0]+6)|(b[1]+6)<<4|(b[2]+6)<<8|(b[3]+6)<<12),
    ((b[4]+6)|(b[5]+6)<<4|(b[6]+6)<<8|(b[7]+6)<<12),
    ((b[8]+6)|(b[9]+6)<<4|(b[10]+6)<<8|(b[11]+6)<<12),
    ((b[12]+6)|(b[13]+6)<<4|(b[14]+6)<<8|(b[15]+6)<<12),
    ((b[16]+6)|(b[17]+6)<<4|(b[18]+6)<<8|(b[19]+6)<<12),
    ((b[20]+6)|(b[21]+6)<<4|(b[22]+6)<<8|(b[23]+6)<<12),
    ((b[24]+6)|(b[25]+6)<<4|(b[26]+6)<<8|(b[27]+6)<<12),
    ((b[28]+6)|(b[29]+6)<<4|(b[30]+6)<<8|(b[31]+6)<<12),
    ((b[32]+6)|(b[33]+6)<<4|(b[34]+6)<<8|(b[35]+6)<<12),
    ((b[36]+6)|(b[37]+6)<<4|(b[38]+6)<<8|(b[39]+6)<<12),
    ((b[40]+6)|(b[41]+6)<<4|(b[42]+6)<<8|(b[43]+6)<<12),
    ((b[44]+6)|(b[45]+6)<<4|(b[46]+6)<<8|(b[47]+6)<<12),
    ((b[48]+6)|(b[49]+6)<<4|(b[50]+6)<<8|(b[51]+6)<<12),
    ((b[52]+6)|(b[53]+6)<<4|(b[54]+6)<<8|(b[55]+6)<<12),
    ((b[56]+6)|(b[57]+6)<<4|(b[58]+6)<<8|(b[59]+6)<<12),
    ((b[60]+6)|(b[61]+6)<<4|(b[62]+6)<<8|(b[63]+6)<<12),
    (g.side===1?1:0)|(g.castling<<1)|((g.ep+1)<<5));
}
function sf55cPackHistoryKey(key){
  const tail=key.slice(67).split('|');
  return String.fromCharCode(((key.charCodeAt(2)-64)|(key.charCodeAt(3)-64)<<4|(key.charCodeAt(4)-64)<<8|(key.charCodeAt(5)-64)<<12),
    ((key.charCodeAt(6)-64)|(key.charCodeAt(7)-64)<<4|(key.charCodeAt(8)-64)<<8|(key.charCodeAt(9)-64)<<12),
    ((key.charCodeAt(10)-64)|(key.charCodeAt(11)-64)<<4|(key.charCodeAt(12)-64)<<8|(key.charCodeAt(13)-64)<<12),
    ((key.charCodeAt(14)-64)|(key.charCodeAt(15)-64)<<4|(key.charCodeAt(16)-64)<<8|(key.charCodeAt(17)-64)<<12),
    ((key.charCodeAt(18)-64)|(key.charCodeAt(19)-64)<<4|(key.charCodeAt(20)-64)<<8|(key.charCodeAt(21)-64)<<12),
    ((key.charCodeAt(22)-64)|(key.charCodeAt(23)-64)<<4|(key.charCodeAt(24)-64)<<8|(key.charCodeAt(25)-64)<<12),
    ((key.charCodeAt(26)-64)|(key.charCodeAt(27)-64)<<4|(key.charCodeAt(28)-64)<<8|(key.charCodeAt(29)-64)<<12),
    ((key.charCodeAt(30)-64)|(key.charCodeAt(31)-64)<<4|(key.charCodeAt(32)-64)<<8|(key.charCodeAt(33)-64)<<12),
    ((key.charCodeAt(34)-64)|(key.charCodeAt(35)-64)<<4|(key.charCodeAt(36)-64)<<8|(key.charCodeAt(37)-64)<<12),
    ((key.charCodeAt(38)-64)|(key.charCodeAt(39)-64)<<4|(key.charCodeAt(40)-64)<<8|(key.charCodeAt(41)-64)<<12),
    ((key.charCodeAt(42)-64)|(key.charCodeAt(43)-64)<<4|(key.charCodeAt(44)-64)<<8|(key.charCodeAt(45)-64)<<12),
    ((key.charCodeAt(46)-64)|(key.charCodeAt(47)-64)<<4|(key.charCodeAt(48)-64)<<8|(key.charCodeAt(49)-64)<<12),
    ((key.charCodeAt(50)-64)|(key.charCodeAt(51)-64)<<4|(key.charCodeAt(52)-64)<<8|(key.charCodeAt(53)-64)<<12),
    ((key.charCodeAt(54)-64)|(key.charCodeAt(55)-64)<<4|(key.charCodeAt(56)-64)<<8|(key.charCodeAt(57)-64)<<12),
    ((key.charCodeAt(58)-64)|(key.charCodeAt(59)-64)<<4|(key.charCodeAt(60)-64)<<8|(key.charCodeAt(61)-64)<<12),
    ((key.charCodeAt(62)-64)|(key.charCodeAt(63)-64)<<4|(key.charCodeAt(64)-64)<<8|(key.charCodeAt(65)-64)<<12),
    (key[0]==='w'?1:0)|(Number(tail[0])<<1)|((Number(tail[1])+1)<<5));
}

// Stable ordering evaluates each priority once without modifying move objects.
function sf55cOrderMoves(moves,ctx,tt,ply){
 if(moves.length<2)return;
 const orderPriorities=ctx.orderPriorities||(ctx.orderPriorities=[]);
 let priorities=orderPriorities[ply];
 if(!priorities||priorities.length<moves.length)priorities=orderPriorities[ply]=new Int32Array(moves.length);
 priorities[0]=sf55cOrder(ctx,moves[0],tt,ply);
 for(let i=1;i<moves.length;i++){
  const move=moves[i],priority=sf55cOrder(ctx,move,tt,ply);let j=i-1;
  while(j>=0&&priorities[j]<priority){moves[j+1]=moves[j];priorities[j+1]=priorities[j];j--;}
  moves[j+1]=move;priorities[j+1]=priority;
 }
}

// A pawn, rook or queen rules out insufficient material. Carry this count
// through make/undo, and still inspect minor-only endings in full.
function sf55cMaterialMoveDelta(move){
 return (move.captured===1||move.captured===4||move.captured===5?1:0)
  +(move.piece===1&&move.promotion&&(move.promotion===2||move.promotion===3)?1:0);
}

// Search-local make/undo keeps the exact Chess state transitions while avoiding
// generic history/cache-frame allocation at every speculative node. Real game
// history and runtime memo fields remain untouched throughout the search.
function sf55cEnsureUndo(ctx){
 if(ctx.undoCaptured)return;
 ctx.undoCaptured=new Int8Array(64);
 ctx.undoCastling=new Int8Array(64);
 ctx.undoEp=new Int8Array(64);
 ctx.undoHalfmove=new Int32Array(64);
 ctx.undoFullmove=new Int32Array(64);
 ctx.undoKingW=new Int8Array(64);
 ctx.undoKingB=new Int8Array(64);
 ctx.undoSide=new Int8Array(64);
 ctx.moveStack=new Array(64);
}
function sf55cApply(g,ctx,move,ply){
 sf55cEnsureUndo(ctx);
 const b=g.boardState,side=g.side;
 const capturedPiece=move.flags&2?b[move.to+(side===1?-8:8)]:b[move.to];
 ctx.undoCaptured[ply]=capturedPiece;
 ctx.undoCastling[ply]=g.castling;
 ctx.undoEp[ply]=g.ep;
 ctx.undoHalfmove[ply]=g.halfmove;
 ctx.undoFullmove[ply]=g.fullmove;
 ctx.undoKingW[ply]=g.kingSq[1];
 ctx.undoKingB[ply]=g.kingSq[-1];
 ctx.undoSide[ply]=side;
 ctx.moveStack[ply]=move;
 const moving=b[move.from];
 b[move.to]=moving;b[move.from]=0;
 if(move.flags&2)b[move.to+(side===1?-8:8)]=0;
 if(move.promotion)b[move.to]=side*move.promotion;
 if(Math.abs(moving)===6){
  g.kingSq[side]=move.to;
  if(side===1)g.castling&=~3;else g.castling&=~12;
  if(move.flags&4){const rf=side===1?7:63,rt=side===1?5:61;b[rt]=b[rf];b[rf]=0;}
  else if(move.flags&8){const rf=side===1?0:56,rt=side===1?3:59;b[rt]=b[rf];b[rf]=0;}
 }
 if(move.from===0||move.to===0)g.castling&=~2;
 if(move.from===7||move.to===7)g.castling&=~1;
 if(move.from===56||move.to===56)g.castling&=~8;
 if(move.from===63||move.to===63)g.castling&=~4;
 g.ep=-1;
 if(Math.abs(moving)===1&&Math.abs(move.to-move.from)===16)g.ep=(move.from+move.to)>>1;
 g.halfmove=(Math.abs(moving)===1||capturedPiece)?0:g.halfmove+1;
 if(side===-1)g.fullmove++;
 g.side=-side;
 if(g._sf55cKernelSearchActive)g._sf55cKernelDirty=true;
}
function sf55cUndo(g,ctx,move,ply){
 const side=ctx.undoSide[ply],b=g.boardState,capturedPiece=ctx.undoCaptured[ply];
 g.side=side;g.castling=ctx.undoCastling[ply];g.ep=ctx.undoEp[ply];
 g.halfmove=ctx.undoHalfmove[ply];g.fullmove=ctx.undoFullmove[ply];
 g.kingSq[1]=ctx.undoKingW[ply];g.kingSq[-1]=ctx.undoKingB[ply];
 b[move.from]=side*move.piece;b[move.to]=capturedPiece;
 if(move.flags&2){b[move.to]=0;b[move.to+(side===1?-8:8)]=capturedPiece;}
 if(move.flags&4){const rf=side===1?7:63,rt=side===1?5:61;b[rf]=b[rt];b[rt]=0;}
 else if(move.flags&8){const rf=side===1?0:56,rt=side===1?3:59;b[rf]=b[rt];b[rt]=0;}
 ctx.moveStack[ply]=null;
 if(g._sf55cKernelSearchActive)g._sf55cKernelDirty=true;
}

function sf55cDraw(g,ctx,key) {
  if(g.halfmove>=100)return true;
  // A third occurrence needs eight reversible plies. Public history keys keep
  // their original representation; convert them once when this search needs it.
  if(g.halfmove>=8&&key){
    let counts=g.positionCounts;
    if(key.length===17){
      if(!ctx.compactCounts)ctx.compactCounts=new Map(Array.from(g.positionCounts,([k,v])=>[sf55cPackHistoryKey(k),v]));
      counts=ctx.compactCounts;
    }
    const pathId=ctx.positionIds.get(key);
    const pathCount=ctx.pathCounts
      ?(pathId===undefined?0:(ctx.pathCounts[pathId]||0))
      :(ctx.path?(ctx.path.get(key)||0):0);
    if((counts.get(key)||0)+pathCount+1>=3)return true;
  }
  return !(ctx.material>0)&&sf55cInsufficient(g);
}

function sf55cEnter(ctx,key) {
  if (key === null) return;
  if(ctx.pathSignature===undefined){ctx.pathSignature=0;ctx.pathSignatureStack=[];ctx.pathSignatureIds=new Map();}
  let id=ctx.positionIds.get(key);
  if(id===undefined){id=ctx.positionIds.size+1;ctx.positionIds.set(key,id);}
  if(ctx.pathCounts)ctx.pathCounts[id]=(ctx.pathCounts[id]||0)+1;
  else if(ctx.path)ctx.path.set(key,(ctx.path.get(key)||0)+1);
  const parent=ctx.pathSignature,pair=parent*16384+id;
  let signature=ctx.pathSignatureIds.get(pair);
  if(signature===undefined){signature=ctx.pathSignatureIds.size+1;ctx.pathSignatureIds.set(pair,signature);}
  ctx.pathSignatureStack.push(parent);
  ctx.pathSignature=signature;
}
function sf55cExit(ctx,key) {
  if (key === null) return;
  const id=ctx.positionIds.get(key);
  if(ctx.pathCounts)ctx.pathCounts[id]--;
  else if(ctx.path){
    const count=ctx.path.get(key)-1;
    if(count)ctx.path.set(key,count);else ctx.path.delete(key);
  }
  ctx.pathSignature=ctx.pathSignatureStack.pop();
}

// Capture/promotion-only legal generation for quiet quiescence nodes. Keep the
// normal move order, including all four underpromotions and en passant.
function sf55cTacticalMovesJS(g) {
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
  const check=sf55cInCheck(g);
  // Captures and pawn moves cannot repeat an earlier position. Avoid building
  // board keys in these common quiescence nodes.
  const key=g.halfmove ? sf55cPackedPositionKey(g) : null;
  let moves=check ? sf55cLegalMoves(g,ctx,ply) : null;
  if(check && !moves.length)return -SF55C.mate+ply;
  if(sf55cDraw(g,ctx,key))return 0;
  if(ctx.nodes>ctx.limit&&ctx.depth>2){
    if(!check && !sf55cHasLegalMove(g))return 0;
    ctx.abort=true;return sf55cEvaluate(g);
  }
  let stand=check?-SF55C.mate:sf55cEvaluate(g);
  if(ply>20)return !check && !sf55cHasLegalMove(g) ? 0 : sf55cEvaluate(g);
  if(!check){
    if(stand>=beta || remaining<=0)return sf55cHasLegalMove(g) ? stand : 0;
    if(stand>alpha)alpha=stand;
    moves=sf55cTacticalMoves(g,ctx,ply);
    if(!moves.length)return sf55cHasLegalMove(g) ? stand : 0;
  }
  sf55cOrderMoves(moves,ctx,0,ply);
  sf55cEnter(ctx,key);
  try {
    for(const m of moves){
      if(!check&&!m.promotion&&stand+SF55C.piece[m.captured]+160<alpha)continue;
      let score;
      const materialDelta=sf55cMaterialMoveDelta(m);ctx.material-=materialDelta;sf55cApply(g,ctx,m,ply+1);
      try {score=-sf55cQ(g,ctx,-beta,-alpha,ply+1,remaining-1);}finally{sf55cUndo(g,ctx,m,ply+1);ctx.material+=materialDelta;}
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
    const state=g.historyStack[g.historyStack.length-1];
    const move=ctx.moveStack&&ctx.moveStack[ply]||state&&state.move;
    if(move&&!move.captured&&!move.promotion&&move.piece!==6&&!sf55cInCheck(g)
      &&ctx.replyPolicy.isLowPriority(move)){
      const probe=sf55cQ(g,ctx,alpha,beta,ply,SF55C.qDepth);
      if(ctx.abort||probe>=beta)return probe;
    }
  }
  ctx.nodes++;
  const key=sf55cPackedPositionKey(g);
  // Halfmove clock, mate distance, and the speculative repetition path are part
  // of the cache identity. A value from another history cannot hide a draw.
  const ttMeta=g.halfmove+(ply<<7)+(ctx.pathSignature<<13);
  const ttBucket=ctx.tt.get(key);
  let hit=-1;
  if(ttBucket)for(let i=0;i<ttBucket.length;i+=5){if(ttBucket[i]===ttMeta){hit=i;break;}}
  const original=alpha;
  // A stored entry can only come from a non-terminal, non-draw node. While the
  // node budget is still live, the exact same TT cutoff can therefore happen
  // before legal-move generation. Over-budget nodes retain the original order:
  // terminal -> draw -> abort -> TT.
  const budgetLive=ctx.nodes<=ctx.limit||ctx.depth<=2;
  if(budgetLive&&hit>=0&&ttBucket[hit+1]>=depth){
    const hitScore=ttBucket[hit+2],hitFlag=ttBucket[hit+4];
    if(hitFlag===0)return hitScore;
    if(hitFlag===1&&hitScore>=beta)return hitScore;
    if(hitFlag===-1&&hitScore<=alpha)return hitScore;
  }
  const check=sf55cInCheck(g),moves=sf55cLegalMoves(g,ctx,ply);
  if(!moves.length)return check?-SF55C.mate+ply:0;
  if(sf55cDraw(g,ctx,key))return 0;
  if(!budgetLive){ctx.abort=true;return sf55cEvaluate(g);}
  sf55cOrderMoves(moves,ctx,hit>=0?ttBucket[hit+3]:0,ply);
  let best=-Infinity,bestMove=0,index=0;
  sf55cEnter(ctx,key);
  try {
    for(const m of moves){
      let score;
      const materialDelta=sf55cMaterialMoveDelta(m);ctx.material-=materialDelta;sf55cApply(g,ctx,m,ply+1);
      try {
        if(index===0)score=-sf55cSearch(g,ctx,depth-1,-beta,-alpha,ply+1);
        else{
          const quietLate=!check&&!m.captured&&!m.promotion&&!sf55cInCheck(g);
          const learnedFastReduction=Boolean(
            typeof process!=='undefined'&&process.env&&ctx.replyPolicy&&(ply&1)
              &&(process.env.ARMX_POLICY_LMR==='1'
                ||(process.env.ARMX_FAST_SCREEN==='1'&&process.env.ARMX_FAST_POLICY_LMR==='1'))
              &&depth>=3&&index>=2&&quietLate&&ctx.replyPolicy.isLowPriority(m)
          );
          const reduce=learnedFastReduction?Math.min(2,depth-1):(depth>=3&&index>=4&&quietLate?1:0);
          score=-sf55cSearch(g,ctx,depth-1-reduce,-alpha-1,-alpha,ply+1);
          if(!ctx.abort&&score>alpha&&(reduce||score<beta))score=-sf55cSearch(g,ctx,depth-1,-beta,-alpha,ply+1);
        }
      }finally{sf55cUndo(g,ctx,m,ply+1);ctx.material+=materialDelta;}
      if(ctx.abort)break;
      if(score>best){best=score;bestMove=sf55cMoveId(m);}
      if(score>alpha)alpha=score;
      if(alpha>=beta){if(!m.captured){ctx.killers[ply]=bestMove;ctx.history[bestMove]=(ctx.history[bestMove]||0)+depth*depth;}break;}
      index++;
    }
  }finally{sf55cExit(ctx,key);}
  if(!ctx.abort){
    let bucket=ctx.tt.get(key);if(!bucket){bucket=[];ctx.tt.set(key,bucket);}
    let slot=-1;
    for(let i=0;i<bucket.length;i+=5){if(bucket[i]===ttMeta){slot=i;break;}}
    if(slot<0){slot=bucket.length;bucket.length+=5;}
    bucket[slot]=ttMeta;bucket[slot+1]=depth;bucket[slot+2]=best;bucket[slot+3]=bestMove;
    bucket[slot+4]=best<=original?-1:best>=beta?1:0;
  }
  return best;
}


function sf55cNativeAcceleratedHost(g,replyPolicy){
  const k=SF55C_KERNEL;
  if(!k||!k.api.search_all||!k.scores||!k.policyWeights||!replyPolicy)return null;
  k.board.set(g.boardState);
  k.policyWeights.fill(0);
  if(replyPolicy.weights)k.policyWeights.set(replyPolicy.weights);
  const limit=Number.isFinite(replyPolicy.searchBudget)
    ?Math.max(SF55C.nodes,Math.min(SF55C.nodes+8400,Math.round(replyPolicy.searchBudget))):SF55C.nodes;
  const depthLimit=Number.isFinite(replyPolicy.maxDepth)
    ?Math.max(SF55C.maxDepth,Math.min(SF55C.maxDepth+2,Math.round(replyPolicy.maxDepth))):SF55C.maxDepth;
  let publicHistoryCount=0;
  if(k.publicKeys&&k.publicCounts){
    const packedHistoryCache=g._sf55cPackedHistoryCache||(g._sf55cPackedHistoryCache=new Map());
    for(const [historyKey,countValue] of g.positionCounts){
      if(publicHistoryCount>=512)break;
      let packedCodes=packedHistoryCache.get(historyKey);
      if(!packedCodes){
        const packed=historyKey.length===17?historyKey:sf55cPackHistoryKey(historyKey);
        packedCodes=new Uint16Array(17);
        for(let i=0;i<17;i++)packedCodes[i]=packed.charCodeAt(i);
        packedHistoryCache.set(historyKey,packedCodes);
      }
      k.publicKeys.set(packedCodes,publicHistoryCount*17);
      k.publicCounts[publicHistoryCount]=countValue;
      publicHistoryCount++;
    }
  }
  const count=k.api.search_all(
    g.side,g.castling,g.ep,g.kingSq[1],g.kingSq[-1],g.halfmove,
    depthLimit,limit,SF55C.qDepth,1,publicHistoryCount);
  const finished=new Array(count);
  for(let i=0;i<count;i++){
    const m=k.moves[i],raw={from:m&63,to:(m>>>6)&63,piece:(m>>>12)&7,
      captured:(m>>>15)&7,promotion:(m>>>18)&7,flags:m>>>21};
    const exact=!k.exact||k.exact[i]!==0;
    const score=exact?k.scores[i]:-Infinity;
    finished[i]={raw,uci:stonefishV45RawUci(g,raw),score,deep:exact?k.scores[i]:null,
      preliminary:exact?k.scores[i]:null,tactical:0,knowledge:0,conversion:0,exact};
  }
  finished.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
  const result={finished,fastLeader:finished.length?finished[0].raw:null,
    refutationGuard:{eligible:false,verified:false,nativeFullWidth:true,compiledSearch:true},
    nodes:k.api.search_nodes?k.api.search_nodes():limit,
    depth:k.api.search_depth?k.api.search_depth():depthLimit,
    searchBudget:limit,depthLimit};
  return result;
}

function sf55cHost(g,replyPolicy=null){
  if(replyPolicy&&!(typeof process!=='undefined'&&process.env&&process.env.ARMX_COMPILED_EXPERIMENT==='0')){
    const accelerated=sf55cNativeAcceleratedHost(g,replyPolicy);
    if(accelerated){globalThis.SF55C_LAST=accelerated;return accelerated;}
  }
  sf55cSyncKernelConfig();
  g._sf55cKernelSearchActive=true;g._sf55cKernelDirty=true;
  const legal=sf55cLegalMoves(g);if(!legal.length){g._sf55cKernelSearchActive=false;g._sf55cKernelDirty=true;return {finished:[],fastLeader:null,refutationGuard:null};}
  const requested=replyPolicy&&replyPolicy.searchBudget;
  const limit=Number.isFinite(requested)?Math.max(SF55C.nodes,Math.min(SF55C.nodes+8400,Math.round(requested))):SF55C.nodes;
  const requestedDepth=replyPolicy&&replyPolicy.maxDepth;
  const depthLimit=Number.isFinite(requestedDepth)?Math.max(SF55C.maxDepth,Math.min(SF55C.maxDepth+2,Math.round(requestedDepth))):SF55C.maxDepth;
  const ctx={nodes:0,limit,depth:0,abort:false,tt:new Map(),pathCounts:[],pathSignature:0,pathSignatureStack:[],pathSignatureIds:new Map(),positionIds:new Map(),killers:[],history:new Int32Array(32768),orderPriorities:[],moveBuffers:[],replyPolicy};
  ctx.material=0;for(const piece of g.boardState){const type=Math.abs(piece);if(type===1||type===4||type===5)ctx.material++;}
  let roots=legal.map(raw=>({raw,uci:stonefishV45RawUci(g,raw),score:0,deep:0,preliminary:0,tactical:0,knowledge:0,conversion:0}));
  for(const e of roots){sf55cApply(g,ctx,e.raw,1);try{e.score=-sf55cEvaluate(g);}finally{sf55cUndo(g,ctx,e.raw,1);}}
  roots.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
  let complete=roots;
  for(let depth=1;depth<=depthLimit;depth++){
    ctx.depth=depth;
    const next=[];let threshold=-SF55C.mate;
    for(const previous of complete){
      const e={...previous};const materialDelta=sf55cMaterialMoveDelta(e.raw);ctx.material-=materialDelta;sf55cApply(g,ctx,e.raw,1);
      try{e.score=-sf55cSearch(g,ctx,depth-1,-SF55C.mate,-threshold,1);}finally{sf55cUndo(g,ctx,e.raw,1);ctx.material+=materialDelta;}
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
  g._sf55cKernelSearchActive=false;g._sf55cKernelDirty=true;
  return result;
}

globalThis.SF55C=SF55C;

// BEGIN GENERATED V55 WASM
// Zig 0.14.1; SHA-256 3d54e3343d1b47cb8a36d5a62f1766482ba7aa91f440a3d1f99baa839f2d1e33
const SF55C_WASM_BYTES=new Uint8Array([
  0,97,115,109,1,0,0,0,1,90,11,96,0,1,127,96,3,127,127,127,1,127,96,9,127,127,127,127,127,127,127,127,127,0,96,2,127,127,1,127,96,5,127,127,127,127,127,1,127,96,4,127,127,127,127,1,127,96,11,127,127,127,127,127,
  127,127,127,127,127,127,1,127,96,4,127,127,127,127,0,96,1,127,1,127,96,3,127,127,127,0,96,6,127,127,127,127,127,127,1,127,3,31,30,0,0,0,1,2,3,3,4,1,5,0,0,0,0,0,0,0,1,6,7,3,7,8,9,10,
  9,4,8,8,5,5,3,1,0,60,6,9,1,127,1,65,208,243,236,1,11,7,222,1,16,6,109,101,109,111,114,121,2,0,9,98,111,97,114,100,95,112,116,114,0,0,10,99,111,110,102,105,103,95,112,116,114,0,1,9,109,111,118,101,
  115,95,112,116,114,0,2,8,101,118,97,108,117,97,116,101,0,3,8,105,110,95,99,104,101,99,107,0,5,8,103,101,110,101,114,97,116,101,0,7,10,115,99,111,114,101,115,95,112,116,114,0,10,9,101,120,97,99,116,95,112,116,114,0,
  11,10,112,111,108,105,99,121,95,112,116,114,0,12,15,112,117,98,108,105,99,95,107,101,121,115,95,112,116,114,0,13,17,112,117,98,108,105,99,95,99,111,117,110,116,115,95,112,116,114,0,14,12,115,101,97,114,99,104,95,110,111,100,101,
  115,0,15,12,115,101,97,114,99,104,95,100,101,112,116,104,0,16,20,115,101,97,114,99,104,95,101,118,97,108,117,97,116,101,95,102,97,115,116,0,17,10,115,101,97,114,99,104,95,97,108,108,0,18,10,228,253,1,30,8,0,65,240,137,
  128,128,0,11,8,0,65,176,138,128,128,0,11,8,0,65,208,166,128,128,0,11,202,9,4,1,127,1,123,15,127,1,124,35,128,128,128,128,0,65,208,4,107,34,3,36,128,128,128,128,0,32,3,65,176,4,106,65,16,106,253,12,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,34,4,253,11,4,0,32,3,32,4,253,11,4,176,4,32,3,65,144,4,106,65,16,106,32,4,253,11,4,0,32,3,32,4,253,11,4,144,4,65,0,33,5,65,0,33,6,65,0,33,
  7,65,0,33,8,65,0,33,9,65,0,33,10,65,0,33,11,65,0,33,12,3,64,2,64,32,12,65,240,137,128,128,0,106,44,0,0,34,13,69,13,0,65,1,33,14,32,13,32,13,192,65,7,117,34,15,115,32,15,107,34,16,65,255,
  1,113,34,15,65,8,116,32,12,32,12,65,56,115,32,13,65,0,74,34,17,27,65,2,116,114,34,18,65,204,152,128,128,0,106,40,2,0,32,15,65,2,116,65,176,138,128,128,0,106,40,2,0,34,19,106,65,1,65,127,32,17,27,34,
  17,108,32,6,106,33,6,32,18,65,204,138,128,128,0,106,40,2,0,32,19,106,32,17,108,32,5,106,33,5,2,64,2,64,2,64,32,16,65,254,1,113,65,2,70,13,0,65,2,33,14,32,15,65,4,71,13,1,11,32,14,32,7,106,
  33,7,12,1,11,32,15,65,5,70,65,2,116,32,7,106,33,7,32,15,65,1,71,13,0,32,12,65,7,113,33,15,2,64,32,13,65,1,72,13,0,32,3,65,144,2,106,32,10,65,2,116,106,32,12,54,2,0,32,3,65,176,4,106,
  32,15,65,2,116,106,34,13,32,13,40,2,0,65,1,106,54,2,0,32,10,65,1,106,33,10,12,2,11,32,3,65,16,106,32,11,65,2,116,106,32,12,54,2,0,32,3,65,144,4,106,32,15,65,2,116,106,34,13,32,13,40,2,0,
  65,1,106,54,2,0,32,11,65,1,106,33,11,12,1,11,32,15,65,3,71,13,0,2,64,32,13,65,1,72,13,0,32,8,65,1,106,33,8,12,1,11,32,9,65,1,106,33,9,11,32,12,65,1,106,34,12,65,192,0,71,13,0,11,
  32,3,65,8,106,32,3,65,144,2,106,32,10,32,3,65,176,4,106,32,3,65,16,106,32,11,65,1,32,1,32,2,16,132,128,128,128,0,32,3,32,3,65,16,106,32,11,32,3,65,144,4,106,32,3,65,144,2,106,32,10,65,127,32,
  2,32,1,16,132,128,128,128,0,32,3,40,2,8,32,3,40,2,0,107,32,5,106,34,12,65,30,106,32,12,32,8,65,1,74,34,13,27,34,12,65,98,106,32,12,32,9,65,1,74,34,15,27,33,16,32,3,40,2,12,32,3,40,2,
  4,107,32,6,106,34,12,65,45,106,32,12,32,13,27,34,12,65,83,106,32,12,32,15,27,33,17,65,0,33,12,3,64,2,64,32,12,65,240,137,128,128,0,106,44,0,0,34,13,69,13,0,65,1,65,127,32,13,65,0,74,34,6,27,
  33,15,32,12,65,7,113,33,14,2,64,2,64,32,13,32,13,65,31,117,34,5,115,32,5,107,65,124,106,14,3,1,2,0,2,11,32,12,32,15,65,3,116,106,33,13,65,0,33,5,2,64,32,14,69,13,0,32,13,65,127,106,65,63,
  75,13,0,32,15,32,13,65,239,137,128,128,0,106,44,0,0,70,33,5,11,2,64,32,13,65,63,75,13,0,32,5,32,15,32,13,65,240,137,128,128,0,106,44,0,0,70,106,33,5,11,2,64,32,14,65,7,70,13,0,32,13,65,1,
  106,65,63,75,13,0,32,5,32,15,32,13,65,241,137,128,128,0,106,44,0,0,70,106,33,5,11,32,15,32,5,108,65,12,108,32,16,106,33,16,12,1,11,32,3,65,176,4,106,32,3,65,144,4,106,32,6,27,32,14,65,2,116,34,
  13,106,40,2,0,13,0,65,15,65,30,32,3,65,144,4,106,32,3,65,176,4,106,32,6,27,32,13,106,40,2,0,27,32,15,108,32,16,106,33,16,32,15,65,15,108,32,17,106,33,17,11,32,12,65,1,106,34,12,65,192,0,71,13,
  0,11,32,16,32,7,65,24,32,7,65,24,72,27,34,12,108,32,17,65,24,32,12,107,108,106,183,68,0,0,0,0,0,0,56,64,163,33,20,2,64,32,7,65,4,74,13,0,32,17,32,17,65,31,117,34,12,115,32,12,107,65,144,3,
  77,13,0,32,20,32,2,32,1,32,17,65,0,74,34,12,27,34,13,65,7,113,34,15,65,1,116,65,121,106,34,14,32,14,65,31,117,34,14,115,32,14,107,34,14,32,13,65,3,117,34,13,65,1,116,65,121,106,34,7,32,7,65,31,
  117,34,7,115,32,7,107,34,7,32,14,32,7,74,27,65,10,108,65,14,32,1,32,2,32,12,27,34,14,65,3,117,32,13,107,34,13,32,13,65,31,117,34,13,115,32,13,107,32,14,65,7,113,32,15,107,34,13,32,13,65,31,117,34,
  13,115,32,13,107,106,107,65,6,108,106,34,13,65,0,32,13,107,32,12,27,183,160,33,20,11,2,64,2,64,32,20,32,0,183,162,68,0,0,0,0,0,0,224,63,160,156,34,20,153,68,0,0,0,0,0,0,224,65,99,69,13,0,32,
  20,170,33,12,12,1,11,65,128,128,128,128,120,33,12,11,32,3,65,208,4,106,36,128,128,128,128,0,32,12,65,8,106,11,169,4,1,12,127,32,0,66,0,55,2,0,2,64,32,2,65,1,72,13,0,65,0,33,9,32,7,65,3,117,
  65,7,65,0,32,6,65,0,74,34,10,27,34,6,107,34,11,32,11,65,31,117,34,11,115,32,11,107,33,12,32,8,65,3,117,32,6,107,34,6,32,6,65,31,117,34,6,115,32,6,107,33,13,32,7,65,7,113,33,14,32,8,65,7,
  113,33,15,32,5,65,1,72,33,16,65,0,33,17,65,0,33,18,3,64,2,64,32,3,32,1,32,18,65,2,116,106,40,2,0,34,19,65,7,113,34,7,65,2,116,106,34,8,40,2,0,65,2,72,13,0,32,0,32,9,65,112,106,34,
  9,54,2,4,32,0,32,17,65,116,106,34,17,54,2,0,11,2,64,2,64,2,64,32,7,69,13,0,32,8,65,124,106,40,2,0,13,2,32,7,65,7,70,13,1,11,32,8,65,4,106,40,2,0,13,1,11,32,0,32,9,65,113,106,
  34,9,54,2,4,32,0,32,17,65,117,106,34,17,54,2,0,11,2,64,2,64,32,16,13,0,32,4,33,8,32,5,33,6,2,64,32,10,69,13,0,32,4,33,8,32,5,33,11,3,64,2,64,32,8,40,2,0,34,20,65,7,113,32,
  7,107,34,6,32,6,65,31,117,34,6,115,32,6,107,65,1,75,13,0,32,20,32,19,74,13,4,11,32,8,65,4,106,33,8,32,11,65,127,106,34,11,13,0,12,2,11,11,3,64,2,64,32,8,40,2,0,34,20,65,7,113,32,7,
  107,34,11,32,11,65,31,117,34,11,115,32,11,107,65,1,75,13,0,32,20,32,19,72,13,3,11,32,8,65,4,106,33,8,32,6,65,127,106,34,6,13,0,11,11,32,0,32,9,32,19,65,3,117,34,8,65,7,32,8,107,32,10,27,
  34,8,65,2,116,34,6,65,192,137,128,128,0,106,40,2,0,106,34,9,54,2,4,32,0,32,17,32,6,65,160,137,128,128,0,106,40,2,0,106,34,17,54,2,0,32,8,65,4,72,13,0,32,0,32,9,32,8,32,15,32,7,107,34,
  6,32,6,65,31,117,34,6,115,32,6,107,34,6,32,13,32,6,32,13,74,27,32,14,32,7,107,34,7,32,7,65,31,117,34,7,115,32,7,107,34,7,32,12,32,7,32,12,74,27,107,108,65,3,108,106,34,9,54,2,4,11,32,18,
  65,1,106,34,18,32,2,71,13,0,11,11,11,15,0,32,1,65,0,32,0,107,16,134,128,128,128,0,11,202,16,1,12,127,32,0,65,7,113,33,2,2,64,2,64,32,0,65,3,117,34,3,32,1,107,34,4,65,7,75,13,0,32,4,
  65,3,116,33,5,2,64,32,2,69,13,0,65,1,33,4,32,2,32,5,106,65,239,137,128,128,0,106,44,0,0,32,1,70,13,2,32,2,65,7,70,13,1,11,65,1,33,4,32,2,32,5,106,65,241,137,128,128,0,106,44,0,0,32,
  1,70,13,1,11,32,3,65,2,106,33,6,32,2,65,1,106,33,7,32,1,65,1,116,33,5,2,64,32,2,65,7,70,13,0,32,6,65,7,75,13,0,65,1,33,4,32,5,32,6,65,3,116,32,7,106,65,240,137,128,128,0,106,44,
  0,0,70,13,1,11,32,3,65,1,106,33,8,32,2,65,2,106,33,9,2,64,32,2,65,5,75,34,10,13,0,32,8,65,7,75,13,0,65,1,33,4,32,5,32,8,65,3,116,32,9,106,65,240,137,128,128,0,106,44,0,0,70,13,
  1,11,32,3,65,127,106,33,11,2,64,32,10,13,0,32,11,65,7,75,13,0,65,1,33,4,32,5,32,11,65,3,116,32,9,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,32,3,65,126,106,33,9,2,64,32,2,65,7,70,
  13,0,32,9,65,7,75,13,0,65,1,33,4,32,5,32,9,65,3,116,32,7,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,2,65,127,106,34,12,32,9,114,65,7,75,13,0,65,1,33,4,32,5,32,9,65,3,
  116,32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,2,65,126,106,34,9,32,3,65,127,106,114,65,7,75,13,0,65,1,33,4,32,5,32,11,65,3,116,32,9,106,65,240,137,128,128,0,106,44,0,0,70,13,
  1,11,65,1,33,4,2,64,32,9,32,3,65,1,106,114,65,7,75,13,0,32,5,32,8,65,3,116,32,9,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,12,32,3,65,2,106,114,65,7,75,13,0,65,1,33,4,
  32,5,32,6,65,3,116,32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,32,1,65,5,108,33,13,2,64,32,2,65,7,70,13,0,32,3,65,1,106,65,7,75,13,0,2,64,32,0,65,249,137,128,128,0,106,45,0,0,
  34,5,13,0,32,2,65,5,75,13,1,32,3,65,1,106,65,6,75,13,1,32,0,65,130,138,128,128,0,106,45,0,0,34,5,13,0,32,2,65,4,75,13,1,32,3,65,1,106,65,5,75,13,1,32,0,65,139,138,128,128,0,106,45,
  0,0,34,5,13,0,32,2,65,3,75,13,1,32,3,65,1,106,65,4,75,13,1,32,0,65,148,138,128,128,0,106,45,0,0,34,5,13,0,32,2,65,2,75,13,1,32,3,65,1,106,65,3,75,13,1,32,0,65,157,138,128,128,0,
  106,45,0,0,34,5,13,0,32,2,65,1,75,13,1,32,3,65,1,106,65,2,75,13,1,32,0,65,166,138,128,128,0,106,45,0,0,34,5,13,0,32,2,13,1,32,3,65,1,106,65,1,75,13,1,32,0,65,175,138,128,128,0,106,
  45,0,0,34,5,69,13,1,11,65,1,33,4,32,13,32,5,192,34,5,70,13,1,32,1,65,3,108,32,5,70,13,1,11,2,64,32,2,65,7,70,13,0,32,3,65,127,106,65,7,75,13,0,2,64,32,0,65,233,137,128,128,0,106,
  45,0,0,34,5,13,0,32,2,65,5,75,13,1,32,3,65,126,106,65,6,75,13,1,32,0,65,226,137,128,128,0,106,45,0,0,34,5,13,0,32,2,65,4,75,13,1,32,3,65,125,106,65,5,75,13,1,32,0,65,219,137,128,128,
  0,106,45,0,0,34,5,13,0,32,2,65,3,75,13,1,32,3,65,124,106,65,4,75,13,1,32,0,65,212,137,128,128,0,106,45,0,0,34,5,13,0,32,2,65,2,75,13,1,32,3,65,123,106,65,3,75,13,1,32,0,65,205,137,
  128,128,0,106,45,0,0,34,5,13,0,32,2,65,1,75,13,1,32,3,65,122,106,65,2,75,13,1,32,0,65,198,137,128,128,0,106,45,0,0,34,5,13,0,32,2,13,1,32,3,65,121,106,65,1,75,13,1,32,0,65,191,137,128,
  128,0,106,45,0,0,34,5,69,13,1,11,65,1,33,4,32,13,32,5,192,34,5,70,13,1,32,1,65,3,108,32,5,70,13,1,11,32,2,65,127,106,33,4,32,3,65,3,116,32,2,114,65,247,137,128,128,0,106,33,6,32,3,33,
  5,2,64,3,64,32,4,65,7,75,13,1,32,5,65,6,74,13,1,32,3,65,127,72,13,1,32,4,65,127,106,33,4,32,5,65,1,106,33,5,32,6,44,0,0,33,9,32,6,65,7,106,33,6,32,9,69,13,0,11,65,1,33,4,
  32,13,32,9,70,13,1,32,1,65,3,108,32,9,70,13,1,11,32,2,65,127,106,33,9,32,3,65,3,116,32,2,114,65,231,137,128,128,0,106,33,5,65,0,33,4,32,3,65,8,74,33,10,2,64,3,64,32,9,32,4,106,65,7,
  75,13,1,32,3,32,4,106,65,1,72,13,1,32,10,13,1,32,4,65,127,106,33,4,32,5,44,0,0,33,6,32,5,65,119,106,33,5,32,6,69,13,0,11,65,1,33,4,32,13,32,6,70,13,1,32,1,65,3,108,32,6,70,13,
  1,11,32,0,65,120,113,33,5,2,64,32,2,65,7,70,13,0,32,3,65,7,75,13,0,2,64,32,2,32,5,106,34,4,65,241,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,5,75,13,1,32,3,65,7,75,13,1,32,4,
  65,242,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,4,75,13,1,32,3,65,7,75,13,1,32,4,65,243,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,3,75,13,1,32,3,65,7,75,13,1,32,4,65,244,137,128,
  128,0,106,45,0,0,34,6,13,0,32,2,65,2,75,13,1,32,3,65,7,75,13,1,32,4,65,245,137,128,128,0,106,45,0,0,34,6,13,0,32,2,65,1,75,13,1,32,3,65,7,75,13,1,32,4,65,246,137,128,128,0,106,45,
  0,0,34,6,13,0,32,2,13,1,32,3,65,7,75,13,1,32,4,65,247,137,128,128,0,106,45,0,0,34,6,69,13,1,11,65,1,33,4,32,13,32,6,192,34,6,70,13,1,32,1,65,2,116,32,6,70,13,1,11,32,2,65,127,
  106,33,4,32,5,65,240,137,128,128,0,106,33,6,2,64,3,64,32,4,32,3,114,65,7,75,13,1,32,6,32,4,106,33,5,32,4,65,127,106,33,4,32,5,44,0,0,34,5,69,13,0,11,65,1,33,4,32,13,32,5,70,13,1,
  32,1,65,2,116,32,5,70,13,1,11,32,3,65,3,116,32,2,114,65,248,137,128,128,0,106,33,5,32,3,65,127,72,33,9,32,3,33,4,2,64,3,64,32,9,13,1,32,4,65,6,74,13,1,32,4,65,1,106,33,4,32,5,44,
  0,0,33,6,32,5,65,8,106,33,5,32,6,69,13,0,11,65,1,33,4,32,13,32,6,70,13,1,32,1,65,2,116,32,6,70,13,1,11,32,3,65,3,116,32,2,114,65,232,137,128,128,0,106,33,5,32,3,65,8,74,33,9,32,
  3,33,4,2,64,3,64,32,4,65,1,72,13,1,32,9,13,1,32,4,65,127,106,33,4,32,5,44,0,0,33,6,32,5,65,120,106,33,5,32,6,69,13,0,11,65,1,33,4,32,13,32,6,70,13,1,32,1,65,2,116,32,6,70,
  13,1,11,32,1,65,6,108,33,1,2,64,32,2,65,7,70,34,5,13,0,32,3,65,1,106,65,7,75,13,0,65,1,33,4,32,1,32,8,65,3,116,32,7,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,5,13,
  0,32,3,65,127,106,65,7,75,13,0,65,1,33,4,32,1,32,11,65,3,116,32,7,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,65,1,33,4,2,64,32,12,32,3,65,1,106,114,65,7,75,13,0,32,1,32,8,65,3,
  116,32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,12,32,3,65,127,106,114,65,7,75,13,0,65,1,33,4,32,1,32,11,65,3,116,32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,
  2,65,7,70,13,0,32,3,65,7,75,13,0,65,1,33,4,32,1,32,0,65,120,113,32,7,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,12,32,3,114,65,7,75,13,0,65,1,33,4,32,1,32,0,65,120,113,
  32,12,106,65,240,137,128,128,0,106,44,0,0,70,13,1,11,65,1,33,4,2,64,32,3,65,1,106,65,7,75,13,0,32,1,32,8,65,3,116,32,2,114,65,240,137,128,128,0,106,44,0,0,70,13,1,11,2,64,32,3,65,127,106,
  65,7,75,13,0,65,1,33,4,32,1,32,11,65,3,116,32,2,114,65,240,137,128,128,0,106,44,0,0,70,13,1,11,65,0,33,4,11,32,4,11,246,22,1,34,127,65,0,32,3,54,2,212,182,128,128,0,65,0,32,0,54,2,208,
  182,128,128,0,65,0,32,4,54,2,216,182,128,128,0,65,0,65,0,54,2,220,182,128,128,0,65,7,65,0,32,0,65,1,70,34,3,27,33,5,65,1,65,6,32,3,27,33,6,32,2,65,6,116,33,7,32,1,65,2,113,33,8,32,
  1,65,1,113,33,9,32,1,65,8,113,33,10,32,1,65,4,113,33,11,32,0,65,4,116,33,12,32,0,65,3,116,33,13,65,0,32,0,107,33,14,65,0,33,15,65,0,33,16,65,0,33,17,2,64,3,64,2,64,32,17,65,240,137,
  128,128,0,106,34,3,44,0,0,34,1,69,13,0,65,1,65,127,32,1,65,0,74,27,32,0,71,13,0,32,17,65,3,118,33,18,32,17,65,7,113,33,19,2,64,2,64,2,64,32,1,32,1,192,65,7,117,34,4,115,32,4,107,65,
  255,1,113,34,20,65,127,106,14,2,0,1,2,11,2,64,32,17,32,13,106,34,1,65,63,75,13,0,32,1,65,240,137,128,128,0,106,45,0,0,13,0,32,17,32,1,32,5,16,136,128,128,128,0,13,5,32,18,32,6,71,13,0,32,
  1,65,3,118,32,5,70,13,0,32,17,32,12,106,34,21,65,240,137,128,128,0,106,34,4,45,0,0,13,0,65,0,40,2,216,182,128,128,0,34,22,65,1,70,13,0,32,3,45,0,0,33,18,32,3,65,0,58,0,0,32,4,32,18,
  58,0,0,32,21,65,0,40,2,212,182,128,128,0,32,18,32,18,192,65,7,117,34,23,115,32,23,107,65,255,1,113,34,24,65,6,70,27,65,0,65,0,40,2,208,182,128,128,0,107,16,134,128,128,128,0,33,23,32,3,32,18,58,0,
  0,32,4,65,0,58,0,0,32,23,13,0,32,22,65,2,70,13,5,65,0,65,0,40,2,220,182,128,128,0,34,4,65,1,106,54,2,220,182,128,128,0,32,4,65,2,116,65,208,166,128,128,0,106,32,21,65,6,116,32,24,65,12,116,
  114,32,17,114,65,128,128,128,1,114,54,2,0,11,2,64,32,19,69,13,0,32,1,65,191,127,106,65,64,73,13,0,2,64,32,1,65,127,106,34,4,65,240,137,128,128,0,106,34,18,44,0,0,34,21,69,13,0,65,1,65,127,32,21,
  65,0,74,27,32,14,71,13,0,32,17,32,4,32,5,16,136,128,128,128,0,69,13,1,12,6,11,32,4,32,2,71,13,0,32,3,45,0,0,33,4,32,3,65,0,58,0,0,32,18,32,4,58,0,0,32,2,65,0,40,2,208,182,128,
  128,0,34,23,65,3,116,107,34,24,65,240,137,128,128,0,106,34,22,45,0,0,33,25,32,22,65,0,58,0,0,65,0,40,2,216,182,128,128,0,33,26,32,2,65,0,40,2,212,182,128,128,0,32,4,32,4,192,65,7,117,34,27,115,
  32,27,107,65,255,1,113,34,27,65,6,70,27,65,0,32,23,107,16,134,128,128,128,0,33,23,2,64,32,24,65,0,72,13,0,32,22,32,25,58,0,0,11,32,3,32,4,58,0,0,32,18,32,21,58,0,0,32,23,13,0,32,26,65,
  2,70,13,5,65,0,65,0,40,2,220,182,128,128,0,34,4,65,1,106,54,2,220,182,128,128,0,32,4,65,2,116,65,208,166,128,128,0,106,32,7,32,27,65,12,116,114,32,17,114,65,128,128,130,2,114,54,2,0,11,32,19,65,7,
  70,13,2,32,1,65,65,106,65,64,73,13,2,2,64,32,1,65,1,106,34,1,65,240,137,128,128,0,106,34,21,44,0,0,34,4,69,13,0,65,1,65,127,32,4,65,0,74,27,32,14,71,13,0,32,17,32,1,32,5,16,136,128,128,
  128,0,69,13,3,12,5,11,32,1,32,2,71,13,2,32,3,45,0,0,33,1,32,3,65,0,58,0,0,32,21,32,1,58,0,0,32,2,65,0,40,2,208,182,128,128,0,34,18,65,3,116,107,34,22,65,240,137,128,128,0,106,34,19,
  45,0,0,33,24,32,19,65,0,58,0,0,65,0,40,2,216,182,128,128,0,33,27,32,2,65,0,40,2,212,182,128,128,0,32,1,32,1,192,65,7,117,34,23,115,32,23,107,65,255,1,113,34,23,65,6,70,27,65,0,32,18,107,16,
  134,128,128,128,0,33,18,2,64,32,22,65,0,72,13,0,32,19,32,24,58,0,0,11,32,3,32,1,58,0,0,32,21,32,4,58,0,0,32,18,13,2,32,27,65,2,70,13,4,65,0,65,0,40,2,220,182,128,128,0,34,1,65,1,
  106,54,2,220,182,128,128,0,32,1,65,2,116,65,208,166,128,128,0,106,32,7,32,23,65,12,116,114,32,17,114,65,128,128,130,2,114,54,2,0,12,2,11,65,0,65,0,40,2,208,182,128,128,0,107,33,28,65,0,40,2,212,182,128,
  128,0,33,29,65,0,40,2,216,182,128,128,0,33,26,65,0,40,2,220,182,128,128,0,33,30,65,96,33,1,3,64,2,64,32,1,65,160,136,128,128,0,106,40,2,0,32,19,106,34,21,65,7,75,13,0,32,1,65,192,136,128,128,0,
  106,40,2,0,32,18,106,34,4,65,0,72,13,0,32,4,65,7,74,13,0,2,64,2,64,32,4,65,3,116,32,21,106,34,23,65,240,137,128,128,0,106,34,22,44,0,0,34,4,69,13,0,65,1,65,127,32,4,65,0,74,27,32,14,
  71,13,2,32,4,32,4,65,31,117,34,21,115,32,21,107,33,27,12,1,11,65,0,33,27,32,26,65,1,70,13,1,11,32,3,45,0,0,33,21,32,3,65,0,58,0,0,32,22,32,21,58,0,0,32,23,32,29,32,21,32,21,192,65,
  7,117,34,24,115,32,24,107,65,255,1,113,34,25,65,6,70,27,32,28,16,134,128,128,128,0,33,24,32,3,32,21,58,0,0,32,22,32,4,58,0,0,32,24,13,0,32,26,65,2,70,13,5,65,0,32,30,65,1,106,34,4,54,2,
  220,182,128,128,0,32,30,65,2,116,65,208,166,128,128,0,106,32,23,65,6,116,32,27,65,15,116,114,32,25,65,12,116,114,32,17,114,54,2,0,32,4,33,30,11,32,1,65,4,106,34,1,13,0,12,2,11,11,2,64,32,20,65,4,
  70,65,3,116,34,30,65,8,65,16,32,20,65,3,70,27,34,31,79,13,0,32,15,65,7,113,33,32,65,0,65,0,40,2,208,182,128,128,0,107,33,33,65,0,40,2,212,182,128,128,0,33,34,65,0,40,2,220,182,128,128,0,33,35,
  65,0,40,2,216,182,128,128,0,33,36,3,64,32,19,32,30,65,2,116,34,1,65,192,136,128,128,0,106,40,2,0,34,22,106,34,21,65,8,73,32,18,32,1,65,196,136,128,128,0,106,40,2,0,34,23,106,34,1,65,127,74,113,32,
  1,65,8,72,113,33,4,2,64,2,64,2,64,2,64,32,36,65,1,71,13,0,2,64,32,20,65,6,71,13,0,32,4,69,13,4,32,1,65,3,116,32,21,106,34,1,65,240,137,128,128,0,106,34,25,45,0,0,34,27,69,13,4,12,
  2,11,32,4,69,13,3,32,32,32,22,106,32,1,65,3,116,106,33,1,32,18,32,23,65,1,116,106,33,4,32,22,32,23,65,3,116,106,33,26,32,32,32,22,65,1,116,106,33,21,3,64,32,1,65,240,137,128,128,0,106,34,25,45,
  0,0,34,27,13,2,32,21,65,7,75,13,4,32,4,65,0,72,13,4,32,1,32,26,106,33,1,32,21,32,22,106,33,21,32,4,65,7,74,33,24,32,4,32,23,106,33,4,32,24,13,4,12,0,11,11,2,64,32,20,65,6,71,13,
  0,32,4,69,13,3,32,1,65,3,116,32,21,106,34,1,65,240,137,128,128,0,106,34,25,45,0,0,34,27,13,1,32,3,45,0,0,33,4,32,3,65,0,58,0,0,32,1,65,240,137,128,128,0,106,34,21,32,4,58,0,0,32,1,
  32,34,32,4,32,4,192,65,7,117,34,22,115,32,22,107,65,255,1,113,34,23,65,6,70,27,32,33,16,134,128,128,128,0,33,22,32,3,32,4,58,0,0,32,21,65,0,58,0,0,32,22,13,3,32,36,65,2,70,13,8,32,1,65,
  6,116,32,23,65,12,116,114,33,1,12,2,11,32,4,69,13,2,32,23,65,9,116,32,22,65,6,116,106,33,37,32,32,32,22,106,32,1,65,3,116,106,34,1,65,6,116,33,26,32,18,32,23,65,1,116,106,33,21,32,22,32,23,65,
  3,116,106,33,38,32,32,32,22,65,1,116,106,33,24,32,35,33,29,3,64,32,1,65,240,137,128,128,0,106,34,25,45,0,0,34,27,13,1,32,3,45,0,0,33,4,32,3,65,0,58,0,0,32,1,65,240,137,128,128,0,106,34,27,
  32,4,58,0,0,32,1,32,34,32,4,32,4,192,65,7,117,34,25,115,32,25,107,65,255,1,113,34,28,65,6,70,27,32,33,16,134,128,128,128,0,33,25,32,3,32,4,58,0,0,32,27,65,0,58,0,0,2,64,32,25,13,0,32,
  36,65,2,70,13,9,65,0,32,29,65,1,106,34,35,54,2,220,182,128,128,0,32,29,65,2,116,65,208,166,128,128,0,106,32,26,32,28,65,12,116,114,32,17,114,54,2,0,32,35,33,29,11,32,24,65,7,75,13,3,32,21,65,0,
  72,13,3,32,26,32,37,106,33,26,32,1,32,38,106,33,1,32,24,32,22,106,33,24,32,21,65,8,72,33,4,32,21,32,23,106,33,21,32,4,13,0,12,3,11,11,65,1,65,127,32,27,192,34,21,65,0,74,27,32,14,71,13,1,
  32,3,45,0,0,33,4,32,3,65,0,58,0,0,32,25,32,4,58,0,0,32,1,32,34,32,4,32,4,192,65,7,117,34,22,115,32,22,107,65,255,1,113,34,23,65,6,70,27,32,33,16,134,128,128,128,0,33,22,32,3,32,4,58,
  0,0,32,25,32,27,58,0,0,32,22,13,1,32,36,65,2,70,13,6,32,1,65,6,116,32,21,32,21,65,31,117,34,1,115,32,1,107,65,15,116,114,32,23,65,12,116,114,33,1,11,65,0,32,35,34,4,65,1,106,34,35,54,2,
  220,182,128,128,0,32,4,65,2,116,65,208,166,128,128,0,106,32,1,32,17,114,54,2,0,11,32,30,65,2,106,34,30,32,31,73,13,0,11,11,2,64,32,0,65,1,71,13,0,32,17,65,4,71,13,0,32,20,65,6,71,13,0,2,
  64,32,9,69,13,0,65,0,45,0,247,137,128,128,0,65,255,1,113,65,4,71,13,0,65,0,45,0,245,137,128,128,0,65,255,1,113,13,0,65,0,45,0,246,137,128,128,0,65,255,1,113,13,0,65,4,65,127,16,134,128,128,128,0,
  13,0,65,5,65,127,16,134,128,128,128,0,13,0,65,6,65,127,16,134,128,128,128,0,13,0,65,4,65,6,65,0,65,4,16,137,128,128,128,0,13,4,11,32,8,69,13,1,65,0,45,0,240,137,128,128,0,65,255,1,113,65,4,71,
  13,1,65,0,45,0,241,137,128,128,0,65,255,1,113,13,1,65,0,45,0,242,137,128,128,0,65,255,1,113,13,1,65,0,45,0,243,137,128,128,0,65,255,1,113,13,1,65,4,65,127,16,134,128,128,128,0,13,1,65,3,65,127,16,
  134,128,128,128,0,13,1,65,2,65,127,16,134,128,128,128,0,13,1,65,4,65,2,65,0,65,8,16,137,128,128,128,0,69,13,1,12,3,11,32,0,65,127,71,13,0,32,17,65,60,71,13,0,32,20,65,6,71,13,0,2,64,32,11,
  69,13,0,65,0,45,0,175,138,128,128,0,65,255,1,113,65,252,1,71,13,0,65,0,45,0,173,138,128,128,0,65,255,1,113,13,0,65,0,45,0,174,138,128,128,0,65,255,1,113,13,0,65,60,65,1,16,134,128,128,128,0,13,0,
  65,61,65,1,16,134,128,128,128,0,13,0,65,62,65,1,16,134,128,128,128,0,13,0,65,60,65,62,65,0,65,4,16,137,128,128,128,0,13,3,11,32,10,69,13,0,65,0,45,0,168,138,128,128,0,65,255,1,113,65,252,1,71,13,
  0,65,0,45,0,169,138,128,128,0,65,255,1,113,13,0,65,0,45,0,170,138,128,128,0,65,255,1,113,13,0,65,0,45,0,171,138,128,128,0,65,255,1,113,13,0,65,60,65,1,16,134,128,128,128,0,13,0,65,59,65,1,16,134,
  128,128,128,0,13,0,65,58,65,1,16,134,128,128,128,0,13,0,65,60,65,58,65,0,65,8,16,137,128,128,128,0,13,2,11,32,15,65,1,106,33,15,32,17,65,62,75,33,16,32,17,65,1,106,34,17,65,192,0,71,13,0,11,11,
  65,0,65,0,40,2,220,182,128,128,0,65,0,40,2,216,182,128,128,0,65,2,70,27,65,1,32,16,65,1,113,27,11,185,7,1,10,127,2,64,2,64,2,64,32,1,65,3,118,32,2,70,13,0,32,1,65,240,137,128,128,0,106,34,
  3,44,0,0,33,4,65,0,33,5,2,64,65,0,40,2,216,182,128,128,0,34,6,65,1,71,13,0,32,4,69,13,3,11,32,0,65,240,137,128,128,0,106,34,7,45,0,0,33,2,65,0,33,5,32,7,65,0,58,0,0,32,3,32,
  2,58,0,0,32,1,65,0,40,2,212,182,128,128,0,32,2,32,2,192,65,7,117,34,8,115,32,8,107,65,255,1,113,34,9,65,6,70,27,65,0,65,0,40,2,208,182,128,128,0,107,16,134,128,128,128,0,33,8,32,7,32,2,58,
  0,0,32,3,32,4,58,0,0,32,8,13,2,65,1,33,5,32,6,65,2,70,13,2,32,1,65,6,116,32,4,32,4,65,31,117,34,1,115,32,1,107,65,15,116,114,32,9,65,12,116,114,32,0,114,33,1,12,1,11,32,1,65,240,
  137,128,128,0,106,34,3,44,0,0,33,2,32,0,65,240,137,128,128,0,106,34,4,45,0,0,33,5,32,4,65,0,58,0,0,32,3,65,0,40,2,208,182,128,128,0,34,7,65,5,108,58,0,0,65,0,40,2,216,182,128,128,0,33,
  9,32,1,65,0,40,2,212,182,128,128,0,34,6,32,5,32,5,192,65,7,117,34,8,115,32,8,107,65,255,1,113,34,10,65,6,70,27,65,0,32,7,107,34,8,16,134,128,128,128,0,33,11,32,4,32,5,58,0,0,32,3,32,2,
  58,0,0,32,2,32,2,65,31,117,34,5,115,32,5,107,33,12,2,64,32,11,13,0,65,1,33,5,32,9,65,2,70,13,2,65,0,65,0,40,2,220,182,128,128,0,34,5,65,1,106,54,2,220,182,128,128,0,32,5,65,2,116,65,
  208,166,128,128,0,106,32,1,65,6,116,32,10,65,12,116,114,32,12,65,15,116,114,32,0,114,65,128,128,208,0,114,54,2,0,11,32,4,45,0,0,33,5,32,4,65,0,58,0,0,32,3,32,7,65,2,116,58,0,0,32,1,32,6,
  32,5,32,5,192,65,7,117,34,11,115,32,11,107,65,255,1,113,34,10,65,6,70,27,32,8,16,134,128,128,128,0,33,11,32,4,32,5,58,0,0,32,3,32,2,58,0,0,2,64,32,11,13,0,65,1,33,5,32,9,65,2,70,13,
  2,65,0,65,0,40,2,220,182,128,128,0,34,5,65,1,106,54,2,220,182,128,128,0,32,5,65,2,116,65,208,166,128,128,0,106,32,1,65,6,116,32,12,65,15,116,114,32,10,65,12,116,114,32,0,114,65,128,128,192,0,114,54,2,
  0,11,32,0,65,240,137,128,128,0,106,34,4,45,0,0,33,5,32,4,65,0,58,0,0,32,1,65,240,137,128,128,0,106,34,3,32,7,65,3,108,58,0,0,32,1,32,6,32,5,32,5,192,65,7,117,34,11,115,32,11,107,65,255,
  1,113,34,10,65,6,70,27,32,8,16,134,128,128,128,0,33,11,32,4,32,5,58,0,0,32,3,32,2,58,0,0,2,64,32,11,13,0,65,1,33,5,32,9,65,2,70,13,2,65,0,65,0,40,2,220,182,128,128,0,34,5,65,1,
  106,54,2,220,182,128,128,0,32,5,65,2,116,65,208,166,128,128,0,106,32,1,65,6,116,32,12,65,15,116,114,32,10,65,12,116,114,32,0,114,65,128,128,48,114,54,2,0,11,32,4,45,0,0,33,5,32,4,65,0,58,0,0,32,
  3,32,7,65,1,116,58,0,0,32,1,32,6,32,5,32,5,192,65,7,117,34,7,115,32,7,107,65,255,1,113,34,11,65,6,70,27,32,8,16,134,128,128,128,0,33,7,32,4,32,5,58,0,0,32,3,32,2,58,0,0,65,0,33,
  5,32,7,13,1,65,1,33,5,32,9,65,2,70,13,1,32,1,65,6,116,32,12,65,15,116,114,32,11,65,12,116,114,32,0,114,65,128,128,32,114,33,1,11,65,0,33,5,65,0,65,0,40,2,220,182,128,128,0,34,2,65,1,106,
  54,2,220,182,128,128,0,32,2,65,2,116,65,208,166,128,128,0,106,32,1,54,2,0,11,32,5,11,249,3,1,11,127,65,1,32,1,65,240,137,128,128,0,106,34,4,44,0,0,34,5,32,5,65,31,117,34,6,115,32,6,107,32,3,
  65,2,113,34,7,27,33,8,65,0,33,9,32,0,65,240,137,128,128,0,106,34,10,44,0,0,33,6,2,64,2,64,65,0,40,2,216,182,128,128,0,34,11,65,1,71,13,0,32,8,32,2,114,69,13,1,11,65,0,33,12,32,10,65,
  0,58,0,0,32,4,65,0,40,2,208,182,128,128,0,34,10,32,2,108,32,6,32,2,27,58,0,0,65,127,33,9,65,127,33,4,65,0,33,13,2,64,32,7,69,13,0,32,1,32,10,65,3,116,107,34,4,65,240,137,128,128,0,106,
  34,7,45,0,0,33,13,32,7,65,0,58,0,0,11,65,127,33,7,2,64,32,3,65,12,113,69,13,0,65,5,65,3,32,3,65,4,113,34,9,27,65,61,65,59,32,9,27,32,10,65,1,70,34,12,27,34,7,65,240,137,128,128,0,
  106,32,3,65,29,116,65,31,117,65,7,113,65,63,65,56,32,9,27,32,12,27,34,9,65,240,137,128,128,0,106,34,14,45,0,0,34,12,58,0,0,32,14,65,0,58,0,0,11,32,1,65,0,40,2,212,182,128,128,0,32,6,32,6,
  65,31,117,34,14,115,32,14,107,34,14,65,6,70,27,65,0,32,10,107,16,134,128,128,128,0,33,10,2,64,32,9,65,0,72,13,0,32,9,65,240,137,128,128,0,106,32,12,58,0,0,32,7,65,240,137,128,128,0,106,65,0,58,0,
  0,11,2,64,32,4,65,0,72,13,0,32,4,65,240,137,128,128,0,106,32,13,58,0,0,11,32,0,65,240,137,128,128,0,106,32,6,58,0,0,32,1,65,240,137,128,128,0,106,32,5,58,0,0,65,0,33,9,32,10,13,0,65,1,
  33,9,32,11,65,2,70,13,0,65,0,33,9,65,0,65,0,40,2,220,182,128,128,0,34,6,65,1,106,54,2,220,182,128,128,0,32,6,65,2,116,65,208,166,128,128,0,106,32,1,65,6,116,32,2,65,18,116,114,32,3,65,21,116,
  114,32,14,65,12,116,114,32,8,65,15,116,114,32,0,114,54,2,0,11,32,9,11,8,0,65,224,182,128,128,0,11,8,0,65,224,198,128,128,0,11,8,0,65,224,214,128,128,0,11,8,0,65,208,215,128,128,0,11,8,0,65,208,223,
  129,128,0,11,11,0,65,0,40,2,208,239,129,128,0,11,11,0,65,0,40,2,212,239,129,128,0,11,135,18,5,1,127,1,123,17,127,2,123,1,124,35,128,128,128,128,0,65,224,2,107,34,3,36,128,128,128,128,0,32,3,65,192,2,
  106,65,16,106,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,34,4,253,11,4,0,32,3,32,4,253,11,4,192,2,32,3,65,160,2,106,65,16,106,32,4,253,11,4,0,32,3,32,4,253,11,4,160,2,32,3,65,
  32,106,65,16,106,65,0,253,0,4,144,137,128,128,0,253,11,4,0,32,3,65,0,253,0,4,128,137,128,128,0,253,11,4,32,32,3,65,24,106,66,127,55,3,0,32,3,65,16,106,66,127,55,3,0,32,3,66,127,55,3,8,32,3,
  66,127,55,3,0,65,0,33,5,65,0,33,6,65,0,33,7,65,0,33,8,65,0,33,9,65,0,33,10,65,0,33,11,65,0,33,12,65,0,33,13,65,0,33,14,3,64,2,64,32,14,65,240,137,128,128,0,106,44,0,0,34,15,69,
  13,0,65,1,33,16,32,15,32,15,192,65,7,117,34,17,115,32,17,107,34,18,65,255,1,113,34,17,65,6,116,32,14,32,14,65,56,115,32,15,65,0,74,34,19,27,106,65,2,116,34,20,65,204,152,128,128,0,106,40,2,0,32,17,
  65,2,116,65,176,138,128,128,0,106,40,2,0,34,21,106,65,1,65,127,32,19,27,34,19,108,32,6,106,33,6,32,20,65,204,138,128,128,0,106,40,2,0,32,21,106,32,19,108,32,5,106,33,5,2,64,2,64,32,18,65,254,1,113,
  65,2,70,13,0,2,64,32,17,65,4,71,13,0,32,7,65,2,106,33,7,12,2,11,32,17,65,5,70,65,2,116,33,16,11,32,16,32,7,106,33,7,2,64,2,64,32,17,65,127,106,14,4,0,3,1,2,3,11,32,14,65,7,113,
  33,17,2,64,32,15,65,1,72,13,0,32,3,65,224,1,106,32,10,65,2,116,106,32,14,54,2,0,32,3,65,192,2,106,32,17,65,2,116,34,15,106,34,17,32,17,40,2,0,65,1,106,54,2,0,32,3,65,32,106,32,15,106,34,
  15,32,14,32,15,40,2,0,34,15,32,14,32,15,72,27,54,2,0,32,10,65,1,106,33,10,12,3,11,32,3,65,160,1,106,32,11,65,2,116,106,32,14,54,2,0,32,3,65,160,2,106,32,17,65,2,116,34,15,106,34,17,32,17,
  40,2,0,65,1,106,54,2,0,32,3,32,15,106,34,15,32,14,32,15,40,2,0,34,15,32,14,32,15,74,27,54,2,0,32,11,65,1,106,33,11,12,2,11,2,64,32,15,65,1,72,13,0,32,8,65,1,106,33,8,12,2,11,32,
  9,65,1,106,33,9,12,1,11,2,64,32,15,65,1,72,13,0,32,3,65,240,0,106,32,12,65,2,116,106,32,14,54,2,0,32,12,65,1,106,33,12,12,1,11,32,3,65,192,0,106,32,13,65,2,116,106,32,14,54,2,0,32,13,
  65,1,106,33,13,11,32,14,65,1,106,34,14,65,192,0,71,13,0,11,2,64,32,10,65,1,72,13,0,32,2,253,17,32,1,253,28,1,34,4,253,12,7,0,0,0,7,0,0,0,7,0,0,0,7,0,0,0,253,78,33,22,32,4,
  65,3,253,172,1,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,33,23,65,0,33,19,3,64,32,5,65,116,106,32,5,32,3,65,192,2,106,32,3,65,224,1,106,32,19,65,2,116,106,40,2,
  0,34,17,65,7,113,34,18,65,2,116,34,14,106,40,2,0,65,1,74,34,15,27,33,5,32,6,65,112,106,32,6,32,15,27,33,6,2,64,2,64,2,64,32,18,69,13,0,32,14,32,3,65,192,2,106,106,65,124,106,40,2,0,13,
  2,32,18,65,7,70,13,1,11,32,14,32,3,65,192,2,106,106,65,4,106,40,2,0,13,1,11,32,6,65,113,106,33,6,32,5,65,117,106,33,5,11,2,64,2,64,65,0,32,18,65,127,106,34,15,32,15,32,18,75,27,65,7,32,
  18,65,1,106,32,18,65,7,70,27,34,16,75,13,0,32,3,32,14,65,1,32,18,32,18,27,34,15,65,2,116,107,106,33,14,32,15,65,127,115,32,18,106,33,15,3,64,32,14,40,2,0,32,17,74,13,2,32,14,65,4,106,33,14,
  32,15,65,1,106,34,15,32,16,73,13,0,11,11,32,17,65,3,117,34,14,65,2,116,34,15,65,192,137,128,128,0,106,40,2,0,32,6,106,33,6,32,15,65,160,137,128,128,0,106,40,2,0,32,5,106,33,5,32,14,65,4,72,13,
  0,32,6,32,14,32,22,32,18,253,17,253,177,1,253,160,1,32,23,253,184,1,34,4,253,27,0,32,4,253,27,1,107,108,65,3,108,106,33,6,11,32,19,65,1,106,34,19,32,10,71,13,0,11,11,2,64,32,11,65,1,72,13,0,
  32,1,253,17,32,2,253,28,1,34,4,253,12,7,0,0,0,7,0,0,0,7,0,0,0,7,0,0,0,253,78,33,22,32,4,65,3,253,172,1,253,160,1,33,23,65,0,33,19,3,64,32,5,65,12,106,32,5,32,3,65,160,2,106,
  32,3,65,160,1,106,32,19,65,2,116,106,40,2,0,34,17,65,7,113,34,18,65,2,116,34,14,106,40,2,0,65,1,74,34,15,27,33,5,32,6,65,16,106,32,6,32,15,27,33,6,2,64,2,64,2,64,32,18,69,13,0,32,14,
  32,3,65,160,2,106,106,65,124,106,40,2,0,13,2,32,18,65,7,70,13,1,11,32,14,32,3,65,160,2,106,106,65,4,106,40,2,0,13,1,11,32,6,65,15,106,33,6,32,5,65,11,106,33,5,11,2,64,2,64,65,0,32,18,
  65,127,106,34,15,32,15,32,18,75,27,65,7,32,18,65,1,106,32,18,65,7,70,27,34,16,75,13,0,32,3,65,32,106,32,14,65,1,32,18,32,18,27,34,15,65,2,116,107,106,33,14,32,15,65,127,115,32,18,106,33,15,3,64,
  32,14,40,2,0,32,17,72,13,2,32,14,65,4,106,33,14,32,15,65,1,106,34,15,32,16,73,13,0,11,11,32,6,65,7,32,17,65,3,117,34,14,107,34,17,65,2,116,34,15,65,192,137,128,128,0,106,40,2,0,107,33,6,32,
  5,32,15,65,160,137,128,128,0,106,40,2,0,107,33,5,32,14,65,3,74,13,0,32,6,32,17,32,22,32,18,253,17,253,177,1,253,160,1,32,23,253,184,1,34,4,253,27,0,32,4,253,27,1,107,108,65,125,108,106,33,6,11,32,
  19,65,1,106,34,19,32,11,71,13,0,11,11,32,5,65,30,106,32,5,32,8,65,1,74,34,14,27,34,15,65,98,106,32,15,32,9,65,1,74,34,17,27,33,5,32,6,65,45,106,32,6,32,14,27,34,14,65,83,106,32,14,32,17,
  27,33,15,2,64,32,12,65,1,72,13,0,32,3,65,240,0,106,33,14,3,64,2,64,32,3,65,192,2,106,32,14,40,2,0,65,7,113,65,2,116,34,6,106,40,2,0,13,0,32,15,65,15,106,33,15,65,15,65,30,32,3,65,160,
  2,106,32,6,106,40,2,0,27,32,5,106,33,5,11,32,14,65,4,106,33,14,32,12,65,127,106,34,12,13,0,11,11,2,64,32,13,65,1,72,13,0,32,3,65,192,0,106,33,14,3,64,2,64,32,3,65,160,2,106,32,14,40,2,
  0,65,7,113,65,2,116,34,6,106,40,2,0,13,0,32,15,65,113,106,33,15,65,113,65,98,32,3,65,192,2,106,32,6,106,40,2,0,27,32,5,106,33,5,11,32,14,65,4,106,33,14,32,13,65,127,106,34,13,13,0,11,11,32,
  1,65,8,106,33,6,65,0,33,14,2,64,32,1,65,7,113,34,17,69,13,0,32,1,65,7,106,34,16,65,63,75,13,0,32,16,65,240,137,128,128,0,106,45,0,0,65,1,70,33,14,11,2,64,32,6,65,63,75,13,0,32,14,32,
  6,65,240,137,128,128,0,106,45,0,0,65,1,70,106,33,14,11,2,64,32,17,65,7,70,13,0,32,1,65,9,106,34,6,65,63,75,13,0,32,14,32,6,65,240,137,128,128,0,106,45,0,0,65,1,70,106,33,14,11,32,2,65,120,
  106,33,17,65,0,33,6,2,64,32,2,65,7,113,34,16,69,13,0,32,2,65,119,106,34,18,65,63,75,13,0,32,18,65,240,137,128,128,0,106,45,0,0,65,255,1,70,33,6,11,2,64,32,17,65,63,75,13,0,32,6,32,17,65,
  240,137,128,128,0,106,45,0,0,65,255,1,70,106,33,6,11,2,64,32,16,65,7,70,13,0,32,2,65,121,106,34,17,65,63,75,13,0,32,6,32,17,65,240,137,128,128,0,106,45,0,0,65,255,1,70,106,33,6,11,32,14,32,6,
  107,65,12,108,32,5,106,32,7,65,24,32,7,65,24,72,27,34,14,108,32,15,65,24,32,14,107,108,106,183,68,0,0,0,0,0,0,56,64,163,33,24,2,64,32,7,65,4,74,13,0,32,15,32,15,65,31,117,34,14,115,32,14,107,
  65,145,3,73,13,0,32,24,32,2,32,1,32,15,65,0,74,34,14,27,34,15,65,7,113,34,6,65,1,116,65,121,106,34,5,32,5,65,31,117,34,5,115,32,5,107,34,5,32,15,65,3,117,34,15,65,1,116,65,121,106,34,17,32,
  17,65,31,117,34,17,115,32,17,107,34,17,32,5,32,17,74,27,65,10,108,65,14,32,1,32,2,32,14,27,34,5,65,3,117,32,15,107,34,15,32,15,65,31,117,34,15,115,32,15,107,32,5,65,7,113,32,6,107,34,15,32,15,65,
  31,117,34,15,115,32,15,107,106,107,65,6,108,106,34,15,65,0,32,15,107,32,14,27,183,160,33,24,11,2,64,2,64,32,24,32,0,183,162,68,0,0,0,0,0,0,224,63,160,156,34,24,153,68,0,0,0,0,0,0,224,65,99,69,
  13,0,32,24,170,33,14,12,1,11,65,128,128,128,128,120,33,14,11,32,3,65,224,2,106,36,128,128,128,128,0,32,14,65,8,106,11,142,38,9,4,127,4,123,1,127,2,126,3,127,1,126,4,127,1,126,10,127,35,128,128,128,128,0,
  65,240,225,0,107,34,11,36,128,128,128,128,0,65,0,33,12,65,64,33,13,3,64,2,64,32,13,65,176,138,128,128,0,106,45,0,0,34,14,32,14,192,65,7,117,34,14,115,32,14,107,65,255,1,113,34,14,65,5,75,13,0,65,1,
  32,14,116,65,50,113,69,13,0,32,12,65,1,106,33,12,11,2,64,32,13,65,177,138,128,128,0,106,45,0,0,34,14,32,14,192,65,7,117,34,14,115,32,14,107,65,255,1,113,34,14,65,5,75,13,0,65,1,32,14,116,65,50,113,
  69,13,0,32,12,65,1,106,33,12,11,32,13,65,2,106,34,13,13,0,11,32,11,32,12,54,2,152,97,32,11,32,5,54,2,148,97,32,11,32,4,54,2,144,97,32,11,32,3,54,2,140,97,32,11,66,0,55,3,184,97,32,11,32,
  0,54,2,128,97,32,11,32,1,54,2,132,97,32,11,32,2,54,2,136,97,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,32,1,65,177,207,217,178,1,108,65,177,207,217,178,1,106,32,0,65,173,214,211,190,2,108,
  65,218,172,167,253,4,106,115,32,2,65,236,200,137,157,125,108,65,216,145,147,186,122,106,115,34,13,65,16,118,32,13,115,65,173,234,172,255,7,108,34,13,65,15,118,32,13,115,65,139,205,178,163,120,108,34,13,65,16,118,32,13,115,253,
  28,0,33,15,253,12,0,0,0,0,1,0,0,0,2,0,0,0,3,0,0,0,33,16,65,64,33,13,3,64,32,15,32,15,32,13,65,176,138,128,128,0,106,253,92,2,0,34,17,253,135,1,253,167,1,253,12,107,202,235,133,107,202,235,
  133,107,202,235,133,107,202,235,133,253,181,1,253,12,237,136,114,169,237,136,114,169,237,136,114,169,237,136,114,169,253,174,1,32,16,253,12,185,121,55,158,185,121,55,158,185,121,55,158,185,121,55,158,34,18,253,181,1,32,18,253,174,1,253,
  81,34,18,65,16,253,173,1,32,18,253,81,253,12,45,53,235,127,45,53,235,127,45,53,235,127,45,53,235,127,253,181,1,34,18,65,15,253,173,1,32,18,253,81,253,12,139,166,108,132,139,166,108,132,139,166,108,132,139,166,108,132,253,181,
  1,34,18,65,16,253,173,1,253,81,32,18,253,81,32,17,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,253,35,253,135,1,253,167,1,253,82,33,15,32,16,253,12,4,0,0,0,4,0,0,0,4,0,0,0,4,0,
  0,0,253,174,1,33,16,32,13,65,4,106,34,13,13,0,11,32,11,65,168,225,0,106,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,34,16,253,11,3,0,65,0,33,13,32,11,65,184,225,0,106,65,0,54,2,0,
  32,11,65,208,225,0,106,32,16,253,11,3,0,32,11,65,224,225,0,106,32,16,253,11,3,0,32,11,66,0,55,3,160,97,32,11,32,16,253,11,3,192,97,32,11,32,15,32,15,32,15,253,13,8,9,10,11,12,13,14,15,0,1,2,
  3,0,1,2,3,253,81,34,15,32,15,32,15,253,13,4,5,6,7,0,1,2,3,0,1,2,3,0,1,2,3,253,81,253,90,2,156,97,0,3,64,2,64,32,13,65,240,137,128,128,0,106,44,0,0,34,12,69,13,0,32,11,65,128,
  225,0,106,32,13,32,12,65,1,16,147,128,128,128,0,11,32,13,65,1,106,34,13,65,192,0,71,13,0,11,65,0,33,5,65,0,65,0,48,0,241,137,128,128,0,66,4,134,66,224,0,124,65,0,48,0,240,137,128,128,0,66,6,124,
  132,65,0,48,0,242,137,128,128,0,66,8,134,66,128,12,124,132,65,0,48,0,243,137,128,128,0,66,12,134,66,128,192,1,124,132,65,0,48,0,244,137,128,128,0,66,16,134,66,128,128,24,124,132,65,0,48,0,245,137,128,128,0,66,
  20,134,66,128,128,128,3,124,132,65,0,48,0,246,137,128,128,0,66,24,134,66,128,128,128,48,124,132,65,0,48,0,247,137,128,128,0,66,28,134,66,128,128,128,128,6,124,132,65,0,48,0,248,137,128,128,0,66,32,134,66,128,128,128,
  128,224,0,124,132,65,0,48,0,249,137,128,128,0,66,36,134,66,128,128,128,128,128,12,124,132,65,0,48,0,250,137,128,128,0,66,40,134,66,128,128,128,128,128,192,1,124,132,65,0,48,0,251,137,128,128,0,66,44,134,66,128,128,128,
  128,128,128,24,124,132,65,0,48,0,252,137,128,128,0,66,48,134,66,128,128,128,128,128,128,128,3,124,132,65,0,48,0,253,137,128,128,0,66,52,134,66,128,128,128,128,128,128,128,48,124,132,65,0,49,0,254,137,128,128,0,66,56,134,
  66,128,128,128,128,128,128,128,128,6,124,132,65,0,49,0,255,137,128,128,0,66,60,134,66,128,128,128,128,128,128,128,128,224,0,124,132,55,3,160,241,141,128,0,65,0,65,0,48,0,129,138,128,128,0,66,4,134,66,224,0,124,65,0,
  48,0,128,138,128,128,0,66,6,124,132,65,0,48,0,130,138,128,128,0,66,8,134,66,128,12,124,132,65,0,48,0,131,138,128,128,0,66,12,134,66,128,192,1,124,132,65,0,48,0,132,138,128,128,0,66,16,134,66,128,128,24,124,132,
  65,0,48,0,133,138,128,128,0,66,20,134,66,128,128,128,3,124,132,65,0,48,0,134,138,128,128,0,66,24,134,66,128,128,128,48,124,132,65,0,48,0,135,138,128,128,0,66,28,134,66,128,128,128,128,6,124,132,65,0,48,0,136,138,
  128,128,0,66,32,134,66,128,128,128,128,224,0,124,132,65,0,48,0,137,138,128,128,0,66,36,134,66,128,128,128,128,128,12,124,132,65,0,48,0,138,138,128,128,0,66,40,134,66,128,128,128,128,128,192,1,124,132,65,0,48,0,139,138,
  128,128,0,66,44,134,66,128,128,128,128,128,128,24,124,132,65,0,48,0,140,138,128,128,0,66,48,134,66,128,128,128,128,128,128,128,3,124,132,65,0,48,0,141,138,128,128,0,66,52,134,66,128,128,128,128,128,128,128,48,124,132,65,0,
  49,0,142,138,128,128,0,66,56,134,66,128,128,128,128,128,128,128,128,6,124,132,65,0,49,0,143,138,128,128,0,66,60,134,66,128,128,128,128,128,128,128,128,224,0,124,132,55,3,168,241,141,128,0,65,0,65,0,48,0,145,138,128,128,
  0,66,4,134,66,224,0,124,65,0,48,0,144,138,128,128,0,66,6,124,132,65,0,48,0,146,138,128,128,0,66,8,134,66,128,12,124,132,65,0,48,0,147,138,128,128,0,66,12,134,66,128,192,1,124,132,65,0,48,0,148,138,128,128,
  0,66,16,134,66,128,128,24,124,132,65,0,48,0,149,138,128,128,0,66,20,134,66,128,128,128,3,124,132,65,0,48,0,150,138,128,128,0,66,24,134,66,128,128,128,48,124,132,65,0,48,0,151,138,128,128,0,66,28,134,66,128,128,128,
  128,6,124,132,65,0,48,0,152,138,128,128,0,66,32,134,66,128,128,128,128,224,0,124,132,65,0,48,0,153,138,128,128,0,66,36,134,66,128,128,128,128,128,12,124,132,65,0,48,0,154,138,128,128,0,66,40,134,66,128,128,128,128,128,
  192,1,124,132,65,0,48,0,155,138,128,128,0,66,44,134,66,128,128,128,128,128,128,24,124,132,65,0,48,0,156,138,128,128,0,66,48,134,66,128,128,128,128,128,128,128,3,124,132,65,0,48,0,157,138,128,128,0,66,52,134,66,128,128,
  128,128,128,128,128,48,124,132,65,0,49,0,158,138,128,128,0,66,56,134,66,128,128,128,128,128,128,128,128,6,124,132,65,0,49,0,159,138,128,128,0,66,60,134,66,128,128,128,128,128,128,128,128,224,0,124,132,55,3,176,241,141,128,0,
  65,0,65,0,48,0,161,138,128,128,0,66,4,134,66,224,0,124,65,0,48,0,160,138,128,128,0,66,6,124,132,65,0,48,0,162,138,128,128,0,66,8,134,66,128,12,124,132,65,0,48,0,163,138,128,128,0,66,12,134,66,128,192,1,
  124,132,65,0,48,0,164,138,128,128,0,66,16,134,66,128,128,24,124,132,65,0,48,0,165,138,128,128,0,66,20,134,66,128,128,128,3,124,132,65,0,48,0,166,138,128,128,0,66,24,134,66,128,128,128,48,124,132,65,0,48,0,167,138,
  128,128,0,66,28,134,66,128,128,128,128,6,124,132,65,0,48,0,168,138,128,128,0,66,32,134,66,128,128,128,128,224,0,124,132,65,0,48,0,169,138,128,128,0,66,36,134,66,128,128,128,128,128,12,124,132,65,0,48,0,170,138,128,128,
  0,66,40,134,66,128,128,128,128,128,192,1,124,132,65,0,48,0,171,138,128,128,0,66,44,134,66,128,128,128,128,128,128,24,124,132,65,0,48,0,172,138,128,128,0,66,48,134,66,128,128,128,128,128,128,128,3,124,132,65,0,48,0,173,
  138,128,128,0,66,52,134,66,128,128,128,128,128,128,128,48,124,132,65,0,49,0,174,138,128,128,0,66,56,134,66,128,128,128,128,128,128,128,128,6,124,132,65,0,49,0,175,138,128,128,0,66,60,134,66,128,128,128,128,128,128,128,128,224,
  0,124,132,55,3,184,241,141,128,0,65,0,65,0,54,2,208,239,129,128,0,65,0,32,7,54,2,216,239,129,128,0,65,0,32,8,54,2,220,239,129,128,0,65,0,65,0,58,0,224,239,129,128,0,65,0,65,0,54,2,212,239,129,128,
  0,65,0,32,9,54,2,228,239,129,128,0,65,0,65,0,32,0,107,54,2,232,239,129,128,0,65,0,65,0,40,2,236,239,129,128,0,65,1,106,34,13,65,1,32,13,65,1,75,27,34,2,54,2,236,239,129,128,0,2,64,32,10,65,
  1,72,13,0,32,10,65,0,32,10,65,0,74,27,34,13,65,128,4,32,13,65,128,4,73,27,33,19,3,64,32,5,65,34,108,34,13,65,234,215,128,128,0,106,47,1,0,34,14,173,66,16,134,32,13,65,232,215,128,128,0,106,47,1,
  0,34,0,173,132,32,13,65,236,215,128,128,0,106,47,1,0,34,10,173,66,32,134,132,32,13,65,238,215,128,128,0,106,47,1,0,34,1,173,66,48,134,132,33,20,32,13,65,226,215,128,128,0,106,47,1,0,34,9,173,66,16,134,32,
  13,65,224,215,128,128,0,106,47,1,0,34,8,173,132,32,13,65,228,215,128,128,0,106,47,1,0,34,7,173,66,32,134,132,32,13,65,230,215,128,128,0,106,47,1,0,34,4,173,66,48,134,132,33,21,32,13,65,218,215,128,128,0,106,
  47,1,0,34,3,173,66,16,134,32,13,65,216,215,128,128,0,106,47,1,0,34,22,173,132,32,13,65,220,215,128,128,0,106,47,1,0,34,23,173,66,32,134,132,32,13,65,222,215,128,128,0,106,47,1,0,34,24,173,66,48,134,132,33,
  25,32,13,65,210,215,128,128,0,106,47,1,0,34,26,173,66,16,134,32,13,65,208,215,128,128,0,106,47,1,0,34,27,173,132,32,13,65,212,215,128,128,0,106,47,1,0,34,28,173,66,32,134,132,32,13,65,214,215,128,128,0,106,47,
  1,0,34,29,173,66,48,134,132,33,30,65,128,8,33,12,32,27,65,197,187,242,136,120,115,65,147,131,128,8,108,32,26,115,65,147,131,128,8,108,32,28,115,65,147,131,128,8,108,32,29,115,65,147,131,128,8,108,32,22,115,65,147,131,
  128,8,108,32,3,115,65,147,131,128,8,108,32,23,115,65,147,131,128,8,108,32,24,115,65,147,131,128,8,108,32,8,115,65,147,131,128,8,108,32,9,115,65,147,131,128,8,108,32,7,115,65,147,131,128,8,108,32,4,115,65,147,131,128,
  8,108,32,0,115,65,147,131,128,8,108,32,14,115,65,147,131,128,8,108,32,10,115,65,147,131,128,8,108,32,1,115,65,147,131,128,8,108,32,13,65,240,215,128,128,0,106,47,1,0,34,1,115,65,147,131,128,8,108,34,0,33,13,2,
  64,3,64,2,64,32,13,65,255,7,113,34,14,65,48,108,34,13,65,192,241,141,128,0,106,34,10,40,2,0,32,2,70,13,0,32,10,32,2,54,2,0,32,13,65,196,241,141,128,0,106,32,0,54,2,0,32,13,65,232,241,141,128,0,
  106,32,20,55,3,0,32,13,65,224,241,141,128,0,106,32,21,55,3,0,32,13,65,216,241,141,128,0,106,32,25,55,3,0,32,13,65,208,241,141,128,0,106,32,30,55,3,0,32,13,65,204,241,141,128,0,106,32,1,59,1,0,32,13,
  65,200,241,141,128,0,106,32,5,65,2,116,65,208,223,129,128,0,106,40,2,0,54,2,0,12,2,11,2,64,32,13,65,196,241,141,128,0,106,40,2,0,32,0,71,13,0,32,13,65,204,241,141,128,0,106,47,1,0,32,1,71,13,0,
  32,13,65,208,241,141,128,0,106,41,3,0,32,30,82,13,0,32,13,65,216,241,141,128,0,106,41,3,0,32,25,82,13,0,32,13,65,224,241,141,128,0,106,41,3,0,32,21,82,13,0,32,13,65,232,241,141,128,0,106,41,3,0,32,
  20,82,13,0,32,13,65,200,241,141,128,0,106,32,5,65,2,116,65,208,223,129,128,0,106,40,2,0,54,2,0,12,2,11,32,14,65,1,106,33,13,32,12,65,127,106,34,12,13,0,11,11,32,5,65,1,106,34,5,32,19,71,13,0,
  11,11,65,0,33,31,65,0,65,0,54,2,244,239,129,128,0,65,0,65,0,54,2,240,239,129,128,0,65,0,65,0,54,2,248,239,129,128,0,65,0,65,0,54,2,252,239,129,128,0,65,128,240,129,128,0,65,0,65,132,128,4,252,11,
  0,65,144,240,133,128,0,65,0,65,128,128,8,252,11,0,65,144,240,141,128,0,65,0,65,128,1,252,11,0,2,64,32,11,65,128,225,0,106,65,0,16,148,128,128,128,0,34,19,69,13,0,2,64,32,19,65,1,72,13,0,32,11,40,
  2,128,97,33,0,65,0,33,13,32,19,33,14,3,64,32,11,65,128,17,106,32,13,106,65,0,54,2,0,32,11,65,128,209,0,106,32,13,106,32,13,65,208,166,128,128,0,106,40,2,0,34,12,54,2,0,32,11,65,128,225,0,106,32,
  11,65,128,193,0,106,32,12,32,11,65,128,33,106,16,149,128,128,128,0,32,11,65,128,49,106,32,13,106,65,0,32,11,65,128,193,0,106,16,150,128,128,128,0,107,54,2,0,32,0,32,12,32,11,65,128,33,106,16,151,128,128,128,0,
  32,13,65,4,106,33,13,32,14,65,127,106,34,14,13,0,11,32,19,65,1,70,13,0,65,0,33,27,65,2,33,28,65,1,33,24,3,64,32,11,65,128,209,0,106,32,24,65,2,116,34,13,106,40,2,0,34,22,65,7,113,33,9,32,
  22,65,9,118,65,7,113,33,29,32,22,65,6,118,65,7,113,33,26,32,22,65,3,118,65,7,113,33,3,32,22,65,18,118,65,7,113,65,126,106,34,4,65,2,116,65,224,137,128,128,0,106,33,23,32,11,65,128,49,106,32,13,106,40,
  2,0,33,1,32,27,33,13,32,28,33,2,32,24,33,0,2,64,2,64,3,64,2,64,2,64,32,11,65,128,49,106,32,13,106,34,10,40,2,0,34,14,32,1,78,13,0,32,11,65,128,209,0,106,32,13,106,40,2,0,33,12,12,1,
  11,32,14,32,1,71,13,3,65,0,33,8,65,0,33,7,2,64,32,11,65,128,209,0,106,32,13,106,40,2,0,34,12,65,18,118,65,7,113,65,126,106,34,5,65,3,75,13,0,32,5,65,2,116,65,224,137,128,128,0,106,40,2,0,
  33,7,11,32,12,65,7,113,33,5,2,64,32,4,65,3,75,13,0,32,23,40,2,0,33,8,11,32,5,32,9,73,13,3,32,5,32,9,75,13,0,32,12,65,3,118,65,7,113,34,5,32,3,73,13,3,32,5,32,3,75,13,0,32,
  12,65,6,118,65,7,113,34,5,32,26,73,13,3,32,5,32,26,75,13,0,32,12,65,9,118,65,7,113,34,5,32,29,73,13,2,32,5,32,29,75,13,0,32,7,32,8,77,13,3,11,32,10,65,4,106,32,14,54,2,0,32,11,65,
  128,209,0,106,32,13,106,65,4,106,32,12,54,2,0,32,11,65,128,17,106,32,13,106,34,12,65,4,106,32,12,40,2,0,54,2,0,32,0,65,127,106,33,0,32,13,65,124,106,33,13,32,2,65,127,106,34,2,65,1,74,13,0,11,
  65,0,33,0,12,1,11,32,2,65,127,106,33,0,11,32,11,65,128,49,106,32,0,65,2,116,34,13,106,32,1,54,2,0,32,11,65,128,209,0,106,32,13,106,32,22,54,2,0,32,11,65,128,17,106,32,13,106,65,0,54,2,0,32,
  27,65,4,106,33,27,32,28,65,1,106,33,28,32,24,65,1,106,34,24,32,19,71,13,0,11,11,2,64,2,64,32,6,65,1,78,13,0,32,19,33,31,12,1,11,32,11,65,128,193,0,106,65,124,106,33,32,32,11,65,128,1,106,65,
  124,106,33,33,32,11,65,128,33,106,65,124,106,33,34,32,11,40,2,128,97,33,35,65,1,33,36,32,19,33,31,3,64,65,0,32,36,54,2,144,241,141,128,0,65,0,65,0,58,0,224,239,129,128,0,2,64,2,64,32,31,65,1,72,
  13,0,32,36,65,127,106,33,37,65,128,166,187,118,33,22,65,0,33,3,32,32,33,26,32,33,33,27,32,34,33,28,3,64,32,11,65,128,225,0,106,32,11,65,16,106,32,11,65,128,209,0,106,32,3,65,2,116,106,40,2,0,34,8,
  32,11,65,14,106,16,149,128,128,128,0,32,11,65,16,106,32,37,65,128,166,187,118,65,0,32,22,107,65,1,32,8,16,152,128,128,128,0,33,13,32,35,32,8,32,11,65,14,106,16,151,128,128,128,0,65,0,45,0,224,239,129,128,0,
  13,4,65,0,33,38,32,22,65,128,166,187,118,70,32,22,65,0,32,13,107,34,1,72,114,33,39,2,64,32,3,69,13,0,32,8,65,7,113,33,9,32,8,65,9,118,65,7,113,33,40,32,8,65,6,118,65,7,113,33,19,32,8,65,
  3,118,65,7,113,33,24,32,8,65,18,118,65,7,113,65,126,106,34,23,65,2,116,65,224,137,128,128,0,106,33,29,32,26,33,12,32,27,33,14,32,28,33,13,32,3,33,10,3,64,2,64,2,64,32,13,40,2,0,34,2,32,1,78,
  13,0,32,12,40,2,0,33,0,12,1,11,2,64,32,2,32,1,70,13,0,32,10,33,38,12,3,11,65,0,33,7,65,0,33,4,2,64,32,12,40,2,0,34,0,65,18,118,65,7,113,65,126,106,34,5,65,3,75,13,0,32,5,65,
  2,116,65,224,137,128,128,0,106,40,2,0,33,4,11,32,0,65,7,113,33,5,2,64,32,23,65,3,75,13,0,32,29,40,2,0,33,7,11,2,64,32,5,32,9,79,13,0,32,10,33,38,12,3,11,32,5,32,9,75,13,0,2,64,
  32,0,65,3,118,65,7,113,34,5,32,24,79,13,0,32,10,33,38,12,3,11,32,5,32,24,75,13,0,2,64,32,0,65,6,118,65,7,113,34,5,32,19,79,13,0,32,10,33,38,12,3,11,32,5,32,19,75,13,0,2,64,32,0,
  65,9,118,65,7,113,34,5,32,40,79,13,0,32,10,33,38,12,3,11,32,5,32,40,75,13,0,32,4,32,7,75,13,0,32,10,33,38,12,2,11,32,13,65,4,106,32,2,54,2,0,32,12,65,4,106,32,0,54,2,0,32,14,65,
  4,106,32,14,40,2,0,54,2,0,32,12,65,124,106,33,12,32,14,65,124,106,33,14,32,13,65,124,106,33,13,32,10,65,127,106,34,10,65,1,106,65,1,75,13,0,11,11,32,11,65,128,33,106,32,38,65,2,116,34,13,106,32,1,
  54,2,0,32,11,65,128,193,0,106,32,13,106,32,8,54,2,0,32,11,65,128,1,106,32,13,106,32,39,54,2,0,32,11,40,2,136,33,32,22,32,3,65,1,75,27,33,22,32,26,65,4,106,33,26,32,27,65,4,106,33,27,32,28,
  65,4,106,33,28,32,3,65,1,106,34,3,32,31,71,13,0,11,32,11,65,128,209,0,106,32,11,65,128,193,0,106,32,31,65,2,116,34,13,252,10,0,0,32,11,65,128,49,106,32,11,65,128,33,106,32,13,252,10,0,0,32,11,65,
  128,17,106,32,11,65,128,1,106,32,13,252,10,0,0,65,0,32,36,54,2,212,239,129,128,0,32,11,40,2,128,49,34,13,32,13,65,31,117,34,13,115,32,13,107,65,156,217,196,9,75,13,3,32,36,32,6,72,13,1,12,3,11,65,
  0,33,31,65,0,32,36,54,2,212,239,129,128,0,32,36,32,6,78,13,3,11,32,36,65,1,106,33,36,12,0,11,11,32,31,65,1,72,13,0,65,208,166,128,128,0,32,11,65,128,209,0,106,32,31,65,2,116,34,13,252,10,0,0,
  65,224,182,128,128,0,32,11,65,128,49,106,32,13,252,10,0,0,65,224,198,128,128,0,32,11,65,128,17,106,32,13,252,10,0,0,11,32,11,65,240,225,0,106,36,128,128,128,128,0,32,31,11,225,4,2,4,127,1,126,32,0,32,2,
  32,2,65,31,117,34,4,115,32,4,107,34,4,65,6,116,32,1,32,1,65,56,115,32,2,65,0,74,34,5,27,106,65,2,116,34,6,65,204,138,128,128,0,106,40,2,0,32,4,65,2,116,65,176,138,128,128,0,106,34,7,40,2,0,
  106,32,3,65,0,32,3,107,32,5,27,34,5,108,32,0,40,2,32,106,54,2,32,32,0,32,6,65,204,152,128,128,0,106,40,2,0,32,7,40,2,0,106,32,5,108,32,0,40,2,36,106,54,2,36,65,1,33,5,2,64,32,4,65,
  254,255,255,255,7,113,65,2,70,13,0,65,2,33,5,32,4,65,4,70,13,0,32,4,65,5,70,65,2,116,33,5,11,32,0,32,0,40,2,40,32,5,32,3,108,106,54,2,40,66,1,32,1,173,134,33,8,2,64,2,64,32,2,65,
  1,72,13,0,2,64,32,3,65,1,72,13,0,32,0,32,0,41,3,96,32,8,132,55,3,96,12,2,11,32,0,32,0,41,3,96,32,8,66,127,133,131,55,3,96,12,1,11,2,64,32,3,65,1,72,13,0,32,0,32,0,41,3,104,
  32,8,132,55,3,104,12,1,11,32,0,32,0,41,3,104,32,8,66,127,133,131,55,3,104,11,2,64,2,64,2,64,2,64,32,4,65,127,106,14,4,0,3,1,2,3,11,2,64,32,2,65,1,72,13,0,2,64,2,64,32,3,65,1,
  72,13,0,32,0,32,0,41,3,64,32,8,132,55,3,64,12,1,11,32,0,32,0,41,3,64,32,8,66,127,133,131,55,3,64,11,32,0,32,0,40,2,52,65,1,32,1,65,2,116,116,34,2,65,0,32,2,107,32,3,65,0,74,27,
  106,54,2,52,15,11,2,64,2,64,32,3,65,1,72,13,0,32,0,32,0,41,3,72,32,8,132,55,3,72,12,1,11,32,0,32,0,41,3,72,32,8,66,127,133,131,55,3,72,11,32,0,32,0,40,2,56,65,1,32,1,65,2,116,
  116,34,2,65,0,32,2,107,32,3,65,0,74,27,106,54,2,56,15,11,2,64,32,2,65,1,72,13,0,32,0,32,0,40,2,44,32,3,106,54,2,44,15,11,32,0,32,0,40,2,48,32,3,106,54,2,48,15,11,2,64,32,2,65,
  1,72,13,0,2,64,32,3,65,1,72,13,0,32,0,32,0,41,3,80,32,8,132,55,3,80,15,11,32,0,32,0,41,3,80,32,8,66,127,133,131,55,3,80,15,11,2,64,32,3,65,1,72,13,0,32,0,32,0,41,3,88,32,8,
  132,55,3,88,15,11,32,0,32,0,41,3,88,32,8,66,127,133,131,55,3,88,11,11,176,30,3,3,127,1,126,32,127,32,0,65,12,65,16,32,0,40,2,0,34,2,65,0,74,34,3,27,106,40,2,0,33,4,65,0,32,2,54,2,
  208,182,128,128,0,65,0,32,4,54,2,212,182,128,128,0,65,0,32,1,54,2,216,182,128,128,0,65,0,65,0,54,2,220,182,128,128,0,65,0,33,4,2,64,2,64,32,0,65,224,0,65,232,0,32,3,27,106,41,3,0,34,5,80,
  13,0,65,7,65,0,32,2,65,1,70,34,3,27,33,6,65,1,65,6,32,3,27,33,7,32,0,40,2,8,34,8,65,6,116,33,9,32,0,40,2,4,34,0,65,2,113,33,10,32,0,65,1,113,33,11,32,0,65,8,113,33,12,32,
  0,65,4,113,33,13,32,2,65,4,116,33,14,32,2,65,3,116,33,15,65,0,32,2,107,33,16,3,64,32,5,122,167,34,17,65,3,118,33,18,32,17,65,7,113,33,19,2,64,2,64,2,64,2,64,2,64,32,17,65,240,137,128,128,
  0,106,34,4,45,0,0,34,0,32,0,192,65,7,117,34,0,115,32,0,107,65,255,1,113,34,20,65,127,106,14,2,0,1,2,11,2,64,32,15,32,17,106,34,0,65,63,75,13,0,32,0,65,240,137,128,128,0,106,45,0,0,13,0,
  65,1,33,3,32,17,32,0,32,6,16,136,128,128,128,0,13,7,32,18,32,7,71,13,0,32,0,65,3,118,32,6,70,13,0,32,14,32,17,106,34,18,65,240,137,128,128,0,106,34,21,45,0,0,13,0,65,0,40,2,216,182,128,128,
  0,34,22,65,1,70,13,0,32,4,45,0,0,33,23,32,4,65,0,58,0,0,32,21,32,23,58,0,0,32,18,65,0,40,2,212,182,128,128,0,32,23,32,23,192,65,7,117,34,24,115,32,24,107,65,255,1,113,34,25,65,6,70,27,
  65,0,65,0,40,2,208,182,128,128,0,107,16,134,128,128,128,0,33,24,32,4,32,23,58,0,0,32,21,65,0,58,0,0,32,24,13,0,32,22,65,2,70,13,7,65,0,65,0,40,2,220,182,128,128,0,34,3,65,1,106,54,2,220,
  182,128,128,0,32,3,65,2,116,65,208,166,128,128,0,106,32,18,65,6,116,32,25,65,12,116,114,32,17,114,65,128,128,128,1,114,54,2,0,11,2,64,32,19,69,13,0,32,0,65,191,127,106,65,64,73,13,0,2,64,32,0,65,127,
  106,34,3,65,240,137,128,128,0,106,34,18,44,0,0,34,21,69,13,0,65,1,65,127,32,21,65,0,74,27,32,16,71,13,0,32,17,32,3,32,6,16,136,128,128,128,0,69,13,1,65,1,15,11,32,3,32,8,71,13,0,32,4,45,
  0,0,33,3,32,4,65,0,58,0,0,32,18,32,3,58,0,0,32,8,65,0,40,2,208,182,128,128,0,34,22,65,3,116,107,34,24,65,240,137,128,128,0,106,34,23,45,0,0,33,26,32,23,65,0,58,0,0,65,0,40,2,216,182,
  128,128,0,33,27,32,8,65,0,40,2,212,182,128,128,0,32,3,32,3,192,65,7,117,34,25,115,32,25,107,65,255,1,113,34,25,65,6,70,27,65,0,32,22,107,16,134,128,128,128,0,33,22,2,64,32,24,65,0,72,13,0,32,23,
  32,26,58,0,0,11,32,4,32,3,58,0,0,32,18,32,21,58,0,0,32,22,13,0,2,64,32,27,65,2,71,13,0,65,1,15,11,65,0,65,0,40,2,220,182,128,128,0,34,3,65,1,106,54,2,220,182,128,128,0,32,3,65,2,
  116,65,208,166,128,128,0,106,32,9,32,25,65,12,116,114,32,17,114,65,128,128,130,2,114,54,2,0,11,32,19,65,7,70,13,3,32,0,65,65,106,65,64,73,13,3,2,64,32,0,65,1,106,34,0,65,240,137,128,128,0,106,34,21,
  44,0,0,34,3,69,13,0,65,1,65,127,32,3,65,0,74,27,32,16,71,13,0,32,17,32,0,32,6,16,136,128,128,128,0,69,13,4,65,1,15,11,32,0,32,8,71,13,3,32,4,45,0,0,33,0,32,4,65,0,58,0,0,32,
  21,32,0,58,0,0,32,8,65,0,40,2,208,182,128,128,0,34,18,65,3,116,107,34,23,65,240,137,128,128,0,106,34,19,45,0,0,33,24,32,19,65,0,58,0,0,65,0,40,2,216,182,128,128,0,33,25,32,8,65,0,40,2,212,
  182,128,128,0,32,0,32,0,192,65,7,117,34,22,115,32,22,107,65,255,1,113,34,22,65,6,70,27,65,0,32,18,107,16,134,128,128,128,0,33,18,2,64,32,23,65,0,72,13,0,32,19,32,24,58,0,0,11,32,4,32,0,58,0,
  0,32,21,32,3,58,0,0,32,18,13,3,2,64,32,25,65,2,71,13,0,65,1,15,11,32,9,32,22,65,12,116,114,32,17,114,65,128,128,130,2,114,33,0,12,2,11,65,0,65,0,40,2,208,182,128,128,0,107,33,28,65,0,40,
  2,212,182,128,128,0,33,29,65,0,40,2,216,182,128,128,0,33,27,65,0,40,2,220,182,128,128,0,33,30,65,96,33,0,3,64,2,64,32,0,65,160,136,128,128,0,106,40,2,0,32,19,106,34,21,65,7,75,13,0,32,0,65,192,
  136,128,128,0,106,40,2,0,32,18,106,34,3,65,0,72,13,0,32,3,65,7,74,13,0,2,64,2,64,32,3,65,3,116,32,21,106,34,22,65,240,137,128,128,0,106,34,23,44,0,0,34,3,69,13,0,65,1,65,127,32,3,65,0,
  74,27,32,16,71,13,2,32,3,32,3,65,31,117,34,21,115,32,21,107,33,25,12,1,11,65,0,33,25,32,27,65,1,70,13,1,11,32,4,45,0,0,33,21,32,4,65,0,58,0,0,32,23,32,21,58,0,0,32,22,32,29,32,21,
  32,21,192,65,7,117,34,24,115,32,24,107,65,255,1,113,34,26,65,6,70,27,32,28,16,134,128,128,128,0,33,24,32,4,32,21,58,0,0,32,23,32,3,58,0,0,32,24,13,0,2,64,32,27,65,2,71,13,0,65,1,15,11,65,
  0,32,30,65,1,106,34,3,54,2,220,182,128,128,0,32,30,65,2,116,65,208,166,128,128,0,106,32,22,65,6,116,32,25,65,15,116,114,32,26,65,12,116,114,32,17,114,54,2,0,32,3,33,30,11,32,0,65,4,106,34,0,13,0,
  12,3,11,11,2,64,32,20,65,4,70,65,3,116,34,30,65,8,65,16,32,20,65,3,70,27,34,31,79,13,0,65,0,65,0,40,2,208,182,128,128,0,107,33,32,65,0,40,2,212,182,128,128,0,33,33,65,0,40,2,220,182,128,128,
  0,33,34,65,0,40,2,216,182,128,128,0,33,35,3,64,32,19,32,30,65,2,116,34,0,65,192,136,128,128,0,106,40,2,0,34,23,106,34,21,65,8,73,32,18,32,0,65,196,136,128,128,0,106,40,2,0,34,22,106,34,0,65,127,
  74,113,32,0,65,8,72,113,33,3,2,64,2,64,2,64,2,64,32,35,65,1,71,13,0,2,64,32,20,65,6,71,13,0,32,3,69,13,4,32,0,65,3,116,32,21,106,34,0,65,240,137,128,128,0,106,34,26,45,0,0,34,25,69,
  13,4,12,2,11,32,3,69,13,3,32,21,32,0,65,3,116,106,33,0,32,18,32,22,65,1,116,106,33,3,32,23,32,22,65,3,116,106,33,27,32,19,32,23,65,1,116,106,33,21,3,64,32,0,65,240,137,128,128,0,106,34,26,45,
  0,0,34,25,13,2,32,21,65,7,75,13,4,32,3,65,0,72,13,4,32,0,32,27,106,33,0,32,21,32,23,106,33,21,32,3,65,7,74,33,24,32,3,32,22,106,33,3,32,24,13,4,12,0,11,11,2,64,2,64,32,20,65,6,
  71,13,0,32,3,69,13,4,32,0,65,3,116,32,21,106,34,0,65,240,137,128,128,0,106,34,26,45,0,0,34,25,13,2,32,4,45,0,0,33,3,32,4,65,0,58,0,0,32,0,65,240,137,128,128,0,106,34,21,32,3,58,0,0,
  32,0,32,33,32,3,32,3,192,65,7,117,34,23,115,32,23,107,65,255,1,113,34,22,65,6,70,27,32,32,16,134,128,128,128,0,33,23,32,4,32,3,58,0,0,32,21,65,0,58,0,0,32,23,13,4,32,35,65,2,71,13,1,65,
  1,15,11,32,3,69,13,3,32,22,65,9,116,32,23,65,6,116,106,33,36,32,21,32,0,65,3,116,106,34,0,65,6,116,33,27,32,18,32,22,65,1,116,106,33,21,32,23,32,22,65,3,116,106,33,37,32,19,32,23,65,1,116,106,
  33,24,32,34,33,29,3,64,32,0,65,240,137,128,128,0,106,34,26,45,0,0,34,25,13,2,32,4,45,0,0,33,3,32,4,65,0,58,0,0,32,0,65,240,137,128,128,0,106,34,25,32,3,58,0,0,32,0,32,33,32,3,32,3,
  192,65,7,117,34,26,115,32,26,107,65,255,1,113,34,28,65,6,70,27,32,32,16,134,128,128,128,0,33,26,32,4,32,3,58,0,0,32,25,65,0,58,0,0,2,64,32,26,13,0,2,64,32,35,65,2,71,13,0,65,1,15,11,65,
  0,32,29,65,1,106,34,34,54,2,220,182,128,128,0,32,29,65,2,116,65,208,166,128,128,0,106,32,27,32,28,65,12,116,114,32,17,114,54,2,0,32,34,33,29,11,32,24,65,7,75,13,4,32,21,65,0,72,13,4,32,27,32,36,
  106,33,27,32,0,32,37,106,33,0,32,24,32,23,106,33,24,32,21,65,8,72,33,3,32,21,32,22,106,33,21,32,3,13,0,12,4,11,11,32,0,65,6,116,32,22,65,12,116,114,33,0,12,1,11,65,1,65,127,32,25,192,34,21,
  65,0,74,27,32,16,71,13,1,32,4,45,0,0,33,3,32,4,65,0,58,0,0,32,26,32,3,58,0,0,32,0,32,33,32,3,32,3,192,65,7,117,34,23,115,32,23,107,65,255,1,113,34,22,65,6,70,27,32,32,16,134,128,128,
  128,0,33,23,32,4,32,3,58,0,0,32,26,32,25,58,0,0,32,23,13,1,2,64,32,35,65,2,71,13,0,65,1,15,11,32,0,65,6,116,32,21,32,21,65,31,117,34,0,115,32,0,107,65,15,116,114,32,22,65,12,116,114,33,
  0,11,65,0,32,34,34,3,65,1,106,34,34,54,2,220,182,128,128,0,32,3,65,2,116,65,208,166,128,128,0,106,32,0,32,17,114,54,2,0,11,32,30,65,2,106,34,30,32,31,73,13,0,11,11,2,64,32,2,65,1,71,13,0,
  32,17,65,4,71,13,0,32,20,65,6,71,13,0,2,64,32,11,69,13,0,65,0,45,0,247,137,128,128,0,65,255,1,113,65,4,71,13,0,65,0,45,0,245,137,128,128,0,65,255,1,113,13,0,65,0,45,0,246,137,128,128,0,65,
  255,1,113,13,0,65,4,65,127,16,134,128,128,128,0,13,0,65,5,65,127,16,134,128,128,128,0,13,0,65,6,65,127,16,134,128,128,128,0,13,0,65,0,40,2,216,182,128,128,0,34,4,65,1,70,13,0,65,0,65,0,45,0,244,
  137,128,128,0,34,0,58,0,246,137,128,128,0,65,5,65,61,65,0,40,2,208,182,128,128,0,34,21,65,1,70,34,3,27,65,240,137,128,128,0,106,34,19,65,7,65,63,32,3,27,65,240,137,128,128,0,106,34,3,45,0,0,34,18,
  58,0,0,32,3,65,0,58,0,0,65,0,65,0,58,0,244,137,128,128,0,65,6,65,0,40,2,212,182,128,128,0,32,0,32,0,192,65,7,117,34,23,115,32,23,107,65,255,1,113,34,23,65,6,70,27,65,0,32,21,107,16,134,128,
  128,128,0,33,21,32,19,65,0,58,0,0,32,3,32,18,58,0,0,65,0,32,0,58,0,244,137,128,128,0,65,0,65,0,58,0,246,137,128,128,0,32,21,13,0,2,64,32,4,65,2,71,13,0,65,1,15,11,65,0,65,0,40,2,
  220,182,128,128,0,34,0,65,1,106,54,2,220,182,128,128,0,32,0,65,2,116,65,208,166,128,128,0,106,32,23,65,12,116,65,132,131,128,4,114,54,2,0,11,32,10,69,13,2,65,0,45,0,240,137,128,128,0,65,255,1,113,65,4,
  71,13,2,65,0,45,0,241,137,128,128,0,65,255,1,113,13,2,65,0,45,0,242,137,128,128,0,65,255,1,113,13,2,65,0,45,0,243,137,128,128,0,65,255,1,113,13,2,65,4,65,127,16,134,128,128,128,0,13,2,65,3,65,127,
  16,134,128,128,128,0,13,2,65,2,65,127,16,134,128,128,128,0,13,2,65,0,40,2,216,182,128,128,0,34,21,65,1,70,13,2,65,0,65,0,45,0,244,137,128,128,0,34,0,58,0,242,137,128,128,0,65,0,65,0,58,0,244,137,
  128,128,0,65,0,65,56,65,0,40,2,208,182,128,128,0,34,19,65,1,70,34,18,27,65,240,137,128,128,0,106,34,3,45,0,0,33,4,32,3,65,0,58,0,0,65,3,65,59,32,18,27,65,240,137,128,128,0,106,34,18,32,4,58,
  0,0,65,2,65,0,40,2,212,182,128,128,0,32,0,32,0,192,65,7,117,34,23,115,32,23,107,65,255,1,113,34,23,65,6,70,27,65,0,32,19,107,16,134,128,128,128,0,33,19,32,18,65,0,58,0,0,32,3,32,4,58,0,0,
  65,0,32,0,58,0,244,137,128,128,0,65,0,65,0,58,0,242,137,128,128,0,32,19,13,2,2,64,32,21,65,2,71,13,0,65,1,15,11,32,23,65,12,116,65,132,129,128,8,114,33,0,12,1,11,32,2,65,127,71,13,1,32,17,
  65,60,71,13,1,32,20,65,6,71,13,1,2,64,32,13,69,13,0,65,0,45,0,175,138,128,128,0,65,255,1,113,65,252,1,71,13,0,65,0,45,0,173,138,128,128,0,65,255,1,113,13,0,65,0,45,0,174,138,128,128,0,65,255,
  1,113,13,0,65,60,65,1,16,134,128,128,128,0,13,0,65,61,65,1,16,134,128,128,128,0,13,0,65,62,65,1,16,134,128,128,128,0,13,0,65,0,40,2,216,182,128,128,0,34,21,65,1,70,13,0,65,0,65,0,45,0,172,138,
  128,128,0,34,0,58,0,174,138,128,128,0,65,0,65,0,58,0,172,138,128,128,0,65,7,65,63,65,0,40,2,208,182,128,128,0,34,19,65,1,70,34,18,27,65,240,137,128,128,0,106,34,3,45,0,0,33,4,32,3,65,0,58,0,
  0,65,5,65,61,32,18,27,65,240,137,128,128,0,106,34,18,32,4,58,0,0,65,62,65,0,40,2,212,182,128,128,0,32,0,32,0,192,65,7,117,34,23,115,32,23,107,65,255,1,113,34,23,65,6,70,27,65,0,32,19,107,16,134,
  128,128,128,0,33,19,32,18,65,0,58,0,0,32,3,32,4,58,0,0,65,0,32,0,58,0,172,138,128,128,0,65,0,65,0,58,0,174,138,128,128,0,32,19,13,0,2,64,32,21,65,2,71,13,0,65,1,15,11,65,0,65,0,40,
  2,220,182,128,128,0,34,0,65,1,106,54,2,220,182,128,128,0,32,0,65,2,116,65,208,166,128,128,0,106,32,23,65,12,116,65,188,159,128,4,114,54,2,0,11,32,12,69,13,1,65,0,45,0,168,138,128,128,0,65,255,1,113,65,
  252,1,71,13,1,65,0,45,0,169,138,128,128,0,65,255,1,113,13,1,65,0,45,0,170,138,128,128,0,65,255,1,113,13,1,65,0,45,0,171,138,128,128,0,65,255,1,113,13,1,65,60,65,1,16,134,128,128,128,0,13,1,65,59,
  65,1,16,134,128,128,128,0,13,1,65,58,65,1,16,134,128,128,128,0,13,1,65,0,40,2,216,182,128,128,0,34,4,65,1,70,13,1,65,0,65,0,45,0,172,138,128,128,0,34,0,58,0,170,138,128,128,0,65,3,65,59,65,0,
  40,2,208,182,128,128,0,34,21,65,1,70,34,3,27,65,240,137,128,128,0,106,34,19,65,0,65,56,32,3,27,65,240,137,128,128,0,106,34,3,45,0,0,34,18,58,0,0,32,3,65,0,58,0,0,65,0,65,0,58,0,172,138,128,
  128,0,65,58,65,0,40,2,212,182,128,128,0,32,0,32,0,192,65,7,117,34,23,115,32,23,107,65,255,1,113,34,23,65,6,70,27,65,0,32,21,107,16,134,128,128,128,0,33,21,32,19,65,0,58,0,0,32,3,32,18,58,0,0,
  65,0,32,0,58,0,172,138,128,128,0,65,0,65,0,58,0,170,138,128,128,0,32,21,13,1,2,64,32,4,65,2,71,13,0,65,1,15,11,32,23,65,12,116,65,188,157,128,8,114,33,0,11,65,0,65,0,40,2,220,182,128,128,0,
  34,3,65,1,106,54,2,220,182,128,128,0,32,3,65,2,116,65,208,166,128,128,0,106,32,0,54,2,0,11,32,5,66,127,124,32,5,131,34,5,66,0,82,13,0,11,65,0,40,2,220,182,128,128,0,33,4,11,65,0,32,4,32,1,
  65,2,70,27,33,3,11,32,3,11,143,12,2,8,127,1,126,32,1,32,0,65,240,0,252,10,0,0,32,3,32,2,65,63,113,34,0,65,240,137,128,128,0,106,34,4,44,0,0,34,5,58,0,0,32,3,32,2,65,6,118,65,63,113,
  34,6,32,2,65,9,116,65,31,117,32,1,40,2,0,34,7,65,3,116,113,107,34,8,65,240,137,128,128,0,106,45,0,0,58,0,1,32,1,32,1,40,2,28,32,1,40,2,4,65,177,207,217,178,1,108,65,177,207,217,178,1,106,32,
  7,65,173,214,211,190,2,108,65,218,172,167,253,4,106,115,32,1,40,2,8,65,236,200,137,157,125,108,65,216,145,147,186,122,106,115,34,7,65,16,118,32,7,115,65,173,234,172,255,7,108,34,7,65,15,118,32,7,115,65,139,205,178,163,
  120,108,34,7,65,16,118,115,32,7,115,34,9,54,2,28,32,2,65,128,128,128,2,113,33,10,2,64,32,4,44,0,0,34,7,69,13,0,32,1,32,9,32,7,65,235,148,175,175,120,108,65,237,145,202,203,122,106,32,0,65,185,243,221,
  241,121,108,65,185,243,221,241,121,106,115,34,11,65,16,118,32,11,115,65,173,234,172,255,7,108,34,11,65,15,118,32,11,115,65,139,205,178,163,120,108,34,11,65,16,118,115,32,11,115,54,2,28,32,1,32,0,32,7,65,127,16,147,128,
  128,128,0,11,32,4,65,0,58,0,0,32,0,65,1,118,65,24,113,65,160,241,141,128,0,106,34,4,32,4,41,3,0,66,15,32,0,65,2,116,65,60,113,173,34,12,134,66,127,133,131,66,6,32,12,134,132,55,3,0,2,64,32,10,
  69,13,0,2,64,32,8,65,240,137,128,128,0,106,34,7,44,0,0,34,4,69,13,0,32,1,32,4,65,235,148,175,175,120,108,65,237,145,202,203,122,106,32,8,65,185,243,221,241,121,108,65,185,243,221,241,121,106,115,34,10,65,16,118,
  32,10,115,65,173,234,172,255,7,108,34,10,65,15,118,32,10,115,65,139,205,178,163,120,108,34,10,65,16,118,32,1,40,2,28,115,32,10,115,54,2,28,32,1,32,8,32,4,65,127,16,147,128,128,128,0,11,32,7,65,0,58,0,0,
  32,8,65,4,117,65,3,116,65,160,241,141,128,0,106,34,4,32,4,41,3,0,66,15,32,8,65,2,116,65,60,113,173,34,12,134,66,127,133,131,66,6,32,12,134,132,55,3,0,11,32,5,33,8,2,64,32,2,65,18,118,65,7,113,
  34,4,69,13,0,32,1,40,2,0,32,4,108,33,8,11,32,1,32,6,32,8,16,153,128,128,128,0,2,64,32,5,32,5,65,31,117,34,8,115,32,8,107,34,5,65,6,71,13,0,2,64,2,64,32,1,40,2,0,34,7,65,1,72,
  13,0,32,1,32,6,54,2,12,65,124,33,8,12,1,11,32,1,32,6,54,2,16,65,115,33,8,11,32,1,32,1,40,2,4,32,8,113,54,2,4,2,64,32,2,65,128,128,128,4,113,69,13,0,65,5,65,61,32,7,65,0,74,34,
  8,27,33,10,2,64,65,7,65,63,32,8,27,34,8,65,240,137,128,128,0,106,34,9,44,0,0,34,7,69,13,0,32,1,32,7,65,235,148,175,175,120,108,65,237,145,202,203,122,106,32,8,65,185,243,221,241,121,108,65,185,243,221,241,
  121,106,115,34,11,65,16,118,32,11,115,65,173,234,172,255,7,108,34,11,65,15,118,32,11,115,65,139,205,178,163,120,108,34,11,65,16,118,32,1,40,2,28,115,32,11,115,54,2,28,32,1,32,8,32,7,65,127,16,147,128,128,128,0,
  11,32,9,65,0,58,0,0,32,8,65,1,118,65,24,113,65,160,241,141,128,0,106,34,9,32,9,41,3,0,66,15,32,8,65,2,116,65,60,113,173,34,12,134,66,127,133,131,66,6,32,12,134,132,55,3,0,32,1,32,10,32,7,16,
  153,128,128,128,0,12,1,11,32,2,65,128,128,128,8,113,69,13,0,65,3,65,59,32,7,65,0,74,34,8,27,33,10,2,64,65,0,65,56,32,8,27,34,8,65,240,137,128,128,0,106,34,9,44,0,0,34,7,69,13,0,32,1,32,
  7,65,235,148,175,175,120,108,65,237,145,202,203,122,106,32,8,65,185,243,221,241,121,108,65,185,243,221,241,121,106,115,34,11,65,16,118,32,11,115,65,173,234,172,255,7,108,34,11,65,15,118,32,11,115,65,139,205,178,163,120,108,34,11,
  65,16,118,32,1,40,2,28,115,32,11,115,54,2,28,32,1,32,8,32,7,65,127,16,147,128,128,128,0,11,32,9,65,0,58,0,0,32,8,65,1,118,65,24,113,65,160,241,141,128,0,106,34,9,32,9,41,3,0,66,15,32,8,65,
  2,116,65,32,113,173,34,12,134,66,127,133,131,66,6,32,12,134,132,55,3,0,32,1,32,10,32,7,16,153,128,128,128,0,11,2,64,2,64,32,0,69,13,0,32,6,13,1,11,32,1,32,1,40,2,4,65,125,113,54,2,4,11,2,
  64,2,64,32,0,65,7,70,13,0,32,6,65,7,71,13,1,11,32,1,32,1,40,2,4,65,126,113,54,2,4,11,2,64,2,64,32,0,65,56,70,13,0,32,6,65,56,71,13,1,11,32,1,32,1,40,2,4,65,119,113,54,2,4,
  11,2,64,2,64,32,0,65,63,70,13,0,32,6,65,63,71,13,1,11,32,1,32,1,40,2,4,65,123,113,54,2,4,11,32,1,65,127,54,2,8,2,64,2,64,32,5,65,1,71,13,0,65,0,33,8,65,236,200,137,157,125,33,5,
  32,6,32,0,107,34,3,32,3,65,31,117,34,3,115,32,3,107,65,16,71,13,1,32,1,32,6,32,0,106,65,1,118,34,0,54,2,8,32,0,65,236,200,137,157,125,108,65,216,145,147,186,122,106,33,5,12,1,11,65,0,33,8,65,
  236,200,137,157,125,33,5,32,3,45,0,1,13,0,32,1,40,2,20,65,1,106,33,8,11,32,1,32,8,54,2,20,2,64,2,64,32,2,65,128,128,6,113,65,128,128,2,70,13,0,32,2,65,128,128,14,113,65,128,128,8,71,13,1,
  11,32,1,32,1,40,2,24,65,127,106,54,2,24,11,2,64,32,2,65,128,224,225,0,113,65,128,160,32,71,13,0,32,4,69,13,0,32,1,32,1,40,2,24,65,127,106,54,2,24,11,32,1,65,0,32,1,40,2,0,34,2,107,54,
  2,0,32,1,32,1,40,2,28,32,1,40,2,4,65,177,207,217,178,1,108,65,177,207,217,178,1,106,32,2,65,211,169,172,193,125,108,65,218,172,167,253,4,106,115,32,5,115,34,2,65,16,118,32,2,115,65,173,234,172,255,7,108,34,
  2,65,15,118,32,2,115,65,139,205,178,163,120,108,34,2,65,16,118,115,32,2,115,54,2,28,11,154,13,8,2,127,2,126,1,127,2,126,5,127,1,126,1,123,1,124,32,0,40,2,36,33,1,32,0,40,2,32,33,2,2,64,2,64,
  32,0,41,3,64,34,3,66,0,82,13,0,32,0,41,3,72,33,4,12,1,11,32,0,41,3,72,33,4,32,0,40,2,52,33,5,32,3,33,6,3,64,32,2,65,116,106,32,2,32,5,32,6,122,34,7,167,34,8,65,7,113,34,9,
  65,2,116,34,10,118,34,11,65,14,113,34,12,27,33,2,32,1,65,112,106,32,1,32,12,27,33,1,2,64,2,64,2,64,2,64,2,64,2,64,32,9,69,13,0,2,64,32,5,32,10,65,124,106,118,65,15,113,69,13,0,66,129,130,
  132,136,144,160,192,128,1,32,7,66,7,131,134,33,13,12,4,11,32,9,65,7,70,13,1,11,32,11,65,240,1,113,13,1,11,32,1,65,113,106,33,1,32,2,65,117,106,33,2,11,66,129,130,132,136,144,160,192,128,1,32,7,66,7,
  131,134,33,13,32,9,69,13,1,11,32,13,66,129,130,132,136,144,160,192,128,1,32,9,65,127,106,173,134,132,33,13,32,9,65,7,70,13,1,11,32,13,66,129,130,132,136,144,160,192,128,1,32,9,65,1,106,173,134,132,33,13,11,32,
  6,66,127,124,32,6,131,33,6,2,64,32,13,66,0,66,126,32,7,134,32,8,65,63,70,27,131,32,4,131,66,0,82,13,0,32,8,65,3,118,34,10,65,2,116,34,12,65,192,137,128,128,0,106,40,2,0,32,1,106,33,1,32,12,
  65,160,137,128,128,0,106,40,2,0,32,2,106,33,2,32,8,65,32,73,13,0,32,10,32,0,253,93,2,12,34,14,253,12,7,0,0,0,7,0,0,0,7,0,0,0,7,0,0,0,253,78,32,9,253,17,253,177,1,253,160,1,32,14,
  65,3,253,172,1,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,253,184,1,34,14,253,27,1,32,14,253,27,0,107,108,65,3,108,32,1,106,33,1,11,32,6,66,0,82,13,0,11,11,2,64,
  32,4,80,13,0,32,0,40,2,56,33,12,3,64,32,2,65,12,106,32,2,32,12,32,4,122,34,13,167,34,11,65,7,113,34,9,65,2,116,34,5,118,34,10,65,14,113,34,8,27,33,2,32,1,65,16,106,32,1,32,8,27,33,1,
  2,64,2,64,2,64,2,64,2,64,2,64,32,9,69,13,0,2,64,32,12,32,5,65,124,106,118,65,15,113,69,13,0,66,129,130,132,136,144,160,192,128,1,32,13,66,7,131,134,33,6,12,4,11,32,9,65,7,70,13,1,11,32,10,
  65,240,1,113,13,1,11,32,1,65,15,106,33,1,32,2,65,11,106,33,2,11,66,129,130,132,136,144,160,192,128,1,32,13,66,7,131,134,33,6,32,9,69,13,1,11,32,6,66,129,130,132,136,144,160,192,128,1,32,9,65,127,106,173,
  134,132,33,6,32,9,65,7,70,13,1,11,32,6,66,129,130,132,136,144,160,192,128,1,32,9,65,1,106,173,134,132,33,6,11,32,4,66,127,124,32,4,131,33,4,2,64,32,6,66,127,32,13,134,66,127,133,131,32,3,131,66,0,82,
  13,0,32,1,32,11,65,3,118,65,7,115,34,8,65,2,116,34,5,65,192,137,128,128,0,106,40,2,0,107,33,1,32,2,32,5,65,160,137,128,128,0,106,40,2,0,107,33,2,32,8,65,4,73,13,0,32,8,32,0,253,93,2,12,
  34,14,253,12,7,0,0,0,7,0,0,0,7,0,0,0,7,0,0,0,253,78,32,9,253,17,253,177,1,253,160,1,32,14,65,3,253,172,1,253,160,1,253,184,1,34,14,253,27,0,32,14,253,27,1,107,108,65,125,108,32,1,106,33,
  1,11,32,4,66,0,82,13,0,11,11,32,2,65,30,106,32,2,32,0,40,2,44,65,1,74,34,9,27,34,2,65,98,106,32,2,32,0,40,2,48,65,1,74,34,8,27,33,2,32,1,65,45,106,32,1,32,9,27,34,1,65,83,106,
  32,1,32,8,27,33,1,2,64,32,0,41,3,80,34,4,80,13,0,32,0,40,2,52,33,8,3,64,32,4,66,127,124,32,4,131,33,6,2,64,32,8,65,15,32,4,122,167,65,2,116,116,34,9,113,13,0,32,1,65,15,106,33,1,
  65,15,65,30,32,0,40,2,56,32,9,113,27,32,2,106,33,2,11,32,6,33,4,32,6,66,0,82,13,0,11,11,2,64,32,0,41,3,88,34,4,80,13,0,32,0,40,2,56,33,8,3,64,32,4,66,127,124,32,4,131,33,6,2,
  64,32,8,65,15,32,4,122,167,65,2,116,116,34,9,113,13,0,32,1,65,113,106,33,1,65,113,65,98,32,0,40,2,52,32,9,113,27,32,2,106,33,2,11,32,6,33,4,32,6,66,0,82,13,0,11,11,32,0,40,2,12,34,9,
  65,8,106,33,12,65,0,33,8,2,64,32,9,65,7,113,34,5,69,13,0,32,9,65,7,106,34,10,65,63,75,13,0,32,10,65,240,137,128,128,0,106,45,0,0,65,1,70,33,8,11,2,64,32,12,65,63,75,13,0,32,8,32,12,
  65,240,137,128,128,0,106,45,0,0,65,1,70,106,33,8,11,2,64,32,5,65,7,70,13,0,32,9,65,9,106,34,9,65,63,75,13,0,32,8,32,9,65,240,137,128,128,0,106,45,0,0,65,1,70,106,33,8,11,32,0,40,2,16,
  34,5,65,120,106,33,9,65,0,33,12,2,64,32,5,65,7,113,34,10,69,13,0,32,5,65,119,106,34,11,65,63,75,13,0,32,11,65,240,137,128,128,0,106,45,0,0,65,255,1,70,33,12,11,2,64,32,9,65,63,75,13,0,32,
  12,32,9,65,240,137,128,128,0,106,45,0,0,65,255,1,70,106,33,12,11,32,0,40,2,40,33,9,2,64,32,10,65,7,70,13,0,32,5,65,121,106,34,5,65,63,75,13,0,32,12,32,5,65,240,137,128,128,0,106,45,0,0,65,
  255,1,70,106,33,12,11,32,8,32,12,107,65,12,108,32,2,106,32,9,65,24,32,9,65,24,72,27,34,2,108,32,1,65,24,32,2,107,108,106,183,68,0,0,0,0,0,0,56,64,163,33,15,2,64,32,9,65,4,74,13,0,32,1,
  32,1,65,31,117,34,2,115,32,2,107,65,145,3,73,13,0,32,15,65,14,32,0,65,12,106,34,2,32,0,65,16,106,34,9,32,1,65,0,74,34,1,27,40,2,0,34,8,65,3,117,32,9,32,2,32,1,27,40,2,0,34,2,65,
  3,117,34,9,107,34,12,32,12,65,31,117,34,12,115,32,12,107,32,8,65,7,113,32,2,65,7,113,34,2,107,34,8,32,8,65,31,117,34,8,115,32,8,107,106,107,65,6,108,32,2,65,1,116,65,121,106,34,2,32,2,65,31,117,
  34,2,115,32,2,107,34,2,32,9,65,1,116,65,121,106,34,9,32,9,65,31,117,34,9,115,32,9,107,34,9,32,2,32,9,74,27,65,10,108,106,34,2,65,0,32,2,107,32,1,27,183,160,33,15,11,2,64,2,64,32,15,32,0,
  40,2,0,183,162,68,0,0,0,0,0,0,224,63,160,156,34,15,153,68,0,0,0,0,0,0,224,65,99,69,13,0,32,15,170,33,1,12,1,11,65,128,128,128,128,120,33,1,11,32,1,65,8,106,11,186,4,2,7,127,1,126,32,1,
  65,63,113,33,3,32,1,65,6,118,34,4,65,63,113,33,5,2,64,2,64,2,64,32,1,65,128,128,128,4,113,69,13,0,65,7,65,63,32,0,65,0,74,34,6,27,34,7,65,240,137,128,128,0,106,65,5,65,61,32,6,27,34,6,
  65,240,137,128,128,0,106,45,0,0,34,8,58,0,0,32,7,65,1,118,65,24,113,65,160,241,141,128,0,106,34,9,32,8,173,194,66,6,124,32,7,65,2,116,65,60,113,173,34,10,134,32,9,41,3,0,66,15,32,10,134,66,127,133,
  131,132,55,3,0,65,52,33,7,12,1,11,32,1,65,128,128,128,8,113,69,13,1,65,0,65,56,32,0,65,0,74,34,6,27,34,7,65,240,137,128,128,0,106,65,3,65,59,32,6,27,34,6,65,240,137,128,128,0,106,45,0,0,34,
  8,58,0,0,32,7,65,1,118,65,24,113,65,160,241,141,128,0,106,34,9,32,8,173,194,66,6,124,32,7,65,2,116,65,32,113,173,34,10,134,32,9,41,3,0,66,15,32,10,134,66,127,133,131,132,55,3,0,65,44,33,7,11,32,
  6,65,240,137,128,128,0,106,65,0,58,0,0,32,6,65,1,118,65,24,113,65,160,241,141,128,0,106,34,8,32,8,41,3,0,66,15,32,6,65,2,116,32,7,113,173,34,10,134,66,127,133,131,66,6,32,10,134,132,55,3,0,11,32,
  3,65,240,137,128,128,0,106,32,2,45,0,0,34,6,58,0,0,32,3,65,1,118,65,24,113,65,160,241,141,128,0,106,34,7,32,6,173,194,66,6,124,32,3,65,2,116,65,60,113,173,34,10,134,32,7,41,3,0,66,15,32,10,134,
  66,127,133,131,132,55,3,0,32,5,65,4,118,33,3,2,64,32,1,65,128,128,128,2,113,69,13,0,32,5,65,240,137,128,128,0,106,65,0,58,0,0,32,3,65,3,116,65,160,241,141,128,0,106,34,1,32,1,41,3,0,66,15,32,
  4,65,2,116,65,60,113,173,34,10,134,66,127,133,131,66,6,32,10,134,132,55,3,0,32,5,32,0,65,3,116,107,34,4,65,4,117,33,3,32,4,33,5,11,32,5,65,240,137,128,128,0,106,32,2,45,0,1,34,1,58,0,0,32,
  3,65,3,116,65,160,241,141,128,0,106,34,5,32,1,173,194,66,6,124,32,4,65,2,116,65,60,113,173,34,10,134,32,5,41,3,0,66,15,32,10,134,66,127,133,131,132,55,3,0,11,142,21,1,26,127,35,128,128,128,128,0,65,128,
  17,107,34,6,36,128,128,128,128,0,2,64,2,64,32,1,65,0,74,13,0,32,0,32,2,32,3,32,4,65,0,40,2,220,239,129,128,0,16,154,128,128,128,0,33,7,12,1,11,2,64,32,4,65,1,113,13,0,32,4,65,2,72,13,
  0,32,1,65,1,71,13,0,65,0,40,2,228,239,129,128,0,69,13,0,32,5,65,128,224,1,113,65,128,192,1,70,13,0,32,3,32,2,107,65,1,74,13,0,32,5,69,13,0,32,5,65,128,128,254,0,113,13,0,32,0,65,12,65,
  16,32,0,40,2,0,34,8,65,0,74,27,106,40,2,0,65,0,32,8,107,16,134,128,128,128,0,13,0,32,5,16,155,128,128,128,0,40,2,8,69,13,0,32,0,32,2,32,3,32,4,65,0,40,2,220,239,129,128,0,16,154,128,128,
  128,0,33,7,65,0,45,0,224,239,129,128,0,13,1,32,7,32,3,78,13,1,11,65,0,65,0,40,2,208,239,129,128,0,34,9,65,1,106,54,2,208,239,129,128,0,32,0,16,156,128,128,128,0,33,10,32,0,40,2,20,34,11,65,
  247,148,1,108,65,0,40,2,248,239,129,128,0,34,12,65,175,214,1,108,115,32,4,65,189,220,0,108,34,13,115,32,10,65,177,243,1,108,34,14,115,33,5,65,0,40,2,236,239,129,128,0,33,15,65,128,128,2,33,8,2,64,2,64,
  3,64,32,5,65,255,255,1,113,34,16,65,36,108,34,5,65,208,241,252,128,0,106,34,17,40,2,0,32,15,71,13,1,2,64,32,5,65,212,241,252,128,0,106,40,2,0,32,10,71,13,0,32,5,65,216,241,252,128,0,106,40,2,0,
  32,11,71,13,0,32,5,65,220,241,252,128,0,106,40,2,0,32,4,71,13,0,32,5,65,224,241,252,128,0,106,40,2,0,32,12,70,13,3,11,32,16,65,1,106,33,5,32,8,65,127,106,34,8,13,0,11,11,65,0,33,17,11,32,
  9,65,0,40,2,216,239,129,128,0,72,65,0,40,2,144,241,141,128,0,65,3,72,114,33,15,2,64,32,17,69,13,0,32,15,69,13,0,32,17,40,2,20,32,1,72,13,0,2,64,2,64,2,64,32,17,40,2,32,65,1,106,14,3,
  2,0,1,3,11,32,17,40,2,24,33,7,12,3,11,32,17,40,2,24,34,7,32,3,72,13,1,12,2,11,32,17,40,2,24,34,7,32,2,76,13,1,11,32,0,65,12,65,16,32,0,40,2,0,34,5,65,0,74,27,106,40,2,0,
  65,0,32,5,107,16,134,128,128,128,0,33,18,2,64,32,0,65,0,16,148,128,128,128,0,34,11,13,0,32,4,65,128,166,187,118,106,65,0,32,18,27,33,7,12,1,11,65,0,33,7,32,0,40,2,20,34,5,65,227,0,74,13,0,
  2,64,32,10,69,13,0,32,5,65,8,72,13,0,32,10,65,2,116,34,5,65,128,240,129,128,0,106,40,2,0,32,5,65,192,241,248,128,0,106,40,2,0,106,65,1,74,13,1,11,2,64,32,0,40,2,24,13,0,65,0,33,12,65,
  0,33,5,65,0,33,9,65,127,33,7,65,0,33,19,3,64,2,64,2,64,2,64,32,5,65,240,137,128,128,0,106,44,0,0,34,8,65,31,117,34,16,65,127,115,32,8,32,16,115,106,14,5,4,0,1,4,4,2,11,32,19,65,1,
  106,33,19,32,12,65,1,106,33,12,12,1,11,32,9,32,9,65,1,32,7,32,5,32,5,65,3,118,106,65,1,113,34,8,70,27,32,7,65,127,70,27,33,9,32,12,65,1,106,33,12,32,8,33,7,11,32,5,65,1,106,34,5,65,
  192,0,71,13,0,11,65,0,33,7,32,12,65,2,72,13,1,32,19,32,9,114,69,13,1,11,2,64,32,15,13,0,65,0,65,1,58,0,224,239,129,128,0,32,0,16,150,128,128,128,0,33,7,12,1,11,2,64,32,11,65,1,72,13,
  0,32,6,65,128,1,106,65,208,166,128,128,0,32,11,65,2,116,252,10,0,0,11,2,64,2,64,32,17,13,0,65,0,33,5,12,1,11,32,17,40,2,28,33,5,11,32,6,65,128,1,106,32,11,32,4,32,5,16,157,128,128,128,0,
  33,17,2,64,32,10,69,13,0,65,0,65,0,40,2,252,239,129,128,0,34,5,65,1,106,54,2,252,239,129,128,0,32,5,65,2,116,65,208,241,200,129,0,106,65,0,40,2,248,239,129,128,0,34,15,54,2,0,32,10,65,2,116,65,
  128,240,129,128,0,106,34,5,32,5,40,2,0,65,1,106,54,2,0,32,15,65,177,243,1,108,32,10,65,247,148,1,108,115,33,5,65,0,40,2,236,239,129,128,0,33,12,65,128,128,2,33,16,2,64,3,64,2,64,32,5,65,255,255,
  1,113,34,8,65,4,116,34,5,65,208,243,200,129,0,106,34,9,40,2,0,32,12,70,13,0,32,9,32,12,54,2,0,32,8,65,4,116,34,5,65,216,243,200,129,0,106,32,10,54,2,0,32,5,65,212,243,200,129,0,106,32,15,54,
  2,0,65,0,65,0,40,2,244,239,129,128,0,65,1,106,34,15,54,2,244,239,129,128,0,32,5,65,220,243,200,129,0,106,32,15,54,2,0,12,2,11,2,64,32,5,65,212,243,200,129,0,106,40,2,0,32,15,71,13,0,32,5,65,
  216,243,200,129,0,106,40,2,0,32,10,71,13,0,32,8,65,4,116,65,220,243,200,129,0,106,40,2,0,33,15,12,2,11,32,8,65,1,106,33,5,32,16,65,127,106,34,16,13,0,11,11,65,0,32,15,54,2,248,239,129,128,0,11,
  2,64,2,64,32,11,65,1,78,13,0,65,128,166,187,118,33,7,65,0,33,20,12,1,11,32,17,65,120,106,33,21,32,11,65,3,106,33,22,32,17,65,4,106,33,23,32,11,65,126,106,33,24,65,0,32,3,107,33,25,32,4,65,1,
  106,33,26,32,1,65,127,106,33,27,32,6,65,128,1,106,65,120,106,33,28,65,128,166,187,118,33,7,32,2,33,19,65,0,33,20,65,0,33,15,3,64,2,64,32,15,65,1,106,34,29,32,11,78,13,0,32,29,33,8,32,15,33,5,
  2,64,32,11,32,15,65,127,115,106,65,3,113,69,13,0,32,22,65,3,113,33,12,65,0,33,8,32,23,33,16,32,15,33,5,3,64,32,8,65,1,106,34,8,32,15,106,34,9,32,5,32,16,40,2,0,32,17,32,5,65,2,116,106,
  40,2,0,74,27,33,5,32,16,65,4,106,33,16,32,12,32,8,71,13,0,11,32,9,65,1,106,33,8,11,2,64,32,24,32,15,107,65,3,73,13,0,32,17,32,8,65,2,116,106,33,16,3,64,32,8,65,3,106,32,8,65,2,106,
  32,8,65,1,106,32,8,32,5,32,16,40,2,0,32,17,32,5,65,2,116,106,40,2,0,74,27,34,5,32,16,65,4,106,40,2,0,32,17,32,5,65,2,116,106,40,2,0,74,27,34,5,32,16,65,8,106,40,2,0,32,17,32,5,
  65,2,116,106,40,2,0,74,27,34,5,32,16,65,12,106,40,2,0,32,17,32,5,65,2,116,106,40,2,0,74,27,33,5,32,16,65,16,106,33,16,32,8,65,4,106,34,8,32,11,71,13,0,11,11,32,5,32,15,70,13,0,32,17,
  32,5,65,2,116,34,8,106,34,30,40,2,0,33,12,32,6,65,128,1,106,32,8,106,34,8,40,2,0,33,9,2,64,32,5,32,15,76,13,0,32,5,33,16,2,64,32,5,32,15,107,65,1,113,69,13,0,32,8,32,6,65,128,1,
  106,32,5,65,127,106,34,16,65,2,116,34,31,106,40,2,0,54,2,0,32,30,32,17,32,31,106,40,2,0,54,2,0,11,32,5,32,29,70,13,0,32,28,32,16,65,2,116,34,8,106,33,5,32,21,32,8,106,33,8,3,64,32,5,
  65,4,106,32,5,41,2,0,55,2,0,32,8,65,4,106,32,8,41,2,0,55,2,0,32,5,65,120,106,33,5,32,8,65,120,106,33,8,32,16,65,126,106,34,16,32,15,74,13,0,11,11,32,17,32,15,65,2,116,34,5,106,32,12,
  54,2,0,32,6,65,128,1,106,32,5,106,32,9,54,2,0,11,32,0,32,6,65,16,106,32,6,65,128,1,106,32,15,65,2,116,106,40,2,0,34,5,32,6,65,14,106,16,149,128,128,128,0,32,5,65,128,128,254,0,113,33,12,2,
  64,2,64,2,64,32,15,13,0,65,0,32,19,107,33,16,12,1,11,65,0,32,6,65,16,106,32,27,32,1,65,2,74,32,15,65,3,75,113,32,18,32,6,65,16,106,65,12,65,16,32,6,40,2,16,34,8,65,0,74,27,106,40,2,
  0,65,0,32,8,107,16,134,128,128,128,0,114,32,12,114,69,113,34,15,107,32,19,65,127,115,65,0,32,19,107,34,16,32,26,32,5,16,152,128,128,128,0,107,33,8,65,0,45,0,224,239,129,128,0,13,1,32,19,32,8,78,13,1,
  32,15,32,8,32,3,72,114,69,13,1,11,65,0,32,6,65,16,106,32,27,32,25,32,16,32,26,32,5,16,152,128,128,128,0,107,33,8,11,32,0,40,2,0,32,5,32,6,65,14,106,16,151,128,128,128,0,65,0,45,0,224,239,129,
  128,0,13,1,32,5,65,6,118,65,128,224,1,113,32,5,65,255,31,113,114,32,20,32,8,32,7,74,34,5,27,33,20,32,8,32,7,32,5,27,33,7,2,64,32,8,32,19,32,8,32,19,74,27,34,19,32,3,72,13,0,32,4,65,
  31,74,13,2,32,12,13,2,32,4,65,2,116,65,144,240,141,128,0,106,32,20,54,2,0,32,20,65,2,116,65,144,240,133,128,0,106,34,5,32,5,40,2,0,32,1,32,1,108,106,54,2,0,12,2,11,32,22,65,3,106,33,22,32,
  23,65,4,106,33,23,32,29,33,15,32,29,32,11,71,13,0,11,11,2,64,32,10,69,13,0,65,0,65,0,40,2,252,239,129,128,0,65,127,106,34,5,54,2,252,239,129,128,0,32,10,65,2,116,65,128,240,129,128,0,106,34,8,32,
  8,40,2,0,65,127,106,54,2,0,65,0,32,5,65,2,116,65,208,241,200,129,0,106,40,2,0,54,2,248,239,129,128,0,11,65,0,45,0,224,239,129,128,0,13,0,32,0,40,2,20,34,0,65,247,148,1,108,65,0,40,2,248,239,
  129,128,0,34,11,65,175,214,1,108,115,32,13,115,32,14,115,33,5,65,0,40,2,236,239,129,128,0,33,17,65,128,128,2,33,16,2,64,3,64,2,64,32,5,65,255,255,1,113,34,8,65,36,108,34,5,65,208,241,252,128,0,106,34,
  15,40,2,0,32,17,70,13,0,32,15,32,17,54,2,0,32,8,65,36,108,34,5,65,224,241,252,128,0,106,32,11,54,2,0,32,5,65,220,241,252,128,0,106,32,4,54,2,0,32,5,65,216,241,252,128,0,106,32,0,54,2,0,32,
  5,65,212,241,252,128,0,106,32,10,54,2,0,12,2,11,2,64,32,5,65,212,241,252,128,0,106,40,2,0,32,10,71,13,0,32,5,65,216,241,252,128,0,106,40,2,0,32,0,71,13,0,32,5,65,220,241,252,128,0,106,40,2,0,
  32,4,71,13,0,32,5,65,224,241,252,128,0,106,40,2,0,32,11,70,13,2,11,32,8,65,1,106,33,5,32,16,65,127,106,34,16,13,0,12,2,11,11,32,8,65,36,108,34,5,65,240,241,252,128,0,106,32,7,32,3,78,65,127,
  32,7,32,2,74,27,54,2,0,32,5,65,236,241,252,128,0,106,32,20,54,2,0,32,5,65,232,241,252,128,0,106,32,7,54,2,0,32,5,65,228,241,252,128,0,106,32,1,54,2,0,11,32,6,65,128,17,106,36,128,128,128,128,0,
  32,7,11,218,2,2,2,127,1,126,2,64,32,1,65,240,137,128,128,0,106,44,0,0,34,3,69,13,0,32,0,32,3,65,235,148,175,175,120,108,65,237,145,202,203,122,106,32,1,65,185,243,221,241,121,108,65,185,243,221,241,121,106,115,
  34,4,65,16,118,32,4,115,65,173,234,172,255,7,108,34,4,65,15,118,32,4,115,65,139,205,178,163,120,108,34,4,65,16,118,32,0,40,2,28,115,32,4,115,54,2,28,32,0,32,1,32,3,65,127,16,147,128,128,128,0,11,2,64,
  2,64,32,2,13,0,32,1,65,4,117,65,3,116,65,160,241,141,128,0,106,34,0,32,0,41,3,0,66,15,32,1,65,2,116,65,60,113,173,34,5,134,66,127,133,131,66,6,32,5,134,132,55,3,0,12,1,11,32,0,32,2,65,235,
  148,175,175,120,108,65,237,145,202,203,122,106,32,1,65,185,243,221,241,121,108,65,185,243,221,241,121,106,115,34,3,65,16,118,32,3,115,65,173,234,172,255,7,108,34,3,65,15,118,32,3,115,65,139,205,178,163,120,108,34,3,65,16,118,
  32,0,40,2,28,115,32,3,115,54,2,28,32,0,32,1,32,2,65,1,16,147,128,128,128,0,32,1,65,4,117,65,3,116,65,160,241,141,128,0,106,34,0,32,0,41,3,0,66,15,32,1,65,2,116,65,60,113,173,34,5,134,66,127,
  133,131,32,2,65,6,106,172,32,5,134,132,55,3,0,11,32,1,65,240,137,128,128,0,106,32,2,58,0,0,11,217,14,1,21,127,35,128,128,128,128,0,65,128,17,107,34,5,36,128,128,128,128,0,65,0,33,6,65,0,65,0,40,2,
  208,239,129,128,0,65,1,106,54,2,208,239,129,128,0,32,0,65,12,65,16,32,0,40,2,0,34,7,65,0,74,27,106,40,2,0,65,0,32,7,107,16,134,128,128,128,0,33,8,65,0,33,9,2,64,32,0,40,2,20,69,13,0,32,
  0,16,156,128,128,128,0,33,9,11,2,64,2,64,2,64,2,64,32,8,69,13,0,32,0,65,0,16,148,128,128,128,0,34,6,69,13,1,32,6,65,1,72,13,0,32,5,65,128,1,106,65,208,166,128,128,0,32,6,65,2,116,252,10,
  0,0,11,65,0,33,10,32,0,40,2,20,34,7,65,227,0,74,13,2,2,64,32,9,69,13,0,32,7,65,8,72,13,0,32,9,65,2,116,34,7,65,128,240,129,128,0,106,40,2,0,32,7,65,192,241,248,128,0,106,40,2,0,106,
  65,1,74,13,3,11,2,64,32,0,40,2,24,13,0,65,0,33,11,65,0,33,7,65,0,33,12,65,127,33,13,65,0,33,14,3,64,2,64,2,64,2,64,32,7,65,240,137,128,128,0,106,44,0,0,34,15,65,31,117,34,16,65,127,
  115,32,15,32,16,115,106,14,5,4,0,1,4,4,2,11,32,14,65,1,106,33,14,32,11,65,1,106,33,11,12,1,11,32,12,32,12,65,1,32,13,32,7,32,7,65,3,118,106,65,1,113,34,15,70,27,32,13,65,127,70,27,33,12,
  32,11,65,1,106,33,11,32,15,33,13,11,32,7,65,1,106,34,7,65,192,0,71,13,0,11,65,0,33,10,32,11,65,2,72,13,3,32,14,32,12,114,69,13,3,11,2,64,65,0,40,2,208,239,129,128,0,65,0,40,2,216,239,129,
  128,0,76,13,0,65,0,40,2,144,241,141,128,0,65,3,72,13,0,2,64,32,8,13,0,32,0,65,2,16,148,128,128,128,0,13,0,65,0,33,10,12,4,11,65,0,65,1,58,0,224,239,129,128,0,32,0,16,150,128,128,128,0,33,
  10,12,3,11,2,64,2,64,32,8,13,0,32,0,16,150,128,128,128,0,33,10,2,64,32,3,65,20,76,13,0,32,0,65,2,16,148,128,128,128,0,13,4,65,0,33,10,12,5,11,2,64,2,64,32,4,65,1,72,13,0,32,10,32,
  2,72,13,1,11,32,10,65,0,32,0,65,2,16,148,128,128,128,0,27,33,10,12,5,11,2,64,32,0,65,1,16,148,128,128,128,0,34,6,69,13,0,32,10,32,1,32,10,32,1,74,27,33,1,32,6,65,1,72,13,2,32,5,65,
  128,1,106,65,208,166,128,128,0,32,6,65,2,116,252,10,0,0,12,2,11,32,10,65,0,32,0,65,2,16,148,128,128,128,0,27,33,10,12,4,11,65,128,166,187,118,33,10,32,3,65,20,74,13,2,11,32,5,65,128,1,106,32,6,
  32,3,65,0,16,157,128,128,128,0,33,11,2,64,32,9,69,13,0,65,0,65,0,40,2,252,239,129,128,0,34,7,65,1,106,54,2,252,239,129,128,0,32,7,65,2,116,65,208,241,200,129,0,106,65,0,40,2,248,239,129,128,0,34,
  12,54,2,0,32,9,65,2,116,65,128,240,129,128,0,106,34,7,32,7,40,2,0,65,1,106,54,2,0,32,12,65,177,243,1,108,32,9,65,247,148,1,108,115,33,7,65,0,40,2,236,239,129,128,0,33,13,65,128,128,2,33,16,2,
  64,3,64,2,64,32,7,65,255,255,1,113,34,15,65,4,116,34,7,65,208,243,200,129,0,106,34,14,40,2,0,32,13,70,13,0,32,14,32,13,54,2,0,32,15,65,4,116,34,7,65,216,243,200,129,0,106,32,9,54,2,0,32,7,
  65,212,243,200,129,0,106,32,12,54,2,0,65,0,65,0,40,2,244,239,129,128,0,65,1,106,34,12,54,2,244,239,129,128,0,32,7,65,220,243,200,129,0,106,32,12,54,2,0,12,2,11,2,64,32,7,65,212,243,200,129,0,106,40,
  2,0,32,12,71,13,0,32,7,65,216,243,200,129,0,106,40,2,0,32,9,71,13,0,32,15,65,4,116,65,220,243,200,129,0,106,40,2,0,33,12,12,2,11,32,15,65,1,106,33,7,32,16,65,127,106,34,16,13,0,11,11,65,0,
  32,12,54,2,248,239,129,128,0,11,2,64,32,6,65,1,72,13,0,32,11,65,120,106,33,17,32,6,65,3,106,33,18,32,11,65,4,106,33,19,32,6,65,126,106,33,20,32,4,65,127,106,33,4,32,3,65,1,106,33,21,65,0,32,
  2,107,33,22,32,5,65,128,1,106,65,120,106,33,23,65,0,33,12,3,64,2,64,32,12,65,1,106,34,14,32,6,78,13,0,32,14,33,15,32,12,33,7,2,64,32,6,32,12,65,127,115,106,65,3,113,69,13,0,32,18,65,3,113,
  33,13,65,0,33,15,32,19,33,16,32,12,33,7,3,64,32,15,65,1,106,34,15,32,12,106,34,3,32,7,32,16,40,2,0,32,11,32,7,65,2,116,106,40,2,0,74,27,33,7,32,16,65,4,106,33,16,32,13,32,15,71,13,0,
  11,32,3,65,1,106,33,15,11,2,64,32,20,32,12,107,65,3,73,13,0,32,11,32,15,65,2,116,106,33,16,3,64,32,15,65,3,106,32,15,65,2,106,32,15,65,1,106,32,15,32,7,32,16,40,2,0,32,11,32,7,65,2,116,
  106,40,2,0,74,27,34,7,32,16,65,4,106,40,2,0,32,11,32,7,65,2,116,106,40,2,0,74,27,34,7,32,16,65,8,106,40,2,0,32,11,32,7,65,2,116,106,40,2,0,74,27,34,7,32,16,65,12,106,40,2,0,32,11,
  32,7,65,2,116,106,40,2,0,74,27,33,7,32,16,65,16,106,33,16,32,15,65,4,106,34,15,32,6,71,13,0,11,11,32,7,32,12,70,13,0,32,11,32,7,65,2,116,34,15,106,34,24,40,2,0,33,13,32,5,65,128,1,106,
  32,15,106,34,15,40,2,0,33,3,2,64,32,7,32,12,76,13,0,32,7,33,16,2,64,32,7,32,12,107,65,1,113,69,13,0,32,15,32,5,65,128,1,106,32,7,65,127,106,34,16,65,2,116,34,25,106,40,2,0,54,2,0,32,
  24,32,11,32,25,106,40,2,0,54,2,0,11,32,7,32,14,70,13,0,32,23,32,16,65,2,116,34,15,106,33,7,32,17,32,15,106,33,15,3,64,32,7,65,4,106,32,7,41,2,0,55,2,0,32,15,65,4,106,32,15,41,2,0,
  55,2,0,32,7,65,120,106,33,7,32,15,65,120,106,33,15,32,16,65,126,106,34,16,32,12,74,13,0,11,11,32,11,32,12,65,2,116,34,7,106,32,13,54,2,0,32,5,65,128,1,106,32,7,106,32,3,54,2,0,11,2,64,2,
  64,32,8,32,5,65,128,1,106,32,12,65,2,116,106,40,2,0,34,7,65,128,128,240,0,113,114,13,0,32,10,32,7,65,13,118,65,28,113,65,176,138,128,128,0,106,40,2,0,106,65,160,1,106,32,1,72,13,1,11,32,0,32,5,
  65,16,106,32,7,32,5,65,14,106,16,149,128,128,128,0,32,5,65,16,106,32,22,65,0,32,1,107,32,21,32,4,16,154,128,128,128,0,33,15,32,0,40,2,0,32,7,32,5,65,14,106,16,151,128,128,128,0,65,0,45,0,224,239,
  129,128,0,13,2,32,10,65,0,32,15,107,34,7,32,10,32,7,74,27,33,10,32,1,32,7,32,1,32,7,74,27,34,1,32,2,78,13,2,11,32,18,65,3,106,33,18,32,19,65,4,106,33,19,32,14,33,12,32,14,32,6,71,13,
  0,11,11,32,9,69,13,2,65,0,65,0,40,2,252,239,129,128,0,65,127,106,34,7,54,2,252,239,129,128,0,32,9,65,2,116,65,128,240,129,128,0,106,34,15,32,15,40,2,0,65,127,106,54,2,0,65,0,32,7,65,2,116,65,
  208,241,200,129,0,106,40,2,0,54,2,248,239,129,128,0,12,2,11,32,3,65,128,166,187,118,106,33,10,12,1,11,32,0,16,150,128,128,128,0,33,10,11,32,5,65,128,17,106,36,128,128,128,128,0,32,10,11,128,13,5,2,127,1,
  123,12,127,1,124,2,123,2,64,32,0,65,128,128,128,12,113,34,1,65,0,71,65,15,116,32,0,65,12,118,65,7,113,34,2,65,12,116,32,0,65,6,118,253,17,32,0,253,28,1,253,12,63,0,0,0,63,0,0,0,63,0,0,0,
  63,0,0,0,253,78,34,3,253,27,0,65,6,116,114,65,128,96,106,114,32,3,253,27,1,114,34,4,65,12,108,65,192,241,144,128,0,106,34,5,40,2,0,65,0,40,2,236,239,129,128,0,34,6,70,13,0,65,7,32,3,253,12,56,
  0,0,0,56,0,0,0,56,0,0,0,56,0,0,0,253,81,32,3,65,0,40,2,232,239,129,128,0,65,0,72,253,17,65,31,253,171,1,65,31,253,172,1,253,82,34,3,253,27,0,34,7,65,7,113,34,8,65,1,116,65,121,106,34,
  9,32,9,65,31,117,34,9,115,32,9,107,34,10,32,7,65,3,118,34,9,65,1,116,34,11,65,121,106,34,12,32,12,65,31,117,34,12,115,32,12,107,34,13,106,34,14,107,33,15,32,2,65,127,106,34,12,65,3,116,65,224,214,128,
  128,0,106,43,3,0,33,16,2,64,2,64,2,64,2,64,2,64,2,64,2,64,32,12,14,5,0,1,2,3,4,5,11,32,3,253,27,1,34,12,65,7,113,34,15,65,1,116,65,121,106,34,13,65,31,117,34,11,32,13,32,11,115,107,
  65,3,108,65,14,65,0,32,15,65,126,106,65,4,73,27,65,0,32,12,65,23,75,27,32,12,65,3,118,34,12,65,7,108,106,106,65,21,106,33,15,65,14,65,0,32,8,65,126,106,65,4,73,27,65,0,32,7,65,23,75,27,32,9,
  65,7,108,106,65,7,32,10,107,65,3,108,106,33,8,32,12,32,12,108,65,123,108,32,3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,
  249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,106,65,121,106,33,10,32,9,32,9,108,65,5,108,32,17,253,27,0,107,65,7,106,33,13,12,5,11,32,15,65,7,108,65,113,65,0,32,7,65,8,73,27,106,33,8,65,7,32,
  3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,32,3,253,27,1,34,15,65,3,
  118,34,12,65,1,116,65,121,106,34,10,32,10,65,31,117,34,10,115,32,10,107,106,107,34,11,65,123,108,33,10,32,11,65,7,108,65,113,65,0,32,15,65,8,73,27,106,33,15,65,7,32,13,32,17,253,27,0,106,107,65,5,108,33,
  13,12,4,11,32,15,65,2,116,32,9,65,3,108,106,33,8,65,7,32,3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,
  253,174,1,253,160,1,34,17,253,27,1,32,3,253,27,1,65,3,118,34,12,65,1,116,65,121,106,34,15,32,15,65,31,117,34,15,115,32,15,107,106,34,15,107,65,125,108,33,10,32,12,65,3,108,32,15,65,2,116,107,65,28,106,33,
  15,65,7,32,13,32,17,253,27,0,106,107,65,3,108,33,13,12,3,11,65,30,32,3,253,27,1,65,3,118,34,12,65,1,116,34,8,32,12,65,6,70,27,33,15,32,8,65,121,106,34,8,32,8,65,31,117,34,8,115,32,8,107,32,
  3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,106,65,1,116,65,114,106,33,10,
  65,30,32,11,32,9,65,6,70,27,33,8,65,14,32,17,253,27,0,32,13,106,65,1,116,107,33,13,12,2,11,32,15,65,1,116,65,120,65,0,32,7,65,23,75,27,106,33,8,65,7,32,3,65,1,253,171,1,253,12,14,0,0,0,
  14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,32,3,253,27,1,34,15,65,3,118,34,12,65,1,116,65,121,106,34,10,32,
  10,65,31,117,34,10,115,32,10,107,106,34,11,107,65,125,108,33,10,65,6,65,14,32,15,65,23,75,27,32,11,65,1,116,107,33,15,65,7,32,13,32,17,253,27,0,106,107,65,3,108,33,13,12,1,11,32,3,253,27,1,65,3,118,
  34,12,65,116,108,65,45,65,0,32,3,253,12,59,0,0,0,59,0,0,0,59,0,0,0,59,0,0,0,253,78,253,12,2,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,253,55,34,18,253,199,1,253,27,2,65,1,113,27,106,
  32,3,65,1,253,171,1,253,12,14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0,253,78,253,12,249,255,255,255,249,255,255,255,249,255,255,255,249,255,255,255,253,174,1,253,160,1,34,17,253,27,1,32,12,65,1,116,65,121,106,
  34,15,32,15,65,31,117,34,15,115,32,15,107,106,34,10,65,5,108,106,65,93,106,33,15,32,9,65,116,108,65,45,65,0,32,18,253,27,0,65,1,113,27,106,32,14,65,5,108,106,65,93,106,33,8,32,10,65,3,116,65,72,106,33,
  10,65,56,32,17,253,27,0,32,13,106,65,3,116,107,33,13,11,32,5,32,6,54,2,0,32,4,65,12,108,34,4,65,200,241,144,128,0,106,65,0,43,3,192,215,128,128,0,68,0,0,0,0,0,0,0,128,32,7,65,31,75,27,68,
  0,0,0,0,0,0,0,128,32,2,65,1,70,27,32,17,253,27,1,32,17,253,27,0,107,183,68,0,0,0,0,0,0,192,63,162,65,0,43,3,184,215,128,128,0,162,65,0,43,3,176,215,128,128,0,68,0,0,0,0,0,0,0,128,
  32,3,253,27,1,65,8,73,27,68,0,0,0,0,0,0,0,128,32,0,65,128,192,1,113,65,128,192,0,70,27,65,0,43,3,168,215,128,128,0,68,0,0,0,0,0,0,0,128,32,1,27,32,9,32,12,107,34,0,65,3,32,0,65,
  3,72,27,34,0,65,125,32,0,65,125,74,27,183,68,0,0,0,0,0,0,8,64,163,65,0,43,3,160,215,128,128,0,162,32,10,32,13,106,183,68,0,0,0,0,0,0,89,64,163,65,0,43,3,152,215,128,128,0,162,32,8,32,15,
  107,183,68,0,0,0,0,0,0,89,64,163,65,0,43,3,144,215,128,128,0,162,32,16,160,160,160,160,160,160,160,34,16,68,0,0,0,0,0,0,0,0,99,54,2,0,2,64,2,64,32,16,68,0,0,0,0,0,192,114,64,162,68,0,
  0,0,0,0,0,224,63,160,156,34,16,153,68,0,0,0,0,0,0,224,65,99,69,13,0,32,16,170,33,0,12,1,11,65,128,128,128,128,120,33,0,11,32,4,65,196,241,144,128,0,106,32,0,54,2,0,11,32,5,11,231,7,2,4,
  126,8,127,65,0,41,3,184,241,141,128,0,33,1,65,0,41,3,176,241,141,128,0,33,2,65,0,41,3,168,241,141,128,0,33,3,65,0,41,3,160,241,141,128,0,33,4,65,0,40,2,236,239,129,128,0,33,5,65,128,128,1,33,6,
  32,0,65,28,106,40,2,0,34,7,33,8,3,64,2,64,32,8,65,255,255,0,113,34,9,65,56,108,34,8,65,192,241,192,128,0,106,34,10,40,2,0,32,5,70,13,0,32,10,32,5,54,2,0,32,9,65,56,108,34,8,65,196,241,
  192,128,0,106,32,7,54,2,0,32,8,65,200,241,192,128,0,106,32,0,40,2,0,34,6,54,2,0,32,8,65,204,241,192,128,0,106,32,0,40,2,4,34,7,54,2,0,32,8,65,208,241,192,128,0,106,32,0,40,2,8,34,11,54,
  2,0,65,0,33,12,32,8,65,240,241,192,128,0,106,65,0,41,3,184,241,141,128,0,55,3,0,32,8,65,232,241,192,128,0,106,65,0,41,3,176,241,141,128,0,55,3,0,32,8,65,224,241,192,128,0,106,65,0,41,3,168,241,141,
  128,0,55,3,0,32,8,65,216,241,192,128,0,106,65,0,41,3,160,241,141,128,0,55,3,0,65,0,65,0,40,2,240,239,129,128,0,65,1,106,34,10,54,2,240,239,129,128,0,32,8,65,212,241,192,128,0,106,32,10,54,2,0,2,
  64,32,0,40,2,20,65,8,72,13,0,65,128,8,33,9,32,4,167,34,8,65,255,255,3,113,65,197,187,242,136,120,115,65,147,131,128,8,108,32,8,65,16,118,115,65,147,131,128,8,108,32,4,66,32,136,167,65,255,255,3,113,115,65,
  147,131,128,8,108,32,4,66,48,136,167,115,65,147,131,128,8,108,32,3,167,34,8,65,255,255,3,113,115,65,147,131,128,8,108,32,8,65,16,118,115,65,147,131,128,8,108,32,3,66,32,136,167,65,255,255,3,113,115,65,147,131,128,8,
  108,32,3,66,48,136,167,115,65,147,131,128,8,108,32,2,167,34,8,65,255,255,3,113,115,65,147,131,128,8,108,32,8,65,16,118,115,65,147,131,128,8,108,32,2,66,32,136,167,65,255,255,3,113,115,65,147,131,128,8,108,32,2,66,
  48,136,167,115,65,147,131,128,8,108,32,1,167,34,8,65,255,255,3,113,115,65,147,131,128,8,108,32,8,65,16,118,115,65,147,131,128,8,108,32,1,66,32,136,167,65,255,255,3,113,115,65,147,131,128,8,108,32,1,66,48,136,167,115,
  65,147,131,128,8,108,32,11,65,5,116,65,32,106,32,7,65,1,116,32,6,65,1,70,114,114,65,255,255,3,113,34,7,115,65,147,131,128,8,108,34,0,33,8,3,64,32,8,65,255,7,113,34,6,65,48,108,34,8,65,192,241,141,128,
  0,106,40,2,0,32,5,71,13,1,2,64,32,8,65,196,241,141,128,0,106,40,2,0,32,0,71,13,0,32,8,65,204,241,141,128,0,106,47,1,0,32,7,71,13,0,32,8,65,208,241,141,128,0,106,41,3,0,32,4,82,13,0,32,
  8,65,216,241,141,128,0,106,41,3,0,32,3,82,13,0,32,8,65,224,241,141,128,0,106,41,3,0,32,2,82,13,0,32,8,65,232,241,141,128,0,106,41,3,0,32,1,82,13,0,32,6,65,48,108,65,200,241,141,128,0,106,40,2,
  0,33,12,12,2,11,32,6,65,1,106,33,8,32,9,65,127,106,34,9,13,0,11,11,32,10,65,2,116,65,192,241,248,128,0,106,32,12,54,2,0,32,10,15,11,2,64,32,8,65,196,241,192,128,0,106,40,2,0,32,7,71,13,0,
  32,8,65,200,241,192,128,0,106,40,2,0,32,0,40,2,0,71,13,0,32,8,65,204,241,192,128,0,106,40,2,0,32,0,40,2,4,71,13,0,32,8,65,208,241,192,128,0,106,40,2,0,32,0,40,2,8,71,13,0,32,8,65,216,
  241,192,128,0,106,41,3,0,32,4,82,13,0,32,8,65,224,241,192,128,0,106,41,3,0,32,3,82,13,0,32,8,65,232,241,192,128,0,106,41,3,0,32,2,82,13,0,32,8,65,240,241,192,128,0,106,41,3,0,32,1,82,13,0,
  32,9,65,56,108,65,212,241,192,128,0,106,40,2,0,15,11,32,9,65,1,106,33,8,32,6,65,127,106,34,6,13,0,11,65,0,11,183,7,1,5,127,32,2,65,31,32,2,65,31,72,27,65,11,116,65,208,241,196,129,0,106,33,4,
  2,64,32,1,65,1,72,13,0,32,2,65,2,116,65,144,240,141,128,0,106,33,5,2,64,2,64,2,64,32,2,65,1,113,69,13,0,65,0,40,2,228,239,129,128,0,13,1,11,32,2,65,32,72,13,1,32,4,33,2,3,64,65,128,
  173,226,4,33,6,2,64,32,0,40,2,0,34,7,65,6,118,65,128,224,1,113,32,7,65,255,31,113,114,34,8,32,3,70,13,0,2,64,32,7,65,18,118,65,7,113,34,6,69,13,0,32,6,65,2,116,65,176,138,128,128,0,106,40,
  2,0,65,192,154,12,106,33,6,12,1,11,2,64,32,7,65,15,118,65,7,113,34,6,69,13,0,32,6,65,2,116,65,176,138,128,128,0,106,40,2,0,65,4,116,32,7,65,12,118,65,7,113,65,2,116,65,176,138,128,128,0,106,40,
  2,0,107,65,160,141,6,106,33,6,12,1,11,32,8,65,2,116,65,144,240,133,128,0,106,40,2,0,33,6,11,32,2,32,6,54,2,0,32,0,65,4,106,33,0,32,2,65,4,106,33,2,32,1,65,127,106,34,1,13,0,12,3,11,
  11,2,64,32,2,65,32,72,13,0,32,4,33,2,3,64,65,128,173,226,4,33,6,2,64,32,0,40,2,0,34,7,65,6,118,65,128,224,1,113,32,7,65,255,31,113,114,34,8,32,3,70,13,0,2,64,32,7,65,18,118,65,7,113,
  34,6,69,13,0,32,6,65,2,116,65,176,138,128,128,0,106,40,2,0,65,192,154,12,106,33,6,12,1,11,2,64,32,7,65,15,118,65,7,113,34,6,69,13,0,32,6,65,2,116,65,176,138,128,128,0,106,40,2,0,65,4,116,32,
  7,65,12,118,65,7,113,65,2,116,65,176,138,128,128,0,106,40,2,0,107,65,160,141,6,106,33,6,12,1,11,32,8,65,2,116,65,144,240,133,128,0,106,40,2,0,32,7,16,155,128,128,128,0,40,2,4,106,33,6,11,32,2,32,
  6,54,2,0,32,0,65,4,106,33,0,32,2,65,4,106,33,2,32,1,65,127,106,34,1,13,0,12,3,11,11,32,4,33,2,3,64,65,128,173,226,4,33,6,2,64,32,0,40,2,0,34,7,65,6,118,65,128,224,1,113,32,7,65,
  255,31,113,114,34,8,32,3,70,13,0,2,64,32,7,65,18,118,65,7,113,34,6,69,13,0,32,6,65,2,116,65,176,138,128,128,0,106,40,2,0,65,192,154,12,106,33,6,12,1,11,2,64,32,7,65,15,118,65,7,113,34,6,69,
  13,0,32,6,65,2,116,65,176,138,128,128,0,106,40,2,0,65,4,116,32,7,65,12,118,65,7,113,65,2,116,65,176,138,128,128,0,106,40,2,0,107,65,160,141,6,106,33,6,12,1,11,65,144,191,5,33,6,32,5,40,2,0,32,
  8,70,13,0,32,8,65,2,116,65,144,240,133,128,0,106,40,2,0,32,7,16,155,128,128,128,0,40,2,4,106,33,6,11,32,2,32,6,54,2,0,32,0,65,4,106,33,0,32,2,65,4,106,33,2,32,1,65,127,106,34,1,13,0,
  12,2,11,11,32,4,33,2,3,64,65,128,173,226,4,33,6,2,64,32,0,40,2,0,34,7,65,6,118,65,128,224,1,113,32,7,65,255,31,113,114,34,8,32,3,70,13,0,2,64,32,7,65,18,118,65,7,113,34,6,69,13,0,32,
  6,65,2,116,65,176,138,128,128,0,106,40,2,0,65,192,154,12,106,33,6,12,1,11,2,64,32,7,65,15,118,65,7,113,34,6,69,13,0,32,6,65,2,116,65,176,138,128,128,0,106,40,2,0,65,4,116,32,7,65,12,118,65,7,
  113,65,2,116,65,176,138,128,128,0,106,40,2,0,107,65,160,141,6,106,33,6,12,1,11,65,144,191,5,33,6,32,5,40,2,0,32,8,70,13,0,32,8,65,2,116,65,144,240,133,128,0,106,40,2,0,33,6,11,32,2,32,6,54,
  2,0,32,0,65,4,106,33,0,32,2,65,4,106,33,2,32,1,65,127,106,34,1,13,0,11,11,32,4,11,11,248,1,1,0,65,128,8,11,240,1,1,0,0,0,2,0,0,0,2,0,0,0,1,0,0,0,255,255,255,255,254,255,255,
  255,254,255,255,255,255,255,255,255,2,0,0,0,1,0,0,0,255,255,255,255,254,255,255,255,254,255,255,255,255,255,255,255,1,0,0,0,2,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,255,255,255,255,255,255,255,255,1,0,0,
  0,255,255,255,255,255,255,255,255,1,0,0,0,0,0,0,0,255,255,255,255,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,255,255,255,255,99,0,0,0,99,0,0,0,99,0,0,0,99,0,0,0,99,0,0,0,99,0,0,
  0,99,0,0,0,99,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,17,0,0,0,35,0,0,0,65,0,0,0,110,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,0,0,0,32,0,0,0,65,0,0,0,120,0,0,
  0,210,0,0,0,0,0,0,0,110,0,0,0,98,0,0,0,114,0,0,0,113,0,0,0,0,242,3,4,110,97,109,101,0,13,12,104,101,108,112,101,114,115,46,119,97,115,109,1,187,3,30,0,9,98,111,97,114,100,95,112,116,114,1,
  10,99,111,110,102,105,103,95,112,116,114,2,9,109,111,118,101,115,95,112,116,114,3,8,101,118,97,108,117,97,116,101,4,10,112,97,119,110,95,115,99,111,114,101,5,8,105,110,95,99,104,101,99,107,6,8,97,116,116,97,99,107,101,100,
  7,8,103,101,110,101,114,97,116,101,8,9,112,97,119,110,95,101,109,105,116,9,4,101,109,105,116,10,10,115,99,111,114,101,115,95,112,116,114,11,9,101,120,97,99,116,95,112,116,114,12,10,112,111,108,105,99,121,95,112,116,114,13,15,
  112,117,98,108,105,99,95,107,101,121,115,95,112,116,114,14,17,112,117,98,108,105,99,95,99,111,117,110,116,115,95,112,116,114,15,12,115,101,97,114,99,104,95,110,111,100,101,115,16,12,115,101,97,114,99,104,95,100,101,112,116,104,17,20,
  115,101,97,114,99,104,95,101,118,97,108,117,97,116,101,95,102,97,115,116,18,10,115,101,97,114,99,104,95,97,108,108,19,17,115,101,97,114,99,104,95,101,118,97,108,95,112,105,101,99,101,20,15,115,101,97,114,99,104,95,103,101,110,101,
  114,97,116,101,21,18,115,101,97,114,99,104,95,97,112,112,108,121,95,99,104,105,108,100,22,21,115,101,97,114,99,104,95,101,118,97,108,117,97,116,101,95,115,116,97,116,101,23,17,115,101,97,114,99,104,95,117,110,100,111,95,98,111,97,
  114,100,24,9,115,101,97,114,99,104,95,97,98,25,22,115,101,97,114,99,104,95,104,97,115,104,95,115,101,116,95,115,113,117,97,114,101,26,8,115,101,97,114,99,104,95,113,27,19,112,111,108,105,99,121,95,100,105,114,101,99,116,95,101,
  110,116,114,121,28,18,115,101,97,114,99,104,95,112,111,115,105,116,105,111,110,95,105,100,29,20,115,101,97,114,99,104,95,112,114,101,112,97,114,101,95,111,114,100,101,114,7,18,1,0,15,95,95,115,116,97,99,107,95,112,111,105,110,116,
  101,114,9,10,1,0,7,46,114,111,100,97,116,97,0,56,9,112,114,111,100,117,99,101,114,115,1,12,112,114,111,99,101,115,115,101,100,45,98,121,1,12,85,98,117,110,116,117,32,99,108,97,110,103,17,49,56,46,49,46,51,32,40,49,
  117,98,117,110,116,117,49,41,0,66,15,116,97,114,103,101,116,95,102,101,97,116,117,114,101,115,4,43,11,98,117,108,107,45,109,101,109,111,114,121,43,15,109,117,116,97,98,108,101,45,103,108,111,98,97,108,115,43,8,115,105,103,110,45,
  101,120,116,43,7,115,105,109,100,49,50,56
]);
// END GENERATED V55 WASM

// The compiled kernel has no imports or opponent state. Every call copies only
// the current board; both variants use exactly the same helpers. JavaScript
// remains a behaviorally identical fallback when WebAssembly is unavailable.
let SF55C_KERNEL=null;
try {
 if(typeof WebAssembly!=='undefined'){
  const api=new WebAssembly.Instance(new WebAssembly.Module(SF55C_WASM_BYTES),{}).exports;
  SF55C_KERNEL={api,board:new Int8Array(api.memory.buffer,api.board_ptr(),64),
   config:new Int32Array(api.memory.buffer,api.config_ptr(),903),
   moves:new Uint32Array(api.memory.buffer,api.moves_ptr(),512),
   scores:api.scores_ptr?new Int32Array(api.memory.buffer,api.scores_ptr(),512):null,
   exact:api.exact_ptr?new Int32Array(api.memory.buffer,api.exact_ptr(),512):null,
   policyWeights:api.policy_ptr?new Float64Array(api.memory.buffer,api.policy_ptr(),13):null,
   publicKeys:api.public_keys_ptr?new Uint16Array(api.memory.buffer,api.public_keys_ptr(),512*17):null,
   publicCounts:api.public_counts_ptr?new Int32Array(api.memory.buffer,api.public_counts_ptr(),512):null};
 }
} catch (_) { /* Use the identical JS implementation if compilation is blocked. */ }
function sf55cSyncKernelConfig(){
 const kernel=SF55C_KERNEL;if(!kernel)return;
 kernel.config.set(SF55C.piece);
 for(let t=0;t<7;t++){kernel.config.set(SF55C_PST[t],7+t*64);kernel.config.set(SF55C_EG[t],455+t*64);}
}
sf55cSyncKernelConfig();
function sf55cSyncKernelBoard(g){
 const k=SF55C_KERNEL;if(!k)return null;
 if(!g._sf55cKernelSearchActive||g._sf55cKernelDirty){
  k.board.set(g.boardState);
  if(g._sf55cKernelSearchActive)g._sf55cKernelDirty=false;
 }
 return k;
}
function sf55cEvaluate(g){
 const k=sf55cSyncKernelBoard(g);if(!k)return sf55cEvaluateJS(g);
 return k.api.evaluate(g.side,g.kingSq[1],g.kingSq[-1]);
}
function sf55cInCheck(g){
 const k=sf55cSyncKernelBoard(g);if(!k)return g.in_check();
 return !!k.api.in_check(g.side,g.kingSq[g.side]);
}
function sf55cKernelMoves(g,mode,ctx=null,ply=0){
 const k=sf55cSyncKernelBoard(g);
 const count=k.api.generate(g.side,g.castling,g.ep,g.kingSq[g.side],mode);
 if(mode===2)return !!count;
 let moves;
 if(ctx){
  const buffers=ctx.moveBuffers||(ctx.moveBuffers=[]);
  moves=buffers[ply];
  if(!moves)moves=buffers[ply]=[];
  while(moves.length<count)moves.push({from:0,to:0,piece:0,captured:0,promotion:0,flags:0});
  moves.length=count;
 }else moves=new Array(count);
 for(let i=0;i<count;i++){
  const packed=k.moves[i];
  let move=moves[i];
  if(!move)move=moves[i]={from:0,to:0,piece:0,captured:0,promotion:0,flags:0};
  move.from=packed&63;move.to=(packed>>>6)&63;move.piece=(packed>>>12)&7;
  move.captured=(packed>>>15)&7;move.promotion=(packed>>>18)&7;move.flags=packed>>>21;
 }
 return moves;
}
function sf55cLegalMoves(g,ctx=null,ply=0){return SF55C_KERNEL?sf55cKernelMoves(g,0,ctx,ply):g.fastMoves();}
function sf55cTacticalMoves(g,ctx=null,ply=0){return SF55C_KERNEL?sf55cKernelMoves(g,1,ctx,ply):sf55cTacticalMovesJS(g);}
function sf55cHasLegalMove(g){return SF55C_KERNEL?sf55cKernelMoves(g,2):g.fastHasLegalMove();}
