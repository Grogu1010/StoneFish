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
    if((counts.get(key)||0)+(ctx.path.get(key)||0)+1>=3)return true;
  }
  return !(ctx.material>0)&&sf55cInsufficient(g);
}

function sf55cEnter(ctx,key) {
  if (key === null) return;
  if(ctx.pathSignature===undefined){ctx.pathSignature=0;ctx.pathSignatureStack=[];ctx.pathSignatureIds=new Map();}
  ctx.path.set(key,(ctx.path.get(key)||0)+1);
  let id=ctx.positionIds.get(key);
  if(id===undefined){id=ctx.positionIds.size+1;ctx.positionIds.set(key,id);}
  const parent=ctx.pathSignature,pair=parent*16384+id;
  let signature=ctx.pathSignatureIds.get(pair);
  if(signature===undefined){signature=ctx.pathSignatureIds.size+1;ctx.pathSignatureIds.set(pair,signature);}
  ctx.pathSignatureStack.push(parent);
  ctx.pathSignature=signature;
}
function sf55cExit(ctx,key) {
  if (key === null) return;
  const count=ctx.path.get(key)-1;
  if(count)ctx.path.set(key,count);else ctx.path.delete(key);
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
  let moves=check ? sf55cLegalMoves(g) : null;
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
    moves=sf55cTacticalMoves(g);
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
  const check=sf55cInCheck(g),moves=sf55cLegalMoves(g);
  if(!moves.length)return check?-SF55C.mate+ply:0;
  const key=sf55cPackedPositionKey(g);
  if(sf55cDraw(g,ctx,key))return 0;
  if(ctx.nodes>ctx.limit&&ctx.depth>2){ctx.abort=true;return sf55cEvaluate(g);}
  // Halfmove clock, mate distance, and the speculative repetition path are part
  // of the cache identity. A value from another history cannot hide a draw.
  const ttMeta=g.halfmove+(ply<<7)+(ctx.pathSignature<<13);
  const ttBucket=ctx.tt.get(key);
  const hit=ttBucket?ttBucket.get(ttMeta):null,original=alpha;
  if(hit&&hit.depth>=depth){if(hit.flag===0)return hit.score;if(hit.flag===1&&hit.score>=beta)return hit.score;if(hit.flag===-1&&hit.score<=alpha)return hit.score;}
  sf55cOrderMoves(moves,ctx,hit?hit.move:0,ply);
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
            typeof process!=='undefined'&&process.env&&process.env.ARMX_FAST_SCREEN==='1'
              &&process.env.ARMX_FAST_POLICY_LMR==='1'&&ctx.replyPolicy&&(ply&1)
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
    let bucket=ctx.tt.get(key);if(!bucket){bucket=new Map();ctx.tt.set(key,bucket);}
    bucket.set(ttMeta,{depth,score:best,move:bestMove,flag:best<=original?-1:best>=beta?1:0});
  }
  return best;
}

function sf55cHost(g,replyPolicy=null){
  sf55cSyncKernelConfig();
  const legal=sf55cLegalMoves(g);if(!legal.length)return {finished:[],fastLeader:null,refutationGuard:null};
  const requested=replyPolicy&&replyPolicy.searchBudget;
  const limit=Number.isFinite(requested)?Math.max(SF55C.nodes,Math.min(SF55C.nodes+8400,Math.round(requested))):SF55C.nodes;
  const requestedDepth=replyPolicy&&replyPolicy.maxDepth;
  const depthLimit=Number.isFinite(requestedDepth)?Math.max(SF55C.maxDepth,Math.min(SF55C.maxDepth+2,Math.round(requestedDepth))):SF55C.maxDepth;
  const ctx={nodes:0,limit,depth:0,abort:false,tt:new Map(),path:new Map(),pathSignature:0,pathSignatureStack:[],pathSignatureIds:new Map(),positionIds:new Map(),killers:[],history:new Int32Array(32768),orderPriorities:[],replyPolicy};
  ctx.material=0;for(const piece of g.boardState){const type=Math.abs(piece);if(type===1||type===4||type===5)ctx.material++;}
  let roots=legal.map(raw=>({raw,uci:stonefishV45RawUci(g,raw),score:0,deep:0,preliminary:0,tactical:0,knowledge:0,conversion:0}));
  for(const e of roots){sf55cApply(g,ctx,e.raw,1);try{e.score=-sf55cEvaluate(g);}finally{sf55cUndo(g,ctx,e.raw,1);}}
  roots.sort((a,b)=>b.score-a.score||a.uci.localeCompare(b.uci));
  let complete=roots;
  for(let depth=1;depth<=depthLimit;depth++){
    ctx.depth=depth;
    const next=[];let threshold=-SF55C.mate;
    for(const previous of complete){
      const e={...previous};const materialDelta=sf55cMaterialMoveDelta(e.raw);ctx.material-=materialDelta;g.fastApply(e.raw);
      try{e.score=-sf55cSearch(g,ctx,depth-1,-SF55C.mate,-threshold,1);}finally{sf55cUndo(g,ctx,m,ply+1);ctx.material+=materialDelta;}
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

// BEGIN GENERATED V55 WASM
// Zig 0.14.1; SHA-256 68762ea5fb817f62531210861ef7fbc87874b549ecfaf61b2a36b2aa494ed256
const SF55C_WASM_BYTES=new Uint8Array([
  0,97,115,109,1,0,0,0,1,47,6,96,0,1,127,96,3,127,127,127,1,127,96,9,127,127,127,127,127,127,127,127,127,0,96,2,127,127,1,127,96,5,127,127,127,127,127,1,127,96,4,127,127,127,127,1,127,3,11,10,0,0,0,1,
  2,3,3,4,1,5,5,3,1,0,17,6,9,1,127,1,65,128,128,192,0,11,7,80,7,6,109,101,109,111,114,121,2,0,9,98,111,97,114,100,95,112,116,114,0,0,10,99,111,110,102,105,103,95,112,116,114,0,1,9,109,111,118,101,
  115,95,112,116,114,0,2,8,101,118,97,108,117,97,116,101,0,3,8,105,110,95,99,104,101,99,107,0,5,8,103,101,110,101,114,97,116,101,0,7,10,198,53,10,8,0,65,192,129,192,128,0,11,8,0,65,128,130,192,128,0,11,8,0,
  65,160,158,192,128,0,11,183,9,2,16,127,1,124,35,128,128,128,128,0,65,208,4,107,34,3,36,128,128,128,128,0,32,3,65,176,4,106,65,24,106,66,0,55,3,0,32,3,65,176,4,106,65,16,106,66,0,55,3,0,32,3,66,0,
  55,3,184,4,32,3,66,0,55,3,176,4,32,3,65,144,4,106,65,24,106,66,0,55,3,0,32,3,65,144,4,106,65,16,106,66,0,55,3,0,32,3,66,0,55,3,152,4,32,3,66,0,55,3,144,4,65,0,33,4,65,0,33,5,
  65,0,33,6,65,0,33,7,65,0,33,8,65,0,33,9,65,0,33,10,65,0,33,11,3,64,2,64,32,11,65,192,129,192,128,0,106,44,0,0,34,12,69,13,0,65,1,33,13,32,12,32,12,192,65,7,117,34,14,115,32,14,107,34,
  15,65,255,1,113,34,14,65,8,116,32,11,32,11,65,56,115,32,12,65,0,74,34,16,27,65,2,116,114,34,17,65,156,144,192,128,0,106,40,2,0,32,14,65,2,116,65,128,130,192,128,0,106,40,2,0,34,18,106,65,1,65,127,32,
  16,27,34,16,108,32,5,106,33,5,32,17,65,156,130,192,128,0,106,40,2,0,32,18,106,32,16,108,32,4,106,33,4,2,64,2,64,2,64,32,15,65,254,1,113,65,2,70,13,0,65,2,33,13,32,14,65,4,71,13,1,11,32,13,
  32,6,106,33,6,12,1,11,32,14,65,5,70,65,2,116,32,6,106,33,6,32,14,65,1,71,13,0,32,11,65,7,113,33,14,2,64,32,12,65,1,72,13,0,32,3,65,144,2,106,32,9,65,2,116,106,32,11,54,2,0,32,3,65,
  176,4,106,32,14,65,2,116,106,34,12,32,12,40,2,0,65,1,106,54,2,0,32,9,65,1,106,33,9,12,2,11,32,3,65,16,106,32,10,65,2,116,106,32,11,54,2,0,32,3,65,144,4,106,32,14,65,2,116,106,34,12,32,12,
  40,2,0,65,1,106,54,2,0,32,10,65,1,106,33,10,12,1,11,32,14,65,3,71,13,0,2,64,32,12,65,1,72,13,0,32,7,65,1,106,33,7,12,1,11,32,8,65,1,106,33,8,11,32,11,65,1,106,34,11,65,192,0,71,
  13,0,11,32,3,65,8,106,32,3,65,144,2,106,32,9,32,3,65,176,4,106,32,3,65,16,106,32,10,65,1,32,1,32,2,16,132,128,128,128,0,32,3,32,3,65,16,106,32,10,32,3,65,144,4,106,32,3,65,144,2,106,32,9,
  65,127,32,2,32,1,16,132,128,128,128,0,32,3,40,2,8,32,3,40,2,0,107,32,4,106,34,11,65,30,106,32,11,32,7,65,1,74,34,12,27,34,11,65,98,106,32,11,32,8,65,1,74,34,14,27,33,15,32,3,40,2,12,32,
  3,40,2,4,107,32,5,106,34,11,65,45,106,32,11,32,12,27,34,11,65,83,106,32,11,32,14,27,33,16,65,0,33,11,3,64,2,64,32,11,65,192,129,192,128,0,106,44,0,0,34,12,69,13,0,65,1,65,127,32,12,65,0,74,
  34,5,27,33,14,32,11,65,7,113,33,13,2,64,2,64,32,12,32,12,65,31,117,34,4,115,32,4,107,65,124,106,14,3,1,2,0,2,11,32,11,32,14,65,3,116,106,33,12,65,0,33,4,2,64,32,13,69,13,0,32,12,65,127,
  106,65,63,75,13,0,32,14,32,12,65,191,129,192,128,0,106,44,0,0,70,33,4,11,2,64,32,12,65,63,75,13,0,32,4,32,14,32,12,65,192,129,192,128,0,106,44,0,0,70,106,33,4,11,2,64,32,13,65,7,70,13,0,32,
  12,65,1,106,65,63,75,13,0,32,4,32,14,32,12,65,193,129,192,128,0,106,44,0,0,70,106,33,4,11,32,14,32,4,108,65,12,108,32,15,106,33,15,12,1,11,32,3,65,176,4,106,32,3,65,144,4,106,32,5,27,32,13,65,
  2,116,34,12,106,40,2,0,13,0,65,15,65,30,32,3,65,144,4,106,32,3,65,176,4,106,32,5,27,32,12,106,40,2,0,27,32,14,108,32,15,106,33,15,32,14,65,15,108,32,16,106,33,16,11,32,11,65,1,106,34,11,65,192,
  0,71,13,0,11,32,15,32,6,65,24,32,6,65,24,72,27,34,11,108,32,16,65,24,32,11,107,108,106,183,68,0,0,0,0,0,0,56,64,163,33,19,2,64,32,6,65,4,74,13,0,32,16,32,16,65,31,117,34,11,115,32,11,107,
  65,144,3,77,13,0,32,19,32,2,32,1,32,16,65,0,74,34,11,27,34,12,65,7,113,34,14,65,1,116,65,121,106,34,13,32,13,65,31,117,34,13,115,32,13,107,34,13,32,12,65,3,117,34,12,65,1,116,65,121,106,34,6,32,
  6,65,31,117,34,6,115,32,6,107,34,6,32,13,32,6,75,27,65,10,108,65,14,32,1,32,2,32,11,27,34,13,65,3,117,32,12,107,34,12,32,12,65,31,117,34,12,115,32,12,107,32,13,65,7,113,32,14,107,34,12,32,12,65,
  31,117,34,12,115,32,12,107,106,107,65,6,108,106,34,12,65,0,32,12,107,32,11,27,183,160,33,19,11,32,3,65,208,4,106,36,128,128,128,128,0,32,19,32,0,183,162,68,0,0,0,0,0,0,224,63,160,156,252,2,65,8,106,11,
  223,3,1,12,127,32,0,66,0,55,2,0,2,64,32,2,65,1,78,13,0,32,0,65,0,54,2,0,15,11,65,0,33,9,32,7,65,3,117,65,7,65,0,32,6,65,0,74,34,10,27,34,11,107,34,12,32,12,65,31,117,34,12,115,
  32,12,107,33,13,32,8,65,3,117,32,11,107,34,11,32,11,65,31,117,34,11,115,32,11,107,33,14,32,7,65,7,113,33,15,32,8,65,7,113,33,16,65,0,33,17,65,0,33,18,3,64,32,18,65,116,106,32,18,32,3,32,1,32,
  17,65,2,116,106,40,2,0,34,19,65,7,113,34,20,65,2,116,106,34,8,40,2,0,65,1,74,34,7,27,33,18,32,9,65,112,106,32,9,32,7,27,33,9,2,64,2,64,2,64,32,20,69,13,0,32,8,65,124,106,40,2,0,13,
  2,32,20,65,7,70,13,1,11,32,8,40,2,4,13,1,11,32,9,65,113,106,33,9,32,18,65,117,106,33,18,11,2,64,2,64,32,5,65,1,72,13,0,32,4,33,8,32,5,33,7,3,64,2,64,32,8,40,2,0,34,12,65,7,
  113,32,20,107,34,11,32,11,65,31,117,34,11,115,32,11,107,65,1,75,13,0,2,64,32,6,65,1,72,13,0,32,12,32,19,76,13,1,12,4,11,32,12,32,19,72,13,3,11,32,8,65,4,106,33,8,32,7,65,127,106,34,7,13,
  0,11,11,32,9,32,19,65,3,117,34,8,65,7,32,8,107,32,10,27,34,8,65,2,116,34,7,65,160,129,192,128,0,106,40,2,0,106,33,9,32,18,32,7,65,128,129,192,128,0,106,40,2,0,106,33,18,32,8,65,4,72,13,0,
  32,9,32,8,32,16,32,20,107,34,7,32,7,65,31,117,34,7,115,32,7,107,34,7,32,14,32,7,32,14,75,27,32,15,32,20,107,34,7,32,7,65,31,117,34,7,115,32,7,107,34,7,32,13,32,7,32,13,75,27,107,108,65,3,
  108,106,33,9,11,32,17,65,1,106,34,17,32,2,71,13,0,11,32,0,32,9,54,2,4,32,0,32,18,54,2,0,11,15,0,32,1,65,0,32,0,107,16,134,128,128,128,0,11,199,8,1,18,127,32,0,65,7,113,33,2,2,64,2,
  64,32,0,65,3,117,34,3,32,1,107,34,4,65,7,75,13,0,32,4,65,3,116,33,4,2,64,32,2,69,13,0,2,64,32,2,32,4,106,65,191,129,192,128,0,106,44,0,0,32,1,71,13,0,65,1,15,11,32,2,65,7,71,13,
  0,32,1,65,1,116,33,5,65,8,33,6,32,3,65,1,106,34,7,65,8,73,33,8,32,3,65,2,106,34,4,65,8,73,33,9,65,9,33,10,65,0,33,11,65,0,33,12,12,2,11,32,2,32,4,106,65,193,129,192,128,0,106,44,
  0,0,32,1,71,13,0,65,1,15,11,32,2,65,1,106,33,6,32,1,65,1,116,33,5,32,3,65,2,106,33,4,2,64,32,2,65,7,70,13,0,32,4,65,7,75,13,0,32,5,32,4,65,3,116,32,6,114,65,192,129,192,128,0,
  106,44,0,0,71,13,0,65,1,15,11,32,2,65,7,71,33,12,32,4,65,8,73,33,9,32,2,65,6,73,33,11,32,2,65,2,106,33,10,32,3,65,1,106,34,7,65,8,73,33,8,32,2,65,5,75,13,0,32,7,65,7,75,13,
  0,32,5,32,7,65,3,116,32,10,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,32,3,65,127,106,33,13,2,64,32,11,69,13,0,32,13,65,7,75,13,0,32,5,32,13,65,3,116,32,10,114,65,192,129,192,128,
  0,106,44,0,0,71,13,0,65,1,15,11,65,1,33,10,2,64,2,64,32,12,32,3,65,126,106,34,11,65,8,73,113,65,1,71,13,0,32,5,32,11,65,3,116,32,6,114,65,192,129,192,128,0,106,44,0,0,70,13,1,11,2,64,
  32,2,65,127,106,34,14,65,7,75,13,0,32,11,65,7,75,13,0,32,5,32,11,65,3,116,32,14,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,2,64,32,2,65,126,106,34,11,65,7,75,13,0,32,13,65,7,
  75,13,0,32,5,32,13,65,3,116,32,11,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,65,1,33,10,2,64,32,11,65,8,73,32,8,113,65,1,71,13,0,32,5,32,7,65,3,116,32,11,114,65,192,129,192,128,
  0,106,44,0,0,70,13,1,11,2,64,32,14,65,8,73,32,9,113,65,1,71,13,0,32,5,32,4,65,3,116,32,14,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,32,2,65,192,129,192,128,0,106,33,15,32,1,
  65,5,108,33,16,65,0,33,4,3,64,32,4,34,17,65,2,116,34,4,65,192,128,192,128,0,106,40,2,0,34,9,32,4,65,196,128,192,128,0,106,40,2,0,34,18,65,3,116,106,33,19,32,15,32,9,32,3,32,18,106,34,5,65,
  3,116,106,106,33,10,32,2,32,9,106,33,4,2,64,3,64,32,4,65,7,75,13,1,32,5,65,7,75,13,1,32,5,32,18,106,33,5,32,4,32,9,106,33,4,32,10,44,0,0,33,11,32,10,32,19,106,33,10,32,11,69,13,0,
  11,65,1,33,10,32,16,32,11,70,13,2,65,3,65,4,32,17,65,8,73,27,32,1,108,32,11,70,13,2,11,32,17,65,2,106,33,4,32,17,65,13,77,13,0,11,32,1,65,6,108,33,4,2,64,32,12,32,8,113,69,13,0,32,
  4,32,7,65,3,116,32,6,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,65,1,33,10,2,64,32,12,32,13,65,8,73,113,65,1,71,13,0,32,4,32,13,65,3,116,32,6,114,65,192,129,192,128,0,106,44,0,
  0,70,13,1,11,2,64,32,14,65,8,73,32,8,113,65,1,71,13,0,32,4,32,7,65,3,116,32,14,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,2,64,32,14,65,7,75,13,0,32,13,65,7,75,13,0,32,
  4,32,13,65,3,116,32,14,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,65,1,33,10,2,64,32,12,65,1,115,32,3,65,7,75,114,13,0,32,4,32,0,65,120,113,32,6,114,65,192,129,192,128,0,106,44,0,
  0,70,13,1,11,2,64,32,14,32,3,114,65,7,75,13,0,32,4,32,0,65,120,113,32,14,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,2,64,32,8,69,13,0,32,4,32,7,65,3,116,32,2,114,65,192,129,
  192,128,0,106,44,0,0,71,13,0,65,1,15,11,2,64,32,13,65,7,75,13,0,32,4,32,13,65,3,116,32,2,114,65,192,129,192,128,0,106,44,0,0,71,13,0,65,1,15,11,65,0,33,10,11,32,10,11,242,19,1,33,127,65,
  0,32,3,54,2,164,174,192,128,0,65,0,32,0,54,2,160,174,192,128,0,65,0,32,4,54,2,168,174,192,128,0,65,0,65,0,54,2,172,174,192,128,0,65,7,65,0,32,0,65,1,70,34,3,27,33,5,65,1,65,6,32,3,27,
  33,6,32,2,65,6,116,33,7,32,1,65,2,113,33,8,32,1,65,1,113,33,9,32,1,65,8,113,33,10,32,1,65,4,113,33,11,32,0,65,4,116,33,12,32,0,65,3,116,33,13,65,0,32,0,107,33,14,65,0,33,15,65,0,
  33,16,65,0,33,17,2,64,3,64,2,64,32,17,65,192,129,192,128,0,106,34,18,44,0,0,34,1,69,13,0,65,1,65,127,32,1,65,0,74,27,32,0,71,13,0,32,17,65,3,118,33,19,32,17,65,7,113,33,20,2,64,2,64,
  2,64,32,1,32,1,192,65,7,117,34,3,115,32,3,107,65,255,1,113,34,21,65,127,106,14,2,0,1,2,11,2,64,32,17,32,13,106,34,1,65,63,75,13,0,32,1,65,192,129,192,128,0,106,45,0,0,13,0,32,17,32,1,32,
  5,16,136,128,128,128,0,13,5,32,19,32,6,71,13,0,32,1,65,3,118,32,5,70,13,0,32,17,32,12,106,34,4,65,192,129,192,128,0,106,34,3,45,0,0,13,0,65,0,40,2,168,174,192,128,0,34,22,65,1,70,13,0,32,
  18,45,0,0,33,23,32,18,65,0,58,0,0,32,3,32,23,58,0,0,32,4,65,0,40,2,164,174,192,128,0,32,23,32,23,192,65,7,117,34,24,115,32,24,107,65,255,1,113,34,25,65,6,70,27,65,0,65,0,40,2,160,174,192,
  128,0,107,16,134,128,128,128,0,33,24,32,18,32,23,58,0,0,32,3,65,0,58,0,0,32,24,13,0,32,22,65,2,70,13,5,65,0,65,0,40,2,172,174,192,128,0,34,3,65,1,106,54,2,172,174,192,128,0,32,3,65,2,116,
  65,160,158,192,128,0,106,32,4,65,6,116,32,25,65,12,116,114,32,17,114,65,128,128,128,1,114,54,2,0,11,2,64,32,20,69,13,0,32,1,65,127,106,34,3,65,63,75,13,0,2,64,32,3,65,192,129,192,128,0,106,34,23,44,
  0,0,34,4,69,13,0,65,1,65,127,32,4,65,0,74,27,32,14,71,13,0,32,17,32,3,32,5,16,136,128,128,128,0,69,13,1,12,6,11,32,3,32,2,71,13,0,32,18,45,0,0,33,3,32,18,65,0,58,0,0,32,23,32,
  3,58,0,0,32,2,65,0,40,2,160,174,192,128,0,34,24,65,3,116,107,34,25,65,192,129,192,128,0,106,34,22,45,0,0,33,26,32,22,65,0,58,0,0,65,0,40,2,168,174,192,128,0,33,27,32,2,65,0,40,2,164,174,192,
  128,0,32,3,32,3,192,65,7,117,34,28,115,32,28,107,65,255,1,113,34,28,65,6,70,27,65,0,32,24,107,16,134,128,128,128,0,33,24,2,64,32,25,65,0,72,13,0,32,22,32,26,58,0,0,11,32,18,32,3,58,0,0,32,
  23,32,4,58,0,0,32,24,13,0,32,27,65,2,70,13,5,65,0,65,0,40,2,172,174,192,128,0,34,3,65,1,106,54,2,172,174,192,128,0,32,3,65,2,116,65,160,158,192,128,0,106,32,28,65,12,116,32,7,114,32,17,106,65,
  128,128,130,2,114,54,2,0,11,32,20,65,7,70,13,2,32,1,65,1,106,34,1,65,63,75,13,2,2,64,32,1,65,192,129,192,128,0,106,34,4,44,0,0,34,3,69,13,0,65,1,65,127,32,3,65,0,74,27,32,14,71,13,0,
  32,17,32,1,32,5,16,136,128,128,128,0,69,13,3,12,5,11,32,1,32,2,71,13,2,32,18,45,0,0,33,1,32,18,65,0,58,0,0,32,4,32,1,58,0,0,32,2,65,0,40,2,160,174,192,128,0,34,23,65,3,116,107,34,
  22,65,192,129,192,128,0,106,34,20,45,0,0,33,25,32,20,65,0,58,0,0,65,0,40,2,168,174,192,128,0,33,28,32,2,65,0,40,2,164,174,192,128,0,32,1,32,1,192,65,7,117,34,24,115,32,24,107,65,255,1,113,34,24,
  65,6,70,27,65,0,32,23,107,16,134,128,128,128,0,33,23,2,64,32,22,65,0,72,13,0,32,20,32,25,58,0,0,11,32,18,32,1,58,0,0,32,4,32,3,58,0,0,32,23,13,2,32,28,65,2,70,13,4,65,0,65,0,40,
  2,172,174,192,128,0,34,1,65,1,106,54,2,172,174,192,128,0,32,1,65,2,116,65,160,158,192,128,0,106,32,24,65,12,116,32,7,114,32,17,106,65,128,128,130,2,114,54,2,0,12,2,11,65,0,65,0,40,2,160,174,192,128,0,
  107,33,21,65,0,40,2,164,174,192,128,0,33,29,65,0,40,2,168,174,192,128,0,33,26,65,0,40,2,172,174,192,128,0,33,27,65,96,33,1,3,64,2,64,32,1,65,160,128,192,128,0,106,40,2,0,32,20,106,34,3,65,7,75,
  13,0,32,1,65,192,128,192,128,0,106,40,2,0,32,19,106,34,4,65,7,75,13,0,2,64,2,64,32,4,65,3,116,32,3,114,34,22,65,192,129,192,128,0,106,34,23,44,0,0,34,3,69,13,0,65,1,65,127,32,3,65,0,74,
  27,32,14,71,13,2,32,3,32,3,65,31,117,34,4,115,32,4,107,33,25,12,1,11,65,0,33,25,32,26,65,1,70,13,1,11,32,18,45,0,0,33,4,32,18,65,0,58,0,0,32,23,32,4,58,0,0,32,22,32,29,32,4,32,
  4,192,65,7,117,34,24,115,32,24,107,65,255,1,113,34,28,65,6,70,27,32,21,16,134,128,128,128,0,33,24,32,18,32,4,58,0,0,32,23,32,3,58,0,0,32,24,13,0,32,26,65,2,70,13,5,65,0,32,27,65,1,106,34,
  3,54,2,172,174,192,128,0,32,27,65,2,116,65,160,158,192,128,0,106,32,25,65,15,116,32,28,65,12,116,32,22,65,6,116,114,114,32,17,114,54,2,0,32,3,33,27,11,32,1,65,4,106,34,1,13,0,12,2,11,11,2,64,32,
  21,65,4,70,65,3,116,34,30,65,8,65,16,32,21,65,3,70,27,34,31,79,13,0,32,15,65,7,113,33,22,65,0,65,0,40,2,160,174,192,128,0,107,33,32,65,0,40,2,164,174,192,128,0,33,33,65,0,40,2,168,174,192,128,
  0,33,27,65,0,40,2,172,174,192,128,0,33,34,3,64,32,30,65,2,116,34,1,65,196,128,192,128,0,106,40,2,0,34,26,65,9,116,32,1,65,192,128,192,128,0,106,40,2,0,34,28,65,6,116,106,33,29,32,28,32,26,65,3,
  116,106,33,35,32,28,32,19,32,26,106,34,3,65,3,116,106,34,4,32,22,106,65,6,116,33,23,32,28,33,1,32,34,33,36,2,64,3,64,32,22,32,1,106,65,7,75,13,1,32,3,65,7,75,13,1,2,64,32,22,32,4,106,34,
  25,65,192,129,192,128,0,106,34,24,44,0,0,34,20,13,0,2,64,32,27,65,1,70,13,0,32,18,45,0,0,33,20,32,18,65,0,58,0,0,32,24,32,20,58,0,0,32,25,32,33,32,20,32,20,192,65,7,117,34,37,115,32,37,
  107,65,255,1,113,34,37,65,6,70,27,32,32,16,134,128,128,128,0,33,25,32,18,32,20,58,0,0,32,24,65,0,58,0,0,32,25,13,0,32,27,65,2,70,13,8,65,0,32,36,65,1,106,34,34,54,2,172,174,192,128,0,32,36,
  65,2,116,65,160,158,192,128,0,106,32,17,32,23,106,32,37,65,12,116,106,54,2,0,32,34,33,36,11,32,3,32,26,106,33,3,32,1,32,28,106,33,1,32,23,32,29,106,33,23,32,4,32,35,106,33,4,32,21,65,6,71,13,1,
  12,2,11,11,65,1,65,127,32,20,65,0,74,27,32,14,71,13,0,32,18,45,0,0,33,1,32,18,65,0,58,0,0,32,24,32,1,58,0,0,32,25,32,33,32,1,32,1,192,65,7,117,34,3,115,32,3,107,65,255,1,113,34,4,
  65,6,70,27,32,32,16,134,128,128,128,0,33,3,32,18,32,1,58,0,0,32,24,32,20,58,0,0,32,3,13,0,32,27,65,2,70,13,5,65,0,32,34,65,1,106,34,1,54,2,172,174,192,128,0,32,34,65,2,116,65,160,158,192,
  128,0,106,32,20,32,20,65,31,117,34,3,115,32,3,107,65,15,116,32,4,65,12,116,32,23,106,114,32,17,114,54,2,0,32,1,33,34,11,32,30,65,2,106,34,30,32,31,73,13,0,11,11,2,64,32,0,65,1,71,13,0,32,17,
  65,4,71,13,0,32,21,65,6,71,13,0,2,64,32,9,69,13,0,65,0,45,0,199,129,192,128,0,65,255,1,113,65,4,71,13,0,65,0,45,0,197,129,192,128,0,65,255,1,113,13,0,65,0,45,0,198,129,192,128,0,65,255,1,
  113,13,0,65,4,65,127,16,134,128,128,128,0,13,0,65,5,65,127,16,134,128,128,128,0,13,0,65,6,65,127,16,134,128,128,128,0,13,0,65,4,65,6,65,0,65,4,16,137,128,128,128,0,13,4,11,32,8,69,13,1,65,0,45,
  0,192,129,192,128,0,65,255,1,113,65,4,71,13,1,65,0,45,0,193,129,192,128,0,65,255,1,113,13,1,65,0,45,0,194,129,192,128,0,65,255,1,113,13,1,65,0,45,0,195,129,192,128,0,65,255,1,113,13,1,65,4,65,127,
  16,134,128,128,128,0,13,1,65,3,65,127,16,134,128,128,128,0,13,1,65,2,65,127,16,134,128,128,128,0,13,1,65,4,65,2,65,0,65,8,16,137,128,128,128,0,69,13,1,12,3,11,32,0,65,127,71,13,0,32,17,65,60,71,
  13,0,32,21,65,6,71,13,0,2,64,32,11,69,13,0,65,0,45,0,255,129,192,128,0,65,255,1,113,65,252,1,71,13,0,65,0,45,0,253,129,192,128,0,65,255,1,113,13,0,65,0,45,0,254,129,192,128,0,65,255,1,113,13,
  0,65,60,65,1,16,134,128,128,128,0,13,0,65,61,65,1,16,134,128,128,128,0,13,0,65,62,65,1,16,134,128,128,128,0,13,0,65,60,65,62,65,0,65,4,16,137,128,128,128,0,13,3,11,32,10,69,13,0,65,0,45,0,248,
  129,192,128,0,65,255,1,113,65,252,1,71,13,0,65,0,45,0,249,129,192,128,0,65,255,1,113,13,0,65,0,45,0,250,129,192,128,0,65,255,1,113,13,0,65,0,45,0,251,129,192,128,0,65,255,1,113,13,0,65,60,65,1,16,
  134,128,128,128,0,13,0,65,59,65,1,16,134,128,128,128,0,13,0,65,58,65,1,16,134,128,128,128,0,13,0,65,60,65,58,65,0,65,8,16,137,128,128,128,0,13,2,11,32,15,65,1,106,33,15,32,17,65,62,75,33,16,32,17,
  65,1,106,34,17,65,192,0,71,13,0,11,11,65,0,65,0,40,2,172,174,192,128,0,65,0,40,2,168,174,192,128,0,65,2,70,27,65,1,32,16,65,1,113,27,11,193,7,1,11,127,2,64,2,64,2,64,32,1,65,3,118,32,2,
  70,13,0,32,1,65,192,129,192,128,0,106,34,3,44,0,0,33,4,65,0,33,5,2,64,65,0,40,2,168,174,192,128,0,34,6,65,1,71,13,0,32,4,69,13,3,11,32,0,65,192,129,192,128,0,106,34,7,45,0,0,33,2,65,
  0,33,5,32,7,65,0,58,0,0,32,3,32,2,58,0,0,32,1,65,0,40,2,164,174,192,128,0,32,2,32,2,192,65,7,117,34,8,115,32,8,107,65,255,1,113,34,9,65,6,70,27,65,0,65,0,40,2,160,174,192,128,0,107,
  16,134,128,128,128,0,33,8,32,7,32,2,58,0,0,32,3,32,4,58,0,0,32,8,13,2,2,64,32,6,65,2,71,13,0,65,1,15,11,32,1,65,6,116,32,4,32,4,65,31,117,34,1,115,32,1,107,65,15,116,114,32,9,65,
  12,116,114,32,0,114,33,1,12,1,11,32,1,65,192,129,192,128,0,106,34,4,44,0,0,33,2,32,0,65,192,129,192,128,0,106,34,5,45,0,0,33,7,32,5,65,0,58,0,0,32,4,65,0,40,2,160,174,192,128,0,34,3,65,
  5,108,58,0,0,65,0,40,2,168,174,192,128,0,33,10,32,1,65,0,40,2,164,174,192,128,0,34,6,32,7,32,7,192,65,7,117,34,8,115,32,8,107,65,255,1,113,34,11,65,6,70,27,65,0,32,3,107,34,8,16,134,128,128,
  128,0,33,9,32,5,32,7,58,0,0,32,4,32,2,58,0,0,32,2,32,2,65,31,117,34,7,115,32,7,107,33,12,2,64,32,9,13,0,2,64,32,10,65,2,71,13,0,65,1,15,11,65,0,65,0,40,2,172,174,192,128,0,34,
  7,65,1,106,54,2,172,174,192,128,0,32,7,65,2,116,65,160,158,192,128,0,106,32,1,65,6,116,32,11,65,12,116,114,32,12,65,15,116,114,32,0,114,65,128,128,208,0,114,54,2,0,11,32,5,45,0,0,33,7,32,5,65,0,
  58,0,0,32,4,32,3,65,2,116,58,0,0,32,1,32,6,32,7,32,7,192,65,7,117,34,9,115,32,9,107,65,255,1,113,34,11,65,6,70,27,32,8,16,134,128,128,128,0,33,9,32,5,32,7,58,0,0,32,4,32,2,58,0,
  0,2,64,32,9,13,0,2,64,32,10,65,2,71,13,0,65,1,15,11,65,0,65,0,40,2,172,174,192,128,0,34,5,65,1,106,54,2,172,174,192,128,0,32,5,65,2,116,65,160,158,192,128,0,106,32,1,65,6,116,32,12,65,15,
  116,114,32,11,65,12,116,114,32,0,114,65,128,128,192,0,114,54,2,0,11,32,0,65,192,129,192,128,0,106,34,4,45,0,0,33,7,65,0,33,5,32,4,65,0,58,0,0,32,1,65,192,129,192,128,0,106,34,9,32,3,65,3,108,
  58,0,0,32,1,32,6,32,7,32,7,192,65,7,117,34,11,115,32,11,107,65,255,1,113,34,13,65,6,70,27,32,8,16,134,128,128,128,0,33,11,32,4,32,7,58,0,0,32,9,32,2,58,0,0,2,64,32,11,13,0,2,64,32,
  10,65,2,71,13,0,65,1,15,11,65,0,65,0,40,2,172,174,192,128,0,34,7,65,1,106,54,2,172,174,192,128,0,32,7,65,2,116,65,160,158,192,128,0,106,32,1,65,6,116,32,12,65,15,116,114,32,13,65,12,116,114,32,0,
  114,65,128,128,48,114,54,2,0,11,32,4,45,0,0,33,7,32,4,65,0,58,0,0,32,9,32,3,65,1,116,58,0,0,32,1,32,6,32,7,32,7,192,65,7,117,34,3,115,32,3,107,65,255,1,113,34,11,65,6,70,27,32,8,
  16,134,128,128,128,0,33,3,32,4,32,7,58,0,0,32,9,32,2,58,0,0,32,3,13,1,65,1,33,5,32,10,65,2,70,13,1,32,1,65,6,116,32,12,65,15,116,114,32,11,65,12,116,114,32,0,114,65,128,128,32,114,33,1,
  11,65,0,33,5,65,0,65,0,40,2,172,174,192,128,0,34,2,65,1,106,54,2,172,174,192,128,0,32,2,65,2,116,65,160,158,192,128,0,106,32,1,54,2,0,11,32,5,11,254,3,1,11,127,65,1,32,1,65,192,129,192,128,0,
  106,34,4,44,0,0,34,5,32,5,65,31,117,34,6,115,32,6,107,32,3,65,2,113,34,7,27,33,8,65,0,33,9,32,0,65,192,129,192,128,0,106,34,10,44,0,0,33,6,2,64,2,64,65,0,40,2,168,174,192,128,0,34,11,
  65,1,71,13,0,32,8,32,2,114,69,13,1,11,65,0,33,12,32,10,65,0,58,0,0,32,4,65,0,40,2,160,174,192,128,0,34,10,32,2,108,32,6,32,2,27,58,0,0,65,127,33,9,65,127,33,4,65,0,33,13,2,64,32,
  7,69,13,0,32,1,32,10,65,3,116,107,34,4,65,192,129,192,128,0,106,34,7,45,0,0,33,13,32,7,65,0,58,0,0,11,65,127,33,7,2,64,32,3,65,12,113,69,13,0,65,5,65,3,32,3,65,4,113,34,9,27,65,61,
  65,59,32,9,27,32,10,65,1,70,34,12,27,34,7,65,192,129,192,128,0,106,32,3,65,29,116,65,31,117,65,7,113,65,63,65,56,32,9,27,32,12,27,34,9,65,192,129,192,128,0,106,34,14,45,0,0,34,12,58,0,0,32,14,
  65,0,58,0,0,11,32,1,65,0,40,2,164,174,192,128,0,32,6,32,6,65,31,117,34,14,115,32,14,107,34,14,65,6,70,27,65,0,32,10,107,16,134,128,128,128,0,33,10,2,64,32,9,65,0,72,13,0,32,9,65,192,129,192,
  128,0,106,32,12,58,0,0,32,7,65,192,129,192,128,0,106,65,0,58,0,0,11,2,64,32,4,65,0,72,13,0,32,4,65,192,129,192,128,0,106,32,13,58,0,0,11,32,0,65,192,129,192,128,0,106,32,6,58,0,0,32,1,65,
  192,129,192,128,0,106,32,5,58,0,0,2,64,32,10,69,13,0,65,0,15,11,2,64,32,11,65,2,71,13,0,65,1,15,11,65,0,33,9,65,0,65,0,40,2,172,174,192,128,0,34,6,65,1,106,54,2,172,174,192,128,0,32,6,
  65,2,116,65,160,158,192,128,0,106,32,1,65,6,116,32,2,65,18,116,114,32,3,65,21,116,114,32,14,65,12,116,114,32,8,65,15,116,114,32,0,114,54,2,0,11,32,9,11,11,202,1,1,0,65,128,128,192,0,11,192,1,1,0,
  0,0,2,0,0,0,2,0,0,0,1,0,0,0,255,255,255,255,254,255,255,255,254,255,255,255,255,255,255,255,2,0,0,0,1,0,0,0,255,255,255,255,254,255,255,255,254,255,255,255,255,255,255,255,1,0,0,0,2,0,0,0,1,0,
  0,0,1,0,0,0,1,0,0,0,255,255,255,255,255,255,255,255,1,0,0,0,255,255,255,255,255,255,255,255,1,0,0,0,0,0,0,0,255,255,255,255,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,255,255,255,255,0,0,
  0,0,0,0,0,0,8,0,0,0,17,0,0,0,35,0,0,0,65,0,0,0,110,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,0,0,0,32,0,0,0,65,0,0,0,120,0,0,0,210,0,0,0,0,0,0,0,0,254,
  55,10,46,100,101,98,117,103,95,108,111,99,255,255,255,255,254,255,255,255,0,0,0,0,41,0,0,0,4,0,237,0,2,159,0,0,0,0,0,0,0,0,255,255,255,255,254,255,255,255,0,0,0,0,41,0,0,0,2,0,48,159,132,0,
  0,0,134,0,0,0,4,0,237,2,1,159,134,0,0,0,137,0,0,0,4,0,237,0,4,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,23,0,0,0,143,0,0,0,3,0,17,0,159,24,1,0,0,235,1,0,0,4,
  0,237,0,4,159,96,2,0,0,98,2,0,0,4,0,237,2,0,159,98,2,0,0,113,2,0,0,4,0,237,0,11,159,113,2,0,0,153,2,0,0,4,0,237,0,15,159,98,3,0,0,100,3,0,0,4,0,237,0,15,159,163,3,0,
  0,173,3,0,0,4,0,237,0,15,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,23,0,0,0,143,0,0,0,3,0,17,0,159,1,1,0,0,235,1,0,0,4,0,237,0,5,159,127,2,0,0,129,2,0,0,4,0,
  237,2,0,159,129,2,0,0,149,2,0,0,4,0,237,0,11,159,149,2,0,0,153,2,0,0,4,0,237,0,16,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,23,0,0,0,143,0,0,0,3,0,17,0,159,60,1,0,
  0,62,1,0,0,4,0,237,0,6,159,76,1,0,0,235,1,0,0,4,0,237,0,6,159,200,3,0,0,202,3,0,0,4,0,237,2,1,159,202,3,0,0,253,3,0,0,4,0,237,0,11,159,0,0,0,0,0,0,0,0,255,255,255,
  255,30,0,0,0,23,0,0,0,143,0,0,0,3,0,17,0,159,225,1,0,0,227,1,0,0,4,0,237,0,7,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,23,0,0,0,143,0,0,0,3,0,17,0,159,0,0,0,
  0,0,0,0,0,255,255,255,255,30,0,0,0,0,0,0,0,183,4,0,0,4,0,237,0,2,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,0,0,0,0,183,4,0,0,4,0,237,0,1,159,0,0,0,0,0,0,0,
  0,255,255,255,255,30,0,0,0,0,0,0,0,183,4,0,0,4,0,237,0,0,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,111,0,0,0,143,0,0,0,3,0,17,0,159,148,1,0,0,150,1,0,0,4,0,237,0,
  9,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,111,0,0,0,143,0,0,0,3,0,17,0,159,199,1,0,0,201,1,0,0,4,0,237,0,10,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,241,1,0,
  0,243,1,0,0,4,0,237,2,0,159,243,1,0,0,153,2,0,0,4,0,237,0,11,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,208,0,0,0,211,0,0,0,4,0,237,2,1,159,0,0,0,0,0,0,0,0,255,
  255,255,255,30,0,0,0,188,0,0,0,190,0,0,0,4,0,237,2,0,159,190,0,0,0,99,1,0,0,4,0,237,0,14,159,201,1,0,0,235,1,0,0,4,0,237,0,14,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,
  0,249,0,0,0,251,0,0,0,4,0,237,2,1,159,251,0,0,0,235,1,0,0,4,0,237,0,16,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,179,3,0,0,181,3,0,0,4,0,237,2,0,159,181,3,0,0,234,
  3,0,0,4,0,237,0,11,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,188,2,0,0,173,3,0,0,4,0,237,0,14,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,195,2,0,0,173,3,0,0,4,
  0,237,0,13,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,222,2,0,0,15,3,0,0,3,0,17,127,159,15,3,0,0,45,3,0,0,3,0,17,0,159,45,3,0,0,84,3,0,0,3,0,17,1,159,0,0,0,0,
  0,0,0,0,255,255,255,255,30,0,0,0,222,2,0,0,15,3,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,148,3,0,0,151,3,0,0,4,0,237,2,2,159,0,0,0,0,0,0,0,0,255,
  255,255,255,30,0,0,0,116,3,0,0,124,3,0,0,4,0,237,2,0,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,225,3,0,0,148,4,0,0,4,0,237,0,19,159,0,0,0,0,0,0,0,0,255,255,255,255,30,
  0,0,0,85,4,0,0,87,4,0,0,4,0,237,2,3,159,87,4,0,0,147,4,0,0,4,0,237,0,13,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,11,4,0,0,13,4,0,0,4,0,237,2,1,159,13,4,0,
  0,147,4,0,0,4,0,237,0,12,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,129,4,0,0,132,4,0,0,4,0,237,2,2,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,65,4,0,0,67,4,0,
  0,4,0,237,2,2,159,67,4,0,0,147,4,0,0,4,0,237,0,6,159,0,0,0,0,0,0,0,0,255,255,255,255,30,0,0,0,73,4,0,0,76,4,0,0,4,0,237,2,1,159,0,0,0,0,0,0,0,0,255,255,255,255,215,
  4,0,0,10,0,0,0,27,0,0,0,3,0,17,0,159,200,1,0,0,202,1,0,0,4,0,237,2,0,159,202,1,0,0,223,1,0,0,4,0,237,0,17,159,0,0,0,0,0,0,0,0,255,255,255,255,215,4,0,0,134,0,0,0,
  136,0,0,0,4,0,237,2,3,159,136,0,0,0,194,1,0,0,4,0,237,0,19,159,0,0,0,0,0,0,0,0,255,255,255,255,215,4,0,0,82,1,0,0,84,1,0,0,4,0,237,2,1,159,84,1,0,0,194,1,0,0,4,0,
  237,0,8,159,0,0,0,0,0,0,0,0,255,255,255,255,215,4,0,0,139,0,0,0,141,0,0,0,4,0,237,2,3,159,141,0,0,0,194,1,0,0,4,0,237,0,20,159,0,0,0,0,0,0,0,0,255,255,255,255,215,4,0,0,
  222,0,0,0,194,1,0,0,3,0,17,1,159,0,0,0,0,0,0,0,0,255,255,255,255,215,4,0,0,222,0,0,0,241,0,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,215,4,0,0,176,1,0,0,178,1,
  0,0,4,0,237,2,3,159,178,1,0,0,194,1,0,0,4,0,237,0,7,159,0,0,0,0,0,0,0,0,255,255,255,255,215,4,0,0,186,1,0,0,187,1,0,0,4,0,237,2,3,159,0,0,0,0,0,0,0,0,255,255,255,255,
  215,4,0,0,148,1,0,0,150,1,0,0,4,0,237,2,2,159,150,1,0,0,194,1,0,0,4,0,237,0,7,159,0,0,0,0,0,0,0,0,255,255,255,255,215,4,0,0,158,1,0,0,187,1,0,0,4,0,237,2,2,159,0,0,
  0,0,0,0,0,0,255,255,255,255,200,6,0,0,10,0,0,0,71,4,0,0,4,0,237,0,2,159,0,0,0,0,0,0,0,0,255,255,255,255,200,6,0,0,19,0,0,0,21,0,0,0,4,0,237,2,0,159,21,0,0,0,71,4,
  0,0,4,0,237,0,3,159,0,0,0,0,0,0,0,0,255,255,255,255,200,6,0,0,0,0,0,0,71,4,0,0,4,0,237,0,1,159,0,0,0,0,0,0,0,0,255,255,255,255,200,6,0,0,24,0,0,0,26,0,0,0,4,0,
  237,2,0,159,26,0,0,0,45,0,0,0,4,0,237,0,4,159,0,0,0,0,0,0,0,0,255,255,255,255,200,6,0,0,85,0,0,0,127,0,0,0,3,0,17,1,159,152,0,0,0,212,0,0,0,3,0,17,0,159,215,0,0,0,
  230,0,0,0,3,0,17,0,159,230,0,0,0,37,1,0,0,3,0,17,1,159,41,1,0,0,85,1,0,0,3,0,17,2,159,89,1,0,0,139,1,0,0,3,0,17,3,159,139,1,0,0,183,1,0,0,3,0,17,4,159,187,1,0,
  0,231,1,0,0,3,0,17,5,159,235,1,0,0,22,2,0,0,3,0,17,6,159,22,2,0,0,60,2,0,0,3,0,17,7,159,0,0,0,0,0,0,0,0,255,255,255,255,200,6,0,0,159,0,0,0,212,0,0,0,4,0,237,0,
  6,159,215,0,0,0,244,0,0,0,4,0,237,0,6,159,244,0,0,0,37,1,0,0,4,0,237,0,10,159,146,1,0,0,148,1,0,0,4,0,237,2,0,159,148,1,0,0,183,1,0,0,4,0,237,0,14,159,194,1,0,0,196,1,
  0,0,4,0,237,2,0,159,196,1,0,0,231,1,0,0,4,0,237,0,11,159,0,0,0,0,0,0,0,0,255,255,255,255,200,6,0,0,94,0,0,0,96,0,0,0,4,0,237,2,0,159,96,0,0,0,106,0,0,0,4,0,237,0,
  7,159,106,0,0,0,108,0,0,0,4,0,237,2,0,159,108,0,0,0,127,0,0,0,4,0,237,0,4,159,173,0,0,0,212,0,0,0,4,0,237,0,4,159,215,0,0,0,249,0,0,0,4,0,237,0,4,159,249,0,0,0,251,0,
  0,0,4,0,237,2,0,159,251,0,0,0,37,1,0,0,4,0,237,0,7,159,48,1,0,0,85,1,0,0,4,0,237,0,13,159,104,1,0,0,106,1,0,0,4,0,237,2,1,159,106,1,0,0,139,1,0,0,4,0,237,0,11,159,
  0,0,0,0,0,0,0,0,255,255,255,255,200,6,0,0,64,2,0,0,86,2,0,0,3,0,17,0,159,90,2,0,0,92,2,0,0,4,0,237,2,0,159,92,2,0,0,243,2,0,0,4,0,237,0,17,159,243,2,0,0,12,3,0,
  0,4,0,237,0,4,159,0,0,0,0,0,0,0,0,255,255,255,255,200,6,0,0,251,2,0,0,35,3,0,0,3,0,17,0,159,39,3,0,0,81,3,0,0,3,0,17,2,159,82,3,0,0,120,3,0,0,3,0,17,4,159,124,3,
  0,0,163,3,0,0,3,0,17,6,159,167,3,0,0,210,3,0,0,3,0,17,8,159,210,3,0,0,245,3,0,0,3,0,17,10,159,249,3,0,0,23,4,0,0,3,0,17,12,159,27,4,0,0,59,4,0,0,3,0,17,14,159,0,
  0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,0,0,0,0,138,0,0,0,4,0,237,0,3,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,0,0,0,0,242,9,0,0,4,0,237,0,0,159,0,0,0,0,0,
  0,0,0,255,255,255,255,17,11,0,0,0,0,0,0,138,0,0,0,4,0,237,0,4,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,0,0,0,0,242,9,0,0,4,0,237,0,2,159,0,0,0,0,0,0,0,0,255,
  255,255,255,17,11,0,0,0,0,0,0,138,0,0,0,4,0,237,0,1,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,199,9,0,0,201,9,0,0,4,0,237,2,0,159,201,9,0,0,207,9,0,0,4,0,237,0,17,
  159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,212,0,0,0,216,0,0,0,8,0,237,2,0,16,255,1,26,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,185,0,0,0,179,9,0,0,4,0,237,0,19,
  159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,192,0,0,0,222,3,0,0,4,0,237,0,20,159,56,4,0,0,210,5,0,0,4,0,237,0,20,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,234,0,0,
  0,236,0,0,0,4,0,237,2,0,159,236,0,0,0,32,3,0,0,4,0,237,0,1,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,74,1,0,0,226,1,0,0,15,0,237,0,23,18,16,7,37,48,32,30,16,8,36,
  33,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,74,1,0,0,226,1,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,74,1,0,0,88,1,0,0,3,0,17,0,159,88,1,0,0,
  226,1,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,74,1,0,0,226,1,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,74,1,0,0,226,1,0,0,3,0,
  17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,74,1,0,0,88,1,0,0,3,0,17,0,159,88,1,0,0,226,1,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,227,1,0,
  0,13,3,0,0,3,0,17,127,159,13,3,0,0,56,4,0,0,3,0,17,1,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,239,1,0,0,241,1,0,0,4,0,237,2,0,159,241,1,0,0,180,2,0,0,4,0,237,
  0,3,159,25,3,0,0,27,3,0,0,4,0,237,2,0,159,27,3,0,0,222,3,0,0,4,0,237,0,1,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,51,2,0,0,12,3,0,0,3,0,17,0,159,93,3,0,0,
  56,4,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,51,2,0,0,12,3,0,0,3,0,17,2,159,93,3,0,0,56,4,0,0,3,0,17,2,159,0,0,0,0,0,0,0,0,255,255,255,255,17,
  11,0,0,58,2,0,0,12,3,0,0,15,0,237,0,3,18,16,7,37,48,32,30,16,8,36,33,159,100,3,0,0,56,4,0,0,15,0,237,0,1,18,16,7,37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,
  255,17,11,0,0,58,2,0,0,89,2,0,0,3,0,17,127,159,89,2,0,0,91,2,0,0,4,0,237,2,0,159,91,2,0,0,12,3,0,0,4,0,237,0,25,159,100,3,0,0,131,3,0,0,3,0,17,127,159,131,3,0,0,133,
  3,0,0,4,0,237,2,0,159,133,3,0,0,56,4,0,0,4,0,237,0,22,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,58,2,0,0,105,2,0,0,3,0,17,0,159,100,3,0,0,147,3,0,0,3,0,17,0,
  159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,58,2,0,0,12,3,0,0,3,0,17,127,159,100,3,0,0,56,4,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,58,2,0,0,12,
  3,0,0,3,0,17,127,159,100,3,0,0,56,4,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,58,2,0,0,112,2,0,0,3,0,17,0,159,112,2,0,0,12,3,0,0,3,0,17,0,159,100,
  3,0,0,154,3,0,0,3,0,17,0,159,154,3,0,0,56,4,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,112,2,0,0,180,2,0,0,15,0,237,0,3,18,16,7,37,48,32,30,16,8,36,
  33,159,154,3,0,0,222,3,0,0,15,0,237,0,1,18,16,7,37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,112,2,0,0,12,3,0,0,3,0,17,1,159,154,3,0,0,56,4,0,0,
  3,0,17,1,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,149,4,0,0,151,4,0,0,4,0,237,2,0,159,151,4,0,0,231,4,0,0,4,0,237,0,4,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,
  0,127,4,0,0,129,4,0,0,4,0,237,2,0,159,129,4,0,0,187,4,0,0,4,0,237,0,3,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,168,4,0,0,170,4,0,0,4,0,237,2,0,159,170,4,0,0,115,
  5,0,0,4,0,237,0,22,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,202,4,0,0,219,4,0,0,3,0,17,0,159,224,4,0,0,115,5,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,
  11,0,0,202,4,0,0,219,4,0,0,3,0,17,0,159,224,4,0,0,115,5,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,239,4,0,0,115,5,0,0,15,0,237,0,4,18,16,7,37,48,32,
  30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,217,4,0,0,219,4,0,0,4,0,237,0,25,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,239,4,0,0,115,5,0,0,3,0,17,127,
  159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,239,4,0,0,253,4,0,0,3,0,17,0,159,253,4,0,0,115,5,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,239,4,0,0,115,
  5,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,239,4,0,0,115,5,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,239,4,0,0,253,4,0,0,3,0,17,
  0,159,253,4,0,0,115,5,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,151,5,0,0,153,5,0,0,4,0,237,2,1,159,153,5,0,0,179,9,0,0,4,0,237,0,31,159,0,0,0,0,0,
  0,0,0,255,255,255,255,17,11,0,0,139,5,0,0,141,5,0,0,4,0,237,2,0,159,141,5,0,0,210,5,0,0,4,0,237,0,30,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,141,5,0,0,212,5,0,0,4,
  0,237,0,30,159,176,7,0,0,178,7,0,0,4,0,237,2,0,159,178,7,0,0,194,7,0,0,4,0,237,0,30,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,101,6,0,0,224,6,0,0,15,0,237,0,20,18,16,
  7,37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,101,6,0,0,224,6,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,101,6,0,0,115,6,0,0,3,
  0,17,0,159,115,6,0,0,224,6,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,101,6,0,0,224,6,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,101,6,
  0,0,224,6,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,101,6,0,0,115,6,0,0,3,0,17,0,159,115,6,0,0,224,6,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,
  255,17,11,0,0,30,7,0,0,170,7,0,0,15,0,237,0,1,18,16,7,37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,30,7,0,0,170,7,0,0,3,0,17,127,159,0,0,0,0,0,
  0,0,0,255,255,255,255,17,11,0,0,30,7,0,0,44,7,0,0,3,0,17,0,159,44,7,0,0,170,7,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,30,7,0,0,170,7,0,0,3,0,17,
  127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,30,7,0,0,170,7,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,30,7,0,0,44,7,0,0,3,0,17,0,159,44,7,0,0,
  170,7,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,17,11,0,0,148,7,0,0,151,7,0,0,4,0,237,2,1,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,0,0,0,0,144,3,0,0,4,
  0,237,0,1,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,0,0,0,0,170,0,0,0,4,0,237,0,2,159,218,0,0,0,119,1,0,0,4,0,237,0,2,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,
  0,19,0,0,0,179,0,0,0,3,0,17,0,159,182,0,0,0,218,0,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,19,0,0,0,179,0,0,0,3,0,17,0,159,182,0,0,0,218,0,0,0,
  3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,79,0,0,0,179,0,0,0,15,0,237,0,2,18,16,7,37,48,32,30,16,8,36,33,159,182,0,0,0,218,0,0,0,15,0,237,0,2,18,16,7,37,48,
  32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,35,0,0,0,179,0,0,0,15,0,237,0,4,18,16,7,37,48,32,30,16,8,36,33,159,182,0,0,0,218,0,0,0,15,0,237,0,4,18,16,7,
  37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,201,0,0,0,204,0,0,0,4,0,237,2,1,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,83,0,0,0,179,0,0,0,3,
  0,17,127,159,182,0,0,0,218,0,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,83,0,0,0,97,0,0,0,3,0,17,0,159,97,0,0,0,179,0,0,0,3,0,17,0,159,182,0,0,0,218,
  0,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,83,0,0,0,179,0,0,0,3,0,17,127,159,182,0,0,0,218,0,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,
  0,0,83,0,0,0,179,0,0,0,3,0,17,127,159,182,0,0,0,218,0,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,83,0,0,0,97,0,0,0,3,0,17,0,159,97,0,0,0,179,0,0,
  0,3,0,17,0,159,182,0,0,0,218,0,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,219,0,0,0,128,1,0,0,3,0,17,5,159,131,1,0,0,196,1,0,0,3,0,17,5,159,0,0,0,
  0,0,0,0,0,255,255,255,255,5,21,0,0,219,0,0,0,128,1,0,0,3,0,17,0,159,131,1,0,0,196,1,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,235,0,0,0,128,1,0,0,15,
  0,237,0,2,18,16,7,37,48,32,30,16,8,36,33,159,131,1,0,0,196,1,0,0,15,0,237,0,2,18,16,7,37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,251,0,0,0,119,1,0,
  0,15,0,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,251,0,0,0,128,1,0,0,3,0,17,127,159,131,1,0,0,196,1,0,0,3,0,17,127,159,0,0,0,0,
  0,0,0,0,255,255,255,255,5,21,0,0,251,0,0,0,21,1,0,0,3,0,17,0,159,21,1,0,0,128,1,0,0,3,0,17,0,159,131,1,0,0,196,1,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,
  21,0,0,251,0,0,0,128,1,0,0,3,0,17,127,159,131,1,0,0,196,1,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,251,0,0,0,128,1,0,0,3,0,17,127,159,131,1,0,0,196,1,
  0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,251,0,0,0,21,1,0,0,3,0,17,0,159,21,1,0,0,128,1,0,0,3,0,17,0,159,131,1,0,0,196,1,0,0,3,0,17,0,159,0,0,
  0,0,0,0,0,0,255,255,255,255,5,21,0,0,113,1,0,0,128,1,0,0,4,0,237,0,12,159,131,1,0,0,196,1,0,0,4,0,237,0,12,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,197,1,0,0,32,2,
  0,0,3,0,17,4,159,35,2,0,0,100,2,0,0,3,0,17,4,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,197,1,0,0,32,2,0,0,3,0,17,0,159,35,2,0,0,100,2,0,0,3,0,17,0,159,0,0,
  0,0,0,0,0,0,255,255,255,255,5,21,0,0,204,1,0,0,32,2,0,0,15,0,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,35,2,0,0,100,2,0,0,15,0,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,
  0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,204,1,0,0,32,2,0,0,3,0,17,127,159,35,2,0,0,100,2,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,204,1,0,0,221,1,
  0,0,3,0,17,0,159,221,1,0,0,32,2,0,0,3,0,17,0,159,35,2,0,0,100,2,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,204,1,0,0,32,2,0,0,3,0,17,127,159,35,2,
  0,0,100,2,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,204,1,0,0,32,2,0,0,3,0,17,127,159,35,2,0,0,100,2,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,
  255,5,21,0,0,204,1,0,0,221,1,0,0,3,0,17,0,159,221,1,0,0,32,2,0,0,3,0,17,0,159,35,2,0,0,100,2,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,101,2,0,0,
  214,2,0,0,3,0,17,3,159,217,2,0,0,25,3,0,0,3,0,17,3,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,101,2,0,0,214,2,0,0,3,0,17,0,159,217,2,0,0,25,3,0,0,3,0,17,0,159,
  0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,117,2,0,0,214,2,0,0,15,0,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,217,2,0,0,25,3,0,0,15,0,237,0,7,18,16,7,37,48,32,30,16,8,36,
  33,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,121,2,0,0,214,2,0,0,3,0,17,127,159,217,2,0,0,25,3,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,121,2,0,0,
  147,2,0,0,3,0,17,0,159,147,2,0,0,214,2,0,0,3,0,17,0,159,217,2,0,0,25,3,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,121,2,0,0,214,2,0,0,3,0,17,127,159,
  217,2,0,0,25,3,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,121,2,0,0,214,2,0,0,3,0,17,127,159,217,2,0,0,25,3,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,
  255,255,255,5,21,0,0,121,2,0,0,147,2,0,0,3,0,17,0,159,147,2,0,0,214,2,0,0,3,0,17,0,159,217,2,0,0,25,3,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,33,3,
  0,0,144,3,0,0,15,0,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,33,3,0,0,144,3,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,
  5,21,0,0,33,3,0,0,50,3,0,0,3,0,17,0,159,50,3,0,0,144,3,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,33,3,0,0,144,3,0,0,3,0,17,127,159,0,0,0,0,0,
  0,0,0,255,255,255,255,5,21,0,0,33,3,0,0,144,3,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,5,21,0,0,33,3,0,0,50,3,0,0,3,0,17,0,159,50,3,0,0,144,3,0,0,3,0,17,
  0,159,0,0,0,0,0,0,0,0,255,255,255,255,200,24,0,0,19,0,0,0,21,0,0,0,15,0,237,2,1,18,16,7,37,48,32,30,16,8,36,33,159,21,0,0,0,254,1,0,0,15,0,237,0,5,18,16,7,37,48,32,30,16,
  8,36,33,159,0,0,0,0,0,0,0,0,255,255,255,255,200,24,0,0,42,0,0,0,254,1,0,0,4,0,237,0,8,159,0,0,0,0,0,0,0,0,255,255,255,255,200,24,0,0,0,0,0,0,254,1,0,0,4,0,237,0,2,159,
  0,0,0,0,0,0,0,0,255,255,255,255,200,24,0,0,0,0,0,0,254,1,0,0,4,0,237,0,0,159,0,0,0,0,0,0,0,0,255,255,255,255,200,24,0,0,62,0,0,0,250,1,0,0,4,0,237,0,6,159,0,0,0,0,
  0,0,0,0,255,255,255,255,200,24,0,0,91,0,0,0,153,0,0,0,3,0,17,127,159,153,0,0,0,155,0,0,0,4,0,237,2,0,159,155,0,0,0,176,0,0,0,4,0,237,0,4,159,0,0,0,0,0,0,0,0,255,255,255,
  255,200,24,0,0,91,0,0,0,169,0,0,0,3,0,17,0,159,0,0,0,0,0,0,0,0,255,255,255,255,200,24,0,0,91,0,0,0,19,1,0,0,3,0,17,127,159,0,0,0,0,0,0,0,0,255,255,255,255,200,24,0,0,91,
  0,0,0,218,0,0,0,3,0,17,127,159,218,0,0,0,220,0,0,0,4,0,237,2,0,159,220,0,0,0,18,1,0,0,4,0,237,0,7,159,0,0,0,0,0,0,0,0,255,255,255,255,200,24,0,0,91,0,0,0,6,1,0,0,
  3,0,17,0,159,6,1,0,0,8,1,0,0,15,0,237,2,1,18,16,7,37,48,32,30,16,8,36,33,159,8,1,0,0,18,1,0,0,15,0,237,0,12,18,16,7,37,48,32,30,16,8,36,33,159,0,0,0,0,0,0,0,0,0,
  236,3,13,46,100,101,98,117,103,95,97,98,98,114,101,118,1,17,1,37,14,19,5,3,14,16,23,27,14,17,1,85,23,0,0,2,52,0,3,14,73,19,58,11,59,11,2,24,0,0,3,1,1,73,19,0,0,4,33,0,73,19,55,11,
  0,0,5,22,0,73,19,3,14,58,11,59,11,0,0,6,36,0,3,14,62,11,11,11,0,0,7,36,0,3,14,11,11,62,11,0,0,8,33,0,73,19,55,5,0,0,9,46,1,17,1,18,6,64,24,151,66,25,3,14,58,11,59,11,
  39,25,73,19,0,0,10,5,0,3,14,58,11,59,11,73,19,0,0,11,52,0,3,14,58,11,59,11,73,19,0,0,12,11,1,85,23,0,0,13,52,0,2,23,3,14,58,11,59,11,73,19,0,0,14,11,1,17,1,18,6,0,0,15,
  29,1,49,19,17,1,18,6,88,11,89,11,87,11,0,0,16,5,0,2,24,49,19,0,0,17,5,0,2,23,49,19,0,0,18,38,0,73,19,0,0,19,46,1,17,1,18,6,64,24,151,66,25,3,14,58,11,59,11,39,25,73,19,63,
  25,0,0,20,5,0,2,24,3,14,58,11,59,11,73,19,0,0,21,5,0,2,23,3,14,58,11,59,11,73,19,0,0,22,52,0,2,24,3,14,58,11,59,11,73,19,0,0,23,46,0,17,1,18,6,64,24,151,66,25,3,14,58,11,
  59,11,39,25,73,19,63,25,0,0,24,46,1,3,14,58,11,59,11,39,25,73,19,32,11,0,0,25,29,0,49,19,17,1,18,6,88,11,89,11,87,11,0,0,26,137,130,1,0,49,19,17,1,0,0,27,5,0,28,13,49,19,0,0,
  28,52,0,2,23,49,19,0,0,29,52,0,2,24,49,19,0,0,30,29,1,49,19,85,23,88,11,89,11,87,11,0,0,31,29,0,49,19,17,1,18,6,88,11,89,11,0,0,32,46,1,17,1,18,6,64,24,151,66,25,49,19,0,0,
  33,52,0,49,19,0,0,34,15,0,0,0,35,19,1,11,11,58,11,59,11,0,0,36,13,0,3,14,73,19,58,11,59,11,56,11,0,0,37,15,0,73,19,0,0,0,0,234,37,11,46,100,101,98,117,103,95,105,110,102,111,218,18,0,
  0,4,0,0,0,0,0,4,1,252,2,0,0,29,0,135,2,0,0,0,0,0,0,18,0,0,0,0,0,0,0,32,2,0,0,2,84,2,0,0,55,0,0,0,1,5,5,3,192,0,16,0,3,67,0,0,0,4,85,0,0,0,64,0,
  5,78,0,0,0,245,2,0,0,1,3,6,227,0,0,0,6,1,7,225,2,0,0,8,7,2,166,1,0,0,109,0,0,0,1,6,5,3,0,1,16,0,3,122,0,0,0,8,85,0,0,0,135,3,0,6,126,0,0,0,5,4,2,78,
  0,0,0,146,0,0,0,1,7,5,3,32,15,16,0,3,159,0,0,0,8,85,0,0,0,0,2,0,5,170,0,0,0,248,2,0,0,1,4,6,117,0,0,0,7,4,2,55,2,0,0,122,0,0,0,1,82,5,3,32,23,16,0,2,
  125,1,0,0,122,0,0,0,1,82,5,3,36,23,16,0,2,38,2,0,0,122,0,0,0,1,82,5,3,40,23,16,0,2,107,0,0,0,122,0,0,0,1,82,5,3,44,23,16,0,9,215,4,0,0,223,1,0,0,7,237,3,0,0,
  0,0,159,225,1,0,0,1,18,140,18,0,0,2,14,2,0,0,190,2,0,0,1,20,5,3,128,0,16,0,2,156,1,0,0,190,2,0,0,1,20,5,3,160,0,16,0,10,162,0,0,0,1,18,209,18,0,0,10,111,0,0,0,1,
  18,122,0,0,0,10,9,1,0,0,1,18,209,18,0,0,10,10,0,0,0,1,18,209,18,0,0,10,95,0,0,0,1,18,122,0,0,0,10,59,2,0,0,1,18,122,0,0,0,10,116,1,0,0,1,18,122,0,0,0,10,105,1,0,
  0,1,18,122,0,0,0,11,230,1,0,0,1,19,140,18,0,0,12,0,0,0,0,13,239,4,0,0,73,1,0,0,1,21,122,0,0,0,12,24,0,0,0,13,40,5,0,0,239,0,0,0,1,22,122,0,0,0,13,84,5,0,0,51,
  1,0,0,1,22,122,0,0,0,13,128,5,0,0,9,2,0,0,1,22,122,0,0,0,13,172,5,0,0,104,2,0,0,1,25,122,0,0,0,14,190,5,0,0,111,0,0,0,13,201,5,0,0,71,1,0,0,1,26,122,0,0,0,15,
  225,3,0,0,223,5,0,0,9,0,0,0,1,26,38,16,4,237,0,11,159,237,3,0,0,0,0,14,85,6,0,0,68,0,0,0,13,18,6,0,0,90,2,0,0,1,32,122,0,0,0,13,92,6,0,0,126,2,0,0,1,31,122,0,
  0,0,11,41,1,0,0,1,30,122,0,0,0,15,225,3,0,0,100,6,0,0,7,0,0,0,1,31,24,16,4,237,0,7,159,237,3,0,0,0,15,249,3,0,0,107,6,0,0,10,0,0,0,1,31,16,17,48,6,0,0,5,4,0,
  0,0,15,225,3,0,0,128,6,0,0,7,0,0,0,1,32,24,16,4,237,0,7,159,237,3,0,0,0,15,249,3,0,0,135,6,0,0,10,0,0,0,1,32,16,17,230,5,0,0,5,4,0,0,0,0,0,0,0,3,202,2,0,0,
  4,85,0,0,0,8,0,18,122,0,0,0,2,176,1,0,0,190,2,0,0,1,8,5,3,0,0,16,0,2,221,0,0,0,190,2,0,0,1,9,5,3,32,0,16,0,2,154,0,0,0,2,3,0,0,1,10,5,3,64,0,16,0,3,
  202,2,0,0,4,85,0,0,0,16,0,6,225,0,0,0,8,1,6,75,1,0,0,7,4,19,255,255,255,255,181,0,0,0,7,237,3,0,0,0,0,159,140,0,0,0,1,13,139,18,0,0,20,4,237,0,0,159,255,0,0,0,1,13,
  139,18,0,0,20,4,237,0,1,159,180,1,0,0,1,13,122,0,0,0,21,0,0,0,0,111,0,0,0,1,13,21,3,0,0,22,4,237,0,0,159,221,2,0,0,1,13,180,18,0,0,14,255,255,255,255,178,0,0,0,13,30,0,0,
  0,73,1,0,0,1,13,21,3,0,0,0,0,23,2,0,0,0,8,0,0,0,7,237,3,0,0,0,0,159,195,0,0,0,1,14,122,0,0,0,23,11,0,0,0,8,0,0,0,7,237,3,0,0,0,0,159,184,0,0,0,1,15,122,
  0,0,0,23,20,0,0,0,8,0,0,0,7,237,3,0,0,0,0,159,174,0,0,0,1,16,122,0,0,0,24,186,1,0,0,1,11,122,0,0,0,1,10,16,0,0,0,1,11,122,0,0,0,0,24,23,1,0,0,1,12,122,0,0,
  0,1,10,223,2,0,0,1,12,122,0,0,0,10,221,2,0,0,1,12,122,0,0,0,0,19,30,0,0,0,183,4,0,0,4,237,0,3,159,201,1,0,0,1,39,122,0,0,0,21,245,1,0,0,59,2,0,0,1,39,122,0,0,0,
  21,215,1,0,0,145,1,0,0,1,39,122,0,0,0,21,185,1,0,0,134,1,0,0,1,39,122,0,0,0,22,3,145,176,4,242,0,0,0,1,40,185,18,0,0,22,3,145,144,4,254,0,0,0,1,40,185,18,0,0,22,3,145,144,
  2,195,1,0,0,1,40,197,18,0,0,22,2,145,16,65,1,0,0,1,40,197,18,0,0,22,2,145,8,223,2,0,0,1,50,140,18,0,0,22,2,145,0,215,2,0,0,1,51,140,18,0,0,13,86,0,0,0,163,1,0,0,1,40,
  122,0,0,0,13,199,0,0,0,173,1,0,0,1,40,122,0,0,0,13,28,1,0,0,219,1,0,0,1,40,122,0,0,0,13,113,1,0,0,217,2,0,0,1,40,122,0,0,0,13,156,1,0,0,220,2,0,0,1,40,122,0,0,0,
  13,19,2,0,0,129,2,0,0,1,40,122,0,0,0,13,62,2,0,0,132,2,0,0,1,40,122,0,0,0,13,17,4,0,0,230,1,0,0,1,61,214,18,0,0,11,85,0,0,0,1,41,209,18,0,0,11,156,1,0,0,1,41,209,
  18,0,0,14,185,0,0,0,95,1,0,0,13,105,2,0,0,239,0,0,0,1,42,122,0,0,0,14,185,0,0,0,80,1,0,0,13,149,2,0,0,159,0,0,0,1,44,122,0,0,0,13,179,2,0,0,0,2,0,0,1,44,122,0,
  0,0,13,237,2,0,0,172,0,0,0,1,44,122,0,0,0,11,255,0,0,0,1,43,122,0,0,0,25,225,3,0,0,205,0,0,0,17,0,0,0,1,44,25,0,0,14,195,2,0,0,33,1,0,0,13,25,3,0,0,239,0,0,0,
  1,54,122,0,0,0,14,195,2,0,0,8,1,0,0,13,69,3,0,0,172,0,0,0,1,56,122,0,0,0,13,99,3,0,0,9,2,0,0,1,56,122,0,0,0,11,255,0,0,0,1,55,122,0,0,0,11,0,2,0,0,1,56,122,
  0,0,0,25,225,3,0,0,235,2,0,0,9,0,0,0,1,56,14,14,3,3,0,0,127,0,0,0,13,184,3,0,0,97,2,0,0,1,58,122,0,0,0,14,3,3,0,0,111,0,0,0,13,129,3,0,0,177,1,0,0,1,58,122,
  0,0,0,14,3,3,0,0,111,0,0,0,11,16,0,0,0,1,58,122,0,0,0,0,0,0,14,131,3,0,0,72,0,0,0,13,213,3,0,0,245,0,0,0,1,57,209,18,0,0,13,243,3,0,0,9,1,0,0,1,57,209,18,0,
  0,0,0,0,14,37,4,0,0,140,0,0,0,13,47,4,0,0,151,1,0,0,1,63,122,0,0,0,13,91,4,0,0,208,0,0,0,1,63,122,0,0,0,13,135,4,0,0,0,0,0,0,1,65,122,0,0,0,13,209,4,0,0,28,
  2,0,0,1,64,122,0,0,0,11,214,0,0,0,1,63,122,0,0,0,15,225,3,0,0,60,4,0,0,13,0,0,0,1,64,22,16,4,237,0,13,159,237,3,0,0,0,15,225,3,0,0,88,4,0,0,7,0,0,0,1,64,46,16,
  4,237,0,6,159,237,3,0,0,0,15,249,3,0,0,95,4,0,0,10,0,0,0,1,64,14,16,4,237,0,13,159,5,4,0,0,17,165,4,0,0,16,4,0,0,0,15,225,3,0,0,129,4,0,0,11,0,0,0,1,65,51,16,4,
  237,0,12,159,237,3,0,0,0,15,225,3,0,0,150,4,0,0,7,0,0,0,1,65,22,16,4,237,0,12,159,237,3,0,0,0,0,26,245,0,0,0,62,2,0,0,26,245,0,0,0,97,2,0,0,0,19,183,6,0,0,15,0,0,
  0,7,237,3,0,0,0,0,159,56,1,0,0,1,81,122,0,0,0,20,4,237,0,0,159,59,2,0,0,1,81,122,0,0,0,20,4,237,0,1,159,151,1,0,0,1,81,122,0,0,0,26,192,7,0,0,197,6,0,0,0,9,200,6,
  0,0,71,4,0,0,7,237,3,0,0,0,0,159,120,2,0,0,1,70,122,0,0,0,20,4,237,0,0,159,249,1,0,0,1,70,122,0,0,0,21,196,6,0,0,47,2,0,0,1,70,122,0,0,0,13,122,6,0,0,9,2,0,0,
  1,71,122,0,0,0,13,152,6,0,0,51,1,0,0,1,71,122,0,0,0,13,226,6,0,0,237,0,0,0,1,71,122,0,0,0,12,56,0,0,0,13,14,7,0,0,73,1,0,0,1,73,122,0,0,0,12,152,0,0,0,13,160,7,
  0,0,178,1,0,0,1,73,122,0,0,0,13,18,8,0,0,205,0,0,0,1,73,122,0,0,0,0,0,14,8,9,0,0,194,0,0,0,13,188,8,0,0,73,1,0,0,1,74,122,0,0,0,14,38,9,0,0,141,0,0,0,11,178,
  1,0,0,1,75,122,0,0,0,11,205,0,0,0,1,75,122,0,0,0,14,116,9,0,0,63,0,0,0,11,255,0,0,0,1,76,122,0,0,0,0,0,0,12,248,0,0,0,13,3,9,0,0,73,1,0,0,1,78,122,0,0,0,12,
  56,1,0,0,11,178,1,0,0,1,78,122,0,0,0,11,205,0,0,0,1,78,122,0,0,0,0,0,0,24,135,0,0,0,1,83,122,0,0,0,1,10,36,1,0,0,1,83,122,0,0,0,10,6,1,0,0,1,83,122,0,0,0,10,
  13,1,0,0,1,83,122,0,0,0,10,168,0,0,0,1,83,122,0,0,0,11,89,1,0,0,1,84,122,0,0,0,11,111,2,0,0,1,84,122,0,0,0,11,246,1,0,0,1,86,122,0,0,0,11,64,2,0,0,1,86,122,0,0,
  0,11,31,1,0,0,1,86,122,0,0,0,11,1,1,0,0,1,86,122,0,0,0,11,73,2,0,0,1,86,122,0,0,0,11,147,0,0,0,1,84,122,0,0,0,11,33,2,0,0,1,94,122,0,0,0,0,19,17,11,0,0,242,9,
  0,0,7,237,3,0,0,0,0,159,210,1,0,0,1,107,122,0,0,0,21,153,9,0,0,59,2,0,0,1,107,122,0,0,0,21,243,9,0,0,96,1,0,0,1,107,122,0,0,0,21,213,9,0,0,251,0,0,0,1,107,122,0,0,
  0,21,123,9,0,0,151,1,0,0,1,107,122,0,0,0,21,183,9,0,0,42,2,0,0,1,107,122,0,0,0,14,169,11,0,0,89,9,0,0,13,17,10,0,0,36,1,0,0,1,109,122,0,0,0,12,120,1,0,0,13,61,10,0,
  0,0,2,0,0,1,111,122,0,0,0,13,95,10,0,0,51,1,0,0,1,111,122,0,0,0,13,125,10,0,0,9,2,0,0,1,111,122,0,0,0,13,11,16,0,0,93,2,0,0,1,129,122,0,0,0,13,55,16,0,0,89,0,0,
  0,1,129,122,0,0,0,11,255,0,0,0,1,110,122,0,0,0,25,225,3,0,0,209,11,0,0,23,0,0,0,1,111,14,14,244,11,0,0,85,3,0,0,13,169,10,0,0,5,2,0,0,1,113,122,0,0,0,11,249,0,0,0,1,
  113,122,0,0,0,11,89,0,0,0,1,113,122,0,0,0,11,13,1,0,0,1,113,122,0,0,0,15,224,8,0,0,70,12,0,0,173,0,0,0,1,116,67,27,0,2,9,0,0,27,1,13,9,0,0,28,213,10,0,0,24,9,0,0,
  29,2,48,159,35,9,0,0,28,254,10,0,0,46,9,0,0,28,27,11,0,0,57,9,0,0,28,69,11,0,0,68,9,0,0,28,98,11,0,0,79,9,0,0,28,127,11,0,0,90,9,0,0,15,225,3,0,0,123,12,0,0,15,0,
  0,0,1,94,22,16,15,237,0,23,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,14,244,12,0,0,85,2,0,0,13,169,11,0,0,177,1,0,0,1,118,122,0,0,0,14,244,12,0,0,85,2,0,0,13,211,11,
  0,0,6,1,0,0,1,119,122,0,0,0,11,178,1,0,0,1,119,122,0,0,0,30,224,8,0,0,144,1,0,0,1,121,25,17,27,12,0,0,2,9,0,0,17,69,12,0,0,13,9,0,0,28,111,12,0,0,24,9,0,0,28,177,
  12,0,0,46,9,0,0,28,19,13,0,0,57,9,0,0,28,61,13,0,0,68,9,0,0,28,103,13,0,0,79,9,0,0,28,145,13,0,0,90,9,0,0,28,23,14,0,0,35,9,0,0,30,225,3,0,0,168,1,0,0,1,94,22,
  17,213,13,0,0,237,3,0,0,0,0,0,0,0,14,137,15,0,0,7,1,0,0,11,73,1,0,0,1,126,122,0,0,0,14,137,15,0,0,251,0,0,0,13,65,14,0,0,237,0,0,0,1,126,122,0,0,0,13,109,14,0,0,178,
  1,0,0,1,126,122,0,0,0,13,153,14,0,0,6,1,0,0,1,126,122,0,0,0,15,224,8,0,0,225,15,0,0,163,0,0,0,1,126,150,17,197,14,0,0,2,9,0,0,17,239,14,0,0,13,9,0,0,28,25,15,0,0,24,
  9,0,0,28,66,15,0,0,35,9,0,0,28,96,15,0,0,46,9,0,0,28,125,15,0,0,57,9,0,0,28,167,15,0,0,68,9,0,0,28,196,15,0,0,79,9,0,0,28,225,15,0,0,90,9,0,0,15,225,3,0,0,25,16,
  0,0,15,0,0,0,1,94,22,16,15,237,0,4,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,0,0,14,168,16,0,0,41,2,0,0,13,99,16,0,0,73,1,0,0,1,130,122,0,0,0,14,233,16,0,0,210,
  1,0,0,11,178,1,0,0,1,131,122,0,0,0,11,237,0,0,0,1,131,122,0,0,0,14,77,17,0,0,110,1,0,0,11,6,1,0,0,1,133,122,0,0,0,15,224,8,0,0,109,17,0,0,132,0,0,0,1,134,27,27,0,2,
  9,0,0,27,0,13,9,0,0,28,157,16,0,0,24,9,0,0,29,2,48,159,35,9,0,0,28,198,16,0,0,46,9,0,0,28,227,16,0,0,57,9,0,0,28,13,17,0,0,68,9,0,0,28,42,17,0,0,79,9,0,0,28,71,
  17,0,0,90,9,0,0,15,225,3,0,0,143,17,0,0,15,0,0,0,1,94,22,16,15,237,0,20,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,15,224,8,0,0,40,18,0,0,147,0,0,0,1,135,46,27,0,
  2,9,0,0,27,0,13,9,0,0,28,113,17,0,0,24,9,0,0,28,154,17,0,0,46,9,0,0,28,183,17,0,0,57,9,0,0,28,225,17,0,0,68,9,0,0,28,254,17,0,0,79,9,0,0,28,27,18,0,0,90,9,0,0,
  28,69,18,0,0,35,9,0,0,15,225,3,0,0,72,18,0,0,15,0,0,0,1,94,22,16,15,237,0,1,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,0,0,0,0,0,26,218,14,0,0,28,12,0,0,26,192,
  7,0,0,158,12,0,0,26,218,14,0,0,55,13,0,0,26,192,7,0,0,186,13,0,0,26,218,14,0,0,97,14,0,0,26,192,7,0,0,228,14,0,0,26,192,7,0,0,50,16,0,0,26,192,7,0,0,168,17,0,0,26,192,7,
  0,0,97,18,0,0,26,192,7,0,0,34,19,0,0,26,192,7,0,0,46,19,0,0,26,192,7,0,0,58,19,0,0,26,233,17,0,0,74,19,0,0,26,192,7,0,0,155,19,0,0,26,192,7,0,0,167,19,0,0,26,192,7,0,
  0,179,19,0,0,26,233,17,0,0,195,19,0,0,26,192,7,0,0,32,20,0,0,26,192,7,0,0,44,20,0,0,26,192,7,0,0,56,20,0,0,26,233,17,0,0,72,20,0,0,26,192,7,0,0,154,20,0,0,26,192,7,0,0,
  166,20,0,0,26,192,7,0,0,178,20,0,0,26,233,17,0,0,194,20,0,0,0,9,5,21,0,0,193,3,0,0,7,237,3,0,0,0,0,159,130,0,0,0,1,103,122,0,0,0,20,4,237,0,0,159,36,1,0,0,1,103,122,0,
  0,0,21,99,18,0,0,6,1,0,0,1,103,122,0,0,0,21,129,18,0,0,41,1,0,0,1,103,122,0,0,0,30,224,8,0,0,192,1,0,0,1,104,37,17,173,18,0,0,2,9,0,0,17,215,18,0,0,13,9,0,0,28,1,
  19,0,0,24,9,0,0,28,67,19,0,0,101,9,0,0,28,133,19,0,0,35,9,0,0,28,163,19,0,0,46,9,0,0,28,205,19,0,0,57,9,0,0,28,4,20,0,0,68,9,0,0,28,46,20,0,0,79,9,0,0,28,88,20,
  0,0,90,9,0,0,15,225,3,0,0,120,21,0,0,15,0,0,0,1,94,22,16,15,237,0,2,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,30,224,8,0,0,216,1,0,0,1,105,10,17,143,20,0,0,2,9,
  0,0,17,185,20,0,0,13,9,0,0,28,227,20,0,0,101,9,0,0,28,37,21,0,0,24,9,0,0,28,78,21,0,0,46,9,0,0,28,120,21,0,0,57,9,0,0,28,175,21,0,0,68,9,0,0,28,217,21,0,0,79,9,0,
  0,28,3,22,0,0,90,9,0,0,28,58,22,0,0,35,9,0,0,15,225,3,0,0,57,22,0,0,15,0,0,0,1,94,22,16,15,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,30,224,8,0,0,240,
  1,0,0,1,105,29,17,102,22,0,0,2,9,0,0,17,144,22,0,0,13,9,0,0,28,186,22,0,0,24,9,0,0,28,252,22,0,0,46,9,0,0,28,38,23,0,0,57,9,0,0,28,93,23,0,0,68,9,0,0,28,135,23,0,
  0,79,9,0,0,28,177,23,0,0,90,9,0,0,15,225,3,0,0,237,22,0,0,15,0,0,0,1,94,22,16,15,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,30,224,8,0,0,8,2,0,0,1,105,
  48,17,232,23,0,0,2,9,0,0,17,18,24,0,0,13,9,0,0,28,60,24,0,0,24,9,0,0,28,126,24,0,0,46,9,0,0,28,168,24,0,0,57,9,0,0,28,223,24,0,0,68,9,0,0,28,9,25,0,0,79,9,0,0,
  28,51,25,0,0,90,9,0,0,15,225,3,0,0,163,23,0,0,15,0,0,0,1,94,22,16,15,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,15,224,8,0,0,31,24,0,0,118,0,0,0,1,105,67,
  27,2,2,9,0,0,27,0,13,9,0,0,28,106,25,0,0,24,9,0,0,28,147,25,0,0,46,9,0,0,28,176,25,0,0,57,9,0,0,28,218,25,0,0,68,9,0,0,28,247,25,0,0,79,9,0,0,28,20,26,0,0,90,9,
  0,0,15,225,3,0,0,66,24,0,0,15,0,0,0,1,94,22,16,15,237,0,7,18,16,7,37,48,32,30,16,8,36,33,159,237,3,0,0,0,0,31,224,8,0,0,150,24,0,0,44,0,0,0,1,0,26,192,7,0,0,155,21,0,
  0,26,192,7,0,0,87,22,0,0,26,192,7,0,0,6,23,0,0,26,192,7,0,0,188,23,0,0,26,192,7,0,0,91,24,0,0,0,32,200,24,0,0,254,1,0,0,7,237,3,0,0,0,0,159,224,8,0,0,17,188,26,0,0,
  236,8,0,0,16,4,237,0,1,159,247,8,0,0,17,158,26,0,0,2,9,0,0,16,4,237,0,3,159,13,9,0,0,28,62,26,0,0,101,9,0,0,28,128,26,0,0,35,9,0,0,28,218,26,0,0,24,9,0,0,28,248,26,0,
  0,46,9,0,0,28,49,27,0,0,57,9,0,0,28,78,27,0,0,68,9,0,0,28,107,27,0,0,79,9,0,0,28,164,27,0,0,90,9,0,0,33,112,9,0,0,25,225,3,0,0,236,25,0,0,11,0,0,0,1,94,22,26,192,
  7,0,0,4,26,0,0,0,34,5,151,18,0,0,236,1,0,0,1,17,35,8,1,17,36,163,1,0,0,122,0,0,0,1,17,0,36,173,1,0,0,122,0,0,0,1,17,4,0,37,14,3,0,0,3,122,0,0,0,4,85,0,0,0,
  8,0,3,122,0,0,0,4,85,0,0,0,64,0,37,202,2,0,0,6,21,2,0,0,4,8,0,0,142,5,13,46,100,101,98,117,103,95,114,97,110,103,101,115,231,4,0,0,241,4,0,0,77,5,0,0,181,6,0,0,0,0,0,0,
  0,0,0,0,238,4,0,0,241,4,0,0,77,5,0,0,153,6,0,0,167,6,0,0,181,6,0,0,0,0,0,0,0,0,0,0,37,7,0,0,71,7,0,0,100,7,0,0,156,7,0,0,171,7,0,0,237,7,0,0,245,7,0,0,
  29,8,0,0,47,8,0,0,127,8,0,0,137,8,0,0,175,8,0,0,189,8,0,0,4,9,0,0,251,9,0,0,252,9,0,0,32,10,0,0,33,10,0,0,74,10,0,0,75,10,0,0,233,10,0,0,234,10,0,0,0,0,0,0,
  0,0,0,0,37,7,0,0,71,7,0,0,100,7,0,0,156,7,0,0,178,7,0,0,237,7,0,0,245,7,0,0,29,8,0,0,47,8,0,0,127,8,0,0,137,8,0,0,175,8,0,0,189,8,0,0,4,9,0,0,251,9,0,0,
  252,9,0,0,32,10,0,0,33,10,0,0,74,10,0,0,75,10,0,0,233,10,0,0,234,10,0,0,0,0,0,0,0,0,0,0,202,9,0,0,235,9,0,0,252,9,0,0,25,10,0,0,33,10,0,0,64,10,0,0,75,10,0,0,
  107,10,0,0,121,10,0,0,189,10,0,0,193,10,0,0,223,10,0,0,234,10,0,0,3,11,0,0,0,0,0,0,0,0,0,0,202,9,0,0,235,9,0,0,252,9,0,0,25,10,0,0,33,10,0,0,64,10,0,0,75,10,0,0,
  107,10,0,0,121,10,0,0,189,10,0,0,193,10,0,0,223,10,0,0,234,10,0,0,3,11,0,0,0,0,0,0,0,0,0,0,169,11,0,0,196,20,0,0,224,20,0,0,2,21,0,0,0,0,0,0,0,0,0,0,68,13,0,0,
  29,14,0,0,110,14,0,0,73,15,0,0,0,0,0,0,0,0,0,0,158,13,0,0,173,13,0,0,200,14,0,0,215,14,0,0,0,0,0,0,0,0,0,0,24,21,0,0,184,21,0,0,192,21,0,0,223,21,0,0,0,0,0,0,
  0,0,0,0,224,21,0,0,133,22,0,0,137,22,0,0,201,22,0,0,0,0,0,0,0,0,0,0,202,22,0,0,37,23,0,0,41,23,0,0,105,23,0,0,0,0,0,0,0,0,0,0,106,23,0,0,219,23,0,0,223,23,0,0,
  30,24,0,0,0,0,0,0,0,0,0,0,254,255,255,255,254,255,255,255,2,0,0,0,10,0,0,0,11,0,0,0,19,0,0,0,20,0,0,0,28,0,0,0,30,0,0,0,213,4,0,0,215,4,0,0,182,6,0,0,183,6,0,0,
  198,6,0,0,200,6,0,0,15,11,0,0,17,11,0,0,3,21,0,0,5,21,0,0,198,24,0,0,200,24,0,0,198,26,0,0,0,0,0,0,0,0,0,0,0,240,6,10,46,100,101,98,117,103,95,115,116,114,112,114,111,120,105,109,
  105,116,121,0,101,110,101,109,121,0,120,0,67,58,47,85,115,101,114,115,47,106,97,121,109,99,47,68,111,99,117,109,101,110,116,115,47,67,111,100,101,120,47,50,48,50,54,45,48,57,45,49,57,47,103,111,47,119,111,114,107,47,97,114,
  109,120,45,110,101,120,116,0,111,117,116,112,117,116,0,112,115,116,0,115,116,97,114,116,0,101,110,101,109,121,95,99,111,117,110,116,0,103,101,110,95,99,111,117,110,116,0,117,110,115,105,103,110,101,100,32,105,110,116,0,112,97,119,110,
  95,101,109,105,116,0,109,101,109,115,101,116,0,116,97,114,103,101,116,0,100,105,114,115,0,112,115,0,112,97,119,110,115,0,102,108,97,103,115,0,109,111,118,101,115,95,112,116,114,0,99,111,110,102,105,103,95,112,116,114,0,98,111,97,
  114,100,95,112,116,114,0,110,114,0,108,111,115,101,114,0,119,105,110,110,101,114,0,110,100,114,0,117,110,115,105,103,110,101,100,32,99,104,97,114,0,115,113,0,119,112,0,111,112,112,0,115,116,101,112,0,98,112,0,114,111,111,107,95,
  116,111,0,111,119,110,0,112,114,111,109,111,116,105,111,110,0,109,97,120,105,109,117,109,0,114,111,111,107,95,102,114,111,109,0,112,114,111,109,111,116,105,111,110,95,114,97,110,107,0,105,110,95,99,104,101,99,107,0,98,108,97,99,107,
  0,106,0,105,0,117,110,115,105,103,110,101,100,32,108,111,110,103,0,109,111,118,105,110,103,0,99,97,115,116,108,105,110,103,0,101,110,101,109,121,95,107,105,110,103,0,111,119,110,95,107,105,110,103,0,103,101,110,95,107,105,110,103,0,
  98,108,97,99,107,95,107,105,110,103,0,119,104,105,116,101,95,107,105,110,103,0,101,110,100,105,110,103,0,109,103,0,99,111,110,102,105,103,0,101,103,0,110,100,102,0,118,97,108,117,101,0,97,98,115,111,108,117,116,101,0,119,104,105,
  116,101,0,101,118,97,108,117,97,116,101,0,103,101,110,101,114,97,116,101,0,112,104,97,115,101,0,112,97,119,110,95,115,99,111,114,101,0,80,97,119,110,83,99,111,114,101,0,101,112,95,115,113,117,97,114,101,0,116,121,112,101,0,111,
  110,101,0,102,105,108,101,0,109,105,100,100,108,101,0,100,111,117,98,108,101,0,101,100,103,101,0,115,97,102,101,0,103,101,110,95,109,111,100,101,0,98,121,95,115,105,100,101,0,103,101,110,95,115,105,100,101,0,101,112,95,112,105,101,
  99,101,0,114,111,111,107,95,112,105,101,99,101,0,98,111,97,114,100,0,111,100,0,101,110,100,0,115,104,105,101,108,100,0,112,97,115,115,101,100,0,99,97,112,116,117,114,101,100,0,97,116,116,97,99,107,101,100,0,119,99,0,98,99,
  0,67,58,92,85,115,101,114,115,92,106,97,121,109,99,92,68,111,99,117,109,101,110,116,115,92,67,111,100,101,120,92,50,48,50,54,45,48,57,45,49,57,92,103,111,92,119,111,114,107,92,97,114,109,120,45,110,101,120,116,92,110,97,116,
  105,118,101,47,118,53,95,53,95,104,101,108,112,101,114,115,46,99,0,119,98,0,98,98,0,97,0,95,95,65,82,82,65,89,95,83,73,90,69,95,84,89,80,69,95,95,0,105,56,0,117,51,50,0,99,108,97,110,103,32,118,101,114,115,
  105,111,110,32,49,57,46,49,46,55,32,40,104,116,116,112,115,58,47,47,103,105,116,104,117,98,46,99,111,109,47,122,105,103,108,97,110,103,47,122,105,103,45,98,111,111,116,115,116,114,97,112,32,100,101,49,98,48,49,97,56,99,49,100,
  100,100,102,55,53,97,53,54,48,49,50,51,97,99,49,99,50,97,98,49,56,50,98,52,56,51,48,100,97,41,0,0,170,43,11,46,100,101,98,117,103,95,108,105,110,101,154,21,0,0,4,0,105,0,0,0,1,1,1,251,14,13,0,1,
  1,1,1,0,0,0,1,0,0,1,67,58,92,85,115,101,114,115,92,106,97,121,109,99,92,68,111,99,117,109,101,110,116,115,92,67,111,100,101,120,92,50,48,50,54,45,48,57,45,49,57,92,103,111,92,119,111,114,107,92,97,114,109,120,
  45,110,101,120,116,92,110,97,116,105,118,101,0,0,118,53,95,53,95,104,101,108,112,101,114,115,46,99,0,1,0,0,0,5,72,10,0,5,2,255,255,255,255,3,12,1,6,3,115,116,3,13,74,3,115,242,3,13,74,5,106,116,5,110,
  116,3,115,116,3,13,74,3,115,102,3,13,74,3,115,102,3,13,74,3,115,102,3,13,74,3,115,102,3,13,74,3,115,102,3,13,74,3,115,102,3,13,74,5,103,186,5,72,32,5,110,8,46,3,115,144,5,72,3,13,74,5,132,1,
  214,2,3,0,1,1,5,21,10,0,5,2,3,0,0,0,3,13,1,2,7,0,1,1,5,22,10,0,5,2,12,0,0,0,3,14,1,2,7,0,1,1,5,21,10,0,5,2,21,0,0,0,3,15,1,2,7,0,1,1,0,5,2,30,
  0,0,0,3,38,1,5,35,10,8,103,5,45,6,2,44,18,3,88,2,44,1,5,11,6,3,43,2,44,1,5,24,6,74,3,85,88,5,12,6,3,44,74,5,35,3,95,116,6,3,117,200,5,25,6,3,45,74,5,40,115,5,12,6,
  88,5,40,32,3,84,60,5,25,6,3,45,46,5,62,6,158,5,12,130,5,61,172,5,11,6,115,5,47,61,5,44,6,60,3,83,88,5,25,3,45,130,5,24,74,5,10,60,5,7,60,3,83,88,5,19,6,3,46,172,6,3,82,102,
  5,35,3,46,130,5,31,32,3,82,46,5,10,3,46,32,3,82,116,5,45,3,46,116,5,41,60,5,10,32,3,82,88,5,12,6,3,47,74,5,8,6,32,3,81,46,5,0,3,47,74,5,12,6,141,5,20,35,5,36,6,46,5,47,
  186,5,25,88,5,33,186,5,44,8,18,5,51,60,3,81,46,5,68,3,47,32,5,79,172,5,57,88,5,65,186,5,76,8,18,3,81,60,5,12,6,3,44,242,6,3,84,60,5,26,6,3,48,74,5,24,6,60,3,80,46,5,36,3,
  48,88,3,80,60,5,24,6,3,42,88,6,3,86,32,5,18,3,42,88,5,3,32,5,15,6,68,2,38,19,5,9,2,35,19,5,14,6,88,5,11,88,5,5,32,5,6,6,117,5,8,6,116,5,6,32,3,75,60,5,31,3,53,74,
  5,33,116,5,31,32,5,23,6,87,5,28,6,88,5,25,88,5,19,32,3,76,60,5,6,6,3,53,74,5,31,6,158,3,75,130,5,11,6,3,55,242,6,3,73,144,5,29,6,3,56,130,5,28,6,32,3,72,88,5,44,3,56,74,
  3,72,60,5,35,6,3,11,158,5,8,3,46,144,6,3,71,116,5,68,6,3,58,130,6,3,70,214,5,112,3,58,74,3,70,102,5,120,3,58,158,5,128,1,74,3,70,60,5,112,3,58,116,3,70,60,5,120,3,58,186,5,128,1,
  74,5,108,32,3,70,60,5,68,3,58,116,3,70,60,5,112,3,58,74,3,70,102,5,120,3,58,186,5,128,1,74,5,108,32,3,70,60,5,147,1,3,58,32,5,154,1,116,5,144,1,32,3,70,88,5,32,6,3,57,60,6,3,71,
  228,5,61,3,57,74,5,60,116,3,71,46,5,47,3,57,74,5,79,228,5,77,116,5,74,60,3,71,88,5,101,3,57,74,5,98,32,3,71,88,5,24,6,3,54,88,6,3,74,32,5,18,3,54,88,5,3,32,3,74,60,5,6,6,
  3,60,158,5,19,47,5,32,6,116,5,28,60,5,25,32,5,16,32,5,40,158,3,67,60,5,11,6,3,62,102,5,14,6,32,3,66,46,3,62,242,3,66,60,5,18,6,3,63,158,5,32,6,32,3,65,60,5,39,6,3,192,0,74,
  5,32,6,88,5,42,60,3,64,60,5,35,6,3,11,74,6,3,117,144,5,63,6,3,192,0,74,5,56,6,88,5,67,60,3,64,60,5,35,6,3,11,74,5,40,117,6,3,116,130,5,24,6,3,194,0,46,6,3,190,127,32,5,68,
  6,3,63,46,6,3,65,116,5,65,6,3,193,0,74,5,69,6,32,3,191,127,88,5,35,6,3,11,74,5,36,3,54,172,5,39,6,32,3,191,127,88,5,35,6,3,11,74,5,50,3,54,116,6,3,191,127,46,5,37,6,3,194,0,
  46,5,27,6,32,5,18,88,5,12,102,5,10,32,3,190,127,60,5,3,6,3,196,0,32,5,37,6,186,5,41,88,5,15,172,5,10,32,5,46,74,5,3,32,2,1,0,1,1,0,5,2,215,4,0,0,3,17,1,5,13,10,117,6,
  3,109,60,5,16,6,3,21,102,5,3,6,32,3,107,46,6,3,37,116,6,3,91,32,5,8,6,3,23,2,91,1,5,12,171,6,3,106,88,5,28,3,22,74,3,106,32,5,8,6,3,23,74,5,17,6,144,5,8,32,5,16,6,8,
  19,6,3,104,172,5,18,3,24,74,5,30,74,3,104,46,5,38,3,24,74,5,40,32,3,104,46,5,42,3,24,32,5,8,88,3,104,46,5,77,3,24,88,5,64,116,3,104,60,5,5,6,3,26,158,6,3,102,46,5,48,3,26,130,
  5,56,200,5,59,32,3,102,88,5,35,6,3,11,74,5,65,3,15,144,5,68,6,32,3,102,46,5,38,3,26,116,5,86,46,5,71,88,3,102,74,5,98,3,26,32,5,38,88,3,102,46,5,18,3,26,88,5,5,130,3,102,8,102,
  5,17,6,3,28,74,5,40,6,144,5,38,74,5,17,200,5,15,74,5,14,6,117,5,10,6,32,5,47,6,48,6,3,97,172,5,35,6,3,11,74,5,40,117,5,45,3,20,158,6,3,96,116,5,35,6,3,11,74,5,40,117,5,22,
  3,21,158,5,26,6,32,5,31,60,5,17,32,3,95,60,5,24,6,3,21,88,5,16,6,32,5,3,88,5,0,3,107,60,5,3,6,3,37,214,2,1,0,1,1,0,5,2,183,6,0,0,3,208,0,1,5,54,10,88,5,40,6,60,
  5,33,102,2,1,0,1,1,0,5,2,200,6,0,0,3,197,0,1,5,18,10,117,6,3,185,127,60,5,32,3,199,0,130,5,42,32,3,185,127,88,5,10,6,3,200,0,74,6,3,184,127,60,5,0,3,200,0,74,5,26,60,5,37,
  116,5,28,200,5,45,74,5,20,60,3,184,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,71,6,3,200,0,88,5,73,6,32,3,184,127,46,5,49,6,3,201,0,228,6,3,183,127,32,5,64,3,201,0,74,3,183,127,60,5,
  49,3,201,0,74,3,183,127,32,5,64,3,201,0,74,3,183,127,8,18,5,84,6,3,200,0,32,5,75,6,172,5,92,74,5,67,60,3,184,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,34,6,3,201,0,88,6,3,183,127,
  60,5,49,3,201,0,172,3,183,127,60,5,64,3,201,0,102,3,183,127,60,3,201,0,74,3,183,127,60,5,92,3,201,0,102,5,94,32,5,84,60,5,97,158,5,60,32,3,183,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,
  64,6,3,201,0,8,46,5,34,6,116,3,183,127,60,5,49,3,201,0,74,3,183,127,32,5,64,3,201,0,74,3,183,127,158,3,201,0,74,3,183,127,60,5,92,3,201,0,102,5,94,32,5,84,60,5,97,158,5,60,32,3,183,127,
  46,5,1,6,3,208,0,46,6,3,176,127,32,5,49,6,3,201,0,88,6,3,183,127,60,5,64,3,201,0,172,3,183,127,60,5,92,3,201,0,102,5,94,32,5,84,60,5,97,158,3,183,127,60,5,1,6,3,208,0,46,6,3,176,
  127,32,5,49,6,3,201,0,228,6,3,183,127,32,5,64,3,201,0,74,3,183,127,116,5,92,3,201,0,102,5,94,32,5,84,60,5,97,158,5,60,32,3,183,127,46,5,34,3,201,0,116,3,183,127,32,5,64,3,201,0,74,3,183,
  127,60,3,201,0,74,3,183,127,60,5,92,3,201,0,102,5,94,32,5,84,60,5,97,158,5,60,32,3,183,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,34,6,3,201,0,116,6,3,183,127,32,5,64,3,201,0,74,3,183,
  127,60,3,201,0,74,3,183,127,60,5,92,3,201,0,102,5,94,32,5,84,60,5,97,158,5,60,32,3,183,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,64,6,3,201,0,172,6,3,183,127,144,5,92,3,201,0,102,5,94,
  32,5,84,60,5,97,158,5,60,32,3,183,127,46,5,64,3,201,0,116,3,183,127,144,5,92,3,201,0,102,5,94,32,5,84,60,5,97,158,5,60,32,3,183,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,3,6,3,202,0,
  32,6,3,182,127,8,88,5,16,6,3,203,0,130,5,32,6,8,102,5,5,6,131,6,3,180,127,8,186,5,15,3,204,0,130,3,180,127,60,3,204,0,74,5,58,60,5,41,214,5,58,116,5,65,8,18,5,76,88,3,180,127,46,5,
  91,3,204,0,130,5,90,32,5,88,32,5,79,60,5,64,60,3,180,127,46,5,21,6,3,202,0,88,6,3,182,127,60,5,16,3,202,0,74,5,3,32,3,182,127,60,5,70,6,3,206,0,116,6,3,178,127,158,5,98,3,206,0,102,
  5,100,32,5,90,60,5,103,158,5,66,32,3,178,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,64,6,3,201,0,200,5,70,37,6,3,178,127,102,5,98,3,206,0,102,5,100,32,5,90,60,5,103,158,5,66,32,3,178,127,
  46,5,64,6,3,201,0,116,5,70,37,6,3,178,127,130,5,98,3,206,0,102,5,100,32,5,90,60,5,103,158,5,66,32,3,178,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,64,6,3,201,0,116,5,70,37,6,3,178,127,
  46,3,206,0,74,3,178,127,60,5,98,3,206,0,102,5,100,32,5,90,60,5,103,158,5,66,32,3,178,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,70,6,3,206,0,172,6,3,178,127,144,5,98,3,206,0,102,5,100,32,
  5,90,60,5,103,158,5,66,32,3,178,127,46,5,70,3,206,0,32,3,178,127,186,5,98,3,206,0,102,5,100,32,5,90,60,5,103,158,5,66,32,3,178,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,70,6,3,206,0,32,
  6,3,178,127,116,5,98,3,206,0,102,5,100,32,5,90,60,5,103,158,5,66,32,3,178,127,46,5,1,6,3,208,0,46,6,3,176,127,32,5,64,6,3,201,0,116,5,70,37,6,3,178,127,46,5,98,3,206,0,102,5,100,32,5,
  90,60,5,103,158,5,66,32,3,178,127,46,5,1,6,3,208,0,46,6,3,176,127,32,3,208,0,102,2,3,0,1,1,5,11,10,0,5,2,20,11,0,0,3,235,0,1,5,25,6,46,5,11,144,5,39,200,5,11,144,5,54,74,5,
  11,144,3,148,127,2,89,1,6,3,238,0,214,5,28,6,102,3,146,127,88,5,32,3,238,0,130,5,31,32,5,40,32,5,26,60,3,146,127,46,5,35,6,3,239,0,172,3,156,127,60,6,3,117,8,60,5,8,6,3,240,0,60,6,
  3,144,127,32,3,240,0,74,3,144,127,102,5,71,6,3,241,0,32,6,3,143,127,116,5,16,6,3,242,0,74,6,3,142,127,60,5,27,3,242,0,130,5,10,74,5,12,6,47,6,186,3,141,127,46,5,31,6,3,244,0,88,6,3,
  140,127,46,5,0,3,244,0,74,5,31,32,5,57,88,5,47,200,5,65,102,3,140,127,46,5,6,6,3,213,0,46,5,14,6,172,5,17,32,5,14,6,45,6,3,172,127,116,6,3,215,0,74,5,26,6,60,3,169,127,116,5,22,6,
  3,222,0,74,5,14,3,118,116,5,35,3,183,127,116,5,38,3,211,0,228,5,22,6,32,5,27,6,3,121,88,5,54,123,5,13,6,32,5,14,6,133,5,31,6,172,5,6,6,61,6,3,158,127,74,5,14,6,3,227,0,74,5,6,
  6,32,3,157,127,46,5,19,6,3,228,0,74,6,3,156,127,8,46,5,3,3,228,0,74,5,37,186,5,59,88,5,95,32,5,22,158,3,156,127,60,5,45,6,3,247,0,32,6,3,137,127,116,5,0,3,247,0,74,3,137,127,32,5,
  45,3,247,0,74,3,137,127,60,5,12,6,3,248,0,158,5,21,6,102,3,136,127,88,5,34,3,248,0,130,5,25,32,5,42,32,5,12,60,5,55,46,186,3,136,127,88,5,19,6,3,249,0,32,5,23,6,88,5,14,6,3,91,46,
  6,3,172,127,116,6,3,215,0,74,5,26,6,60,5,27,172,5,36,6,173,5,27,6,32,3,168,127,32,5,48,3,216,0,130,3,168,127,130,5,81,3,216,0,74,3,168,127,60,5,6,6,3,213,0,46,5,22,3,9,200,5,14,3,
  118,116,5,35,3,183,127,116,5,38,3,211,0,228,5,22,6,32,5,54,60,5,13,60,5,15,6,216,5,6,6,32,5,35,46,3,160,127,116,5,14,6,3,225,0,32,5,31,6,116,5,6,6,117,6,3,158,127,74,5,14,6,3,227,
  0,74,5,6,6,32,3,157,127,46,5,19,6,3,228,0,74,5,3,6,8,102,5,59,186,5,95,32,5,22,186,3,156,127,60,5,45,6,3,247,0,88,6,3,137,127,60,5,0,3,247,0,74,3,137,127,32,5,45,3,247,0,74,3,
  137,127,60,5,12,6,3,248,0,158,5,21,6,102,3,136,127,88,5,34,3,248,0,130,5,25,32,5,42,32,5,12,60,5,55,46,186,3,136,127,88,5,19,6,3,249,0,32,5,23,6,88,5,14,6,3,91,46,6,3,172,127,116,6,
  3,215,0,74,5,26,6,60,5,27,172,5,36,6,173,5,27,6,32,3,168,127,32,5,48,3,216,0,130,3,168,127,130,5,81,3,216,0,74,3,168,127,60,5,6,6,3,213,0,46,5,22,3,9,200,5,14,3,118,116,5,35,3,183,
  127,116,5,38,3,211,0,228,5,22,6,32,5,54,60,5,13,60,5,15,6,216,5,6,6,32,5,35,46,3,160,127,116,5,14,6,3,225,0,32,5,31,6,116,5,6,6,117,6,3,158,127,74,5,14,6,3,227,0,74,5,6,6,32,
  3,157,127,46,5,19,6,3,228,0,74,5,3,6,8,102,5,59,186,5,95,32,5,22,186,5,3,6,61,6,3,155,127,46,5,39,6,3,254,0,2,64,1,5,38,6,74,3,130,127,60,5,66,3,254,0,74,3,130,127,60,5,0,3,
  254,0,130,3,130,127,116,5,66,3,254,0,74,3,130,127,60,5,99,3,254,0,130,5,101,32,3,130,127,60,5,109,3,254,0,130,5,118,102,3,130,127,88,5,131,1,3,254,0,130,5,122,32,5,139,1,32,5,148,1,60,3,130,127,
  46,5,52,6,3,212,0,102,5,17,145,6,3,171,127,46,3,213,0,158,3,171,127,46,5,14,6,3,212,0,32,6,3,172,127,116,6,3,215,0,74,5,26,6,60,5,14,6,113,5,35,3,183,127,172,5,38,3,211,0,228,5,22,6,
  32,5,13,32,5,14,6,161,5,31,6,116,5,6,6,117,6,3,158,127,74,6,3,227,0,88,6,3,157,127,46,5,19,6,3,228,0,102,6,3,156,127,158,5,3,3,228,0,74,5,74,186,5,59,88,5,37,88,5,95,32,5,22,88,
  3,156,127,116,5,20,6,3,254,0,88,5,7,6,32,3,130,127,102,5,19,6,3,129,1,130,5,15,6,60,3,255,126,32,5,35,3,129,1,158,5,31,32,5,22,6,33,5,5,6,60,3,254,126,46,5,18,6,3,131,1,2,60,1,
  5,33,6,144,5,7,6,131,5,18,143,5,7,131,5,17,6,2,45,18,3,252,126,214,3,132,1,74,5,13,6,62,5,12,6,8,74,3,250,126,74,5,17,6,3,213,0,116,5,14,45,6,3,172,127,116,6,3,215,0,74,5,26,6,
  60,5,14,6,113,5,35,3,183,127,172,5,38,3,211,0,228,5,22,6,32,5,13,32,5,14,6,161,5,31,6,172,5,6,6,61,6,3,158,127,74,6,3,227,0,88,6,3,157,127,46,5,19,6,3,228,0,102,5,3,6,214,5,19,
  130,5,59,144,5,19,32,5,22,32,3,156,127,116,5,12,6,3,136,1,32,6,3,248,126,2,37,1,6,3,134,1,32,5,28,145,5,19,6,32,5,36,32,5,44,60,5,14,6,3,77,46,6,3,172,127,116,6,3,215,0,74,5,26,
  6,60,5,14,6,113,5,35,3,183,127,172,5,38,3,211,0,228,5,22,6,32,5,13,32,5,14,6,161,5,31,6,116,5,6,6,117,6,3,158,127,74,6,3,227,0,88,6,3,157,127,46,5,19,6,3,228,0,102,5,3,6,214,3,
  156,127,8,74,5,74,3,228,0,46,3,156,127,32,5,59,3,228,0,74,5,95,32,5,22,116,3,156,127,60,5,28,6,3,130,1,144,5,22,6,32,5,5,88,5,15,6,3,9,172,6,3,245,126,46,3,139,1,74,3,245,126,60,3,
  139,1,74,5,22,6,61,6,3,244,126,116,3,140,1,228,3,244,126,60,3,140,1,200,3,244,126,46,3,140,1,200,3,244,126,46,5,60,3,140,1,74,5,74,102,3,244,126,46,5,77,3,140,1,74,5,91,102,3,244,126,46,5,94,
  3,140,1,74,5,108,102,3,244,126,46,5,110,3,140,1,130,5,10,102,3,244,126,46,5,22,6,3,141,1,32,6,3,243,126,88,3,141,1,228,3,243,126,60,3,141,1,200,3,243,126,46,3,141,1,200,3,243,126,46,3,141,1,200,
  3,243,126,46,5,71,3,141,1,74,5,85,102,3,243,126,46,5,88,3,141,1,74,5,102,102,3,243,126,46,5,105,3,141,1,74,5,119,102,3,243,126,46,5,121,3,141,1,130,5,10,102,3,243,126,88,5,21,6,3,142,1,102,6,
  3,242,126,46,3,142,1,74,3,242,126,60,3,142,1,74,5,22,6,61,6,3,241,126,116,3,143,1,242,3,241,126,60,3,143,1,200,3,241,126,46,3,143,1,200,3,241,126,46,5,64,3,143,1,74,5,78,102,3,241,126,46,5,81,
  3,143,1,74,5,95,102,3,241,126,46,5,98,3,143,1,74,5,112,102,3,241,126,46,5,114,3,143,1,130,5,10,102,3,241,126,46,5,22,6,3,144,1,32,6,3,240,126,88,3,144,1,242,3,240,126,60,3,144,1,200,3,240,126,
  46,3,144,1,200,3,240,126,46,3,144,1,200,3,240,126,46,5,76,3,144,1,74,5,90,102,3,240,126,46,5,93,3,144,1,74,5,107,102,3,240,126,46,5,110,3,144,1,74,5,124,102,3,240,126,46,5,126,3,144,1,130,5,10,
  102,3,240,126,46,5,3,6,3,237,0,88,5,22,6,116,5,30,116,3,147,127,32,5,22,3,237,0,88,5,3,32,5,10,6,3,34,46,5,1,2,34,23,2,1,0,1,1,0,5,2,5,21,0,0,3,230,0,1,5,9,10,201,5,
  13,6,32,5,6,60,5,33,6,3,108,46,5,52,6,144,5,6,6,117,5,14,6,8,46,5,17,32,3,171,127,116,5,14,6,3,212,0,144,5,27,133,5,14,6,130,5,26,60,5,27,116,5,22,6,81,5,14,3,118,116,5,35,3,
  183,127,116,5,38,3,211,0,228,5,22,6,32,5,27,6,3,121,32,5,54,179,5,13,6,32,5,14,6,133,5,31,6,116,5,6,6,117,6,3,158,127,74,5,14,6,3,227,0,102,5,6,6,32,3,157,127,46,5,1,6,3,234,0,
  46,6,3,150,127,32,5,37,6,3,228,0,88,6,3,156,127,214,5,74,3,228,0,46,5,95,32,5,59,88,5,95,32,5,3,6,103,6,3,155,127,46,5,14,6,3,212,0,32,5,33,6,130,5,52,32,5,14,116,5,6,6,243,5,
  14,76,5,6,58,5,27,76,5,26,6,186,5,6,6,58,5,22,3,9,228,5,14,3,118,116,5,35,3,183,127,144,5,38,3,211,0,228,5,22,6,32,5,6,6,3,119,32,5,54,3,9,46,5,13,6,60,5,14,6,161,5,31,6,
  116,5,52,6,3,115,200,5,6,3,14,144,6,3,158,127,102,5,14,6,3,227,0,102,5,6,6,32,3,157,127,46,5,1,6,3,234,0,46,6,3,150,127,32,5,19,6,3,228,0,32,5,3,6,8,158,5,37,186,5,59,88,5,95,
  32,5,74,88,5,95,32,5,22,158,3,156,127,60,5,14,6,3,212,0,32,6,3,172,127,116,6,3,215,0,74,5,27,6,144,5,26,32,5,14,6,57,5,35,3,183,127,172,5,38,3,211,0,228,5,22,6,32,5,13,32,5,14,6,
  161,5,31,6,116,5,6,6,117,6,3,158,127,102,5,14,6,3,227,0,102,5,6,6,32,3,157,127,46,5,1,6,3,234,0,46,6,3,150,127,32,5,19,6,3,228,0,32,5,3,6,8,158,5,37,186,5,74,88,5,95,32,5,59,
  88,5,95,32,5,22,158,3,156,127,60,5,14,6,3,212,0,32,6,3,172,127,242,6,3,215,0,130,57,5,26,133,5,27,6,116,5,26,32,5,14,6,57,5,35,3,183,127,172,5,38,3,211,0,228,5,22,6,32,5,13,32,5,14,
  6,161,5,31,6,116,5,6,6,117,6,3,158,127,102,5,14,6,3,227,0,102,5,6,6,32,3,157,127,46,5,1,6,3,234,0,46,6,3,150,127,32,5,19,6,3,228,0,32,5,3,6,8,158,5,37,186,5,74,88,5,95,32,5,
  59,88,5,95,32,5,22,144,3,156,127,60,5,14,6,3,212,0,32,6,3,172,127,116,6,3,215,0,74,5,27,6,144,5,26,32,5,14,6,57,5,35,3,183,127,172,5,38,3,211,0,228,5,22,6,32,5,13,32,5,14,6,161,5,
  31,6,116,5,6,6,117,6,3,158,127,74,5,14,6,3,227,0,130,5,6,6,32,3,157,127,46,5,37,6,3,228,0,74,5,74,6,88,5,95,32,5,59,88,5,95,32,3,156,127,172,5,19,3,228,0,32,5,3,8,214,5,22,130,
  3,156,127,88,5,1,6,3,234,0,32,2,3,0,1,1,0,5,2,200,24,0,0,3,210,0,1,5,14,10,89,5,33,6,130,5,52,32,3,172,127,88,3,212,0,102,5,57,172,5,52,32,5,6,6,89,5,14,73,5,6,243,5,14,
  6,8,18,5,17,32,3,171,127,158,5,27,6,3,215,0,32,5,14,6,130,5,27,60,5,26,8,74,5,6,6,229,6,3,168,127,116,5,36,3,216,0,102,5,27,32,5,48,32,3,168,127,242,5,81,3,216,0,74,3,168,127,60,5,
  11,6,3,217,0,172,5,6,6,32,3,167,127,60,5,0,6,3,218,0,130,5,15,6,32,5,23,214,5,15,32,5,16,6,62,5,33,6,130,5,0,6,86,5,15,6,102,5,16,6,174,5,47,6,214,5,75,144,3,164,127,60,5,22,
  6,3,222,0,32,5,35,3,173,127,8,18,5,38,3,211,0,172,5,22,6,32,5,54,60,5,13,60,5,22,130,5,15,6,103,5,6,6,32,5,20,46,5,36,144,5,20,88,5,48,130,5,62,60,3,161,127,60,5,15,6,3,224,0,
  116,5,6,6,32,5,19,46,5,35,144,3,160,127,88,5,14,6,3,225,0,32,5,31,6,8,88,5,6,6,103,6,3,158,127,116,5,1,6,3,230,0,46,6,3,154,127,32,5,14,6,3,227,0,116,5,6,6,32,3,157,127,46,5,
  1,6,3,230,0,46,6,3,154,127,32,5,19,6,3,228,0,32,6,3,156,127,8,158,5,3,3,228,0,74,5,37,186,5,90,88,5,64,32,5,102,88,5,79,32,5,59,88,5,95,32,5,74,88,5,95,32,5,22,74,3,156,127,60,
  5,1,6,3,230,0,32,2,3,0,1,1,0,158,1,4,110,97,109,101,0,13,12,104,101,108,112,101,114,115,46,119,97,115,109,1,104,10,0,9,98,111,97,114,100,95,112,116,114,1,10,99,111,110,102,105,103,95,112,116,114,2,9,109,
  111,118,101,115,95,112,116,114,3,8,101,118,97,108,117,97,116,101,4,10,112,97,119,110,95,115,99,111,114,101,5,8,105,110,95,99,104,101,99,107,6,8,97,116,116,97,99,107,101,100,7,8,103,101,110,101,114,97,116,101,8,9,112,97,
  119,110,95,101,109,105,116,9,4,101,109,105,116,7,18,1,0,15,95,95,115,116,97,99,107,95,112,111,105,110,116,101,114,9,10,1,0,7,46,114,111,100,97,116,97,0,137,1,9,112,114,111,100,117,99,101,114,115,2,8,108,97,110,103,
  117,97,103,101,1,3,67,49,49,0,12,112,114,111,99,101,115,115,101,100,45,98,121,1,5,99,108,97,110,103,90,49,57,46,49,46,55,32,40,104,116,116,112,115,58,47,47,103,105,116,104,117,98,46,99,111,109,47,122,105,103,108,97,110,
  103,47,122,105,103,45,98,111,111,116,115,116,114,97,112,32,100,101,49,98,48,49,97,56,99,49,100,100,100,102,55,53,97,53,54,48,49,50,51,97,99,49,99,50,97,98,49,56,50,98,52,56,51,48,100,97,41,0,106,15,116,97,114,103,
  101,116,95,102,101,97,116,117,114,101,115,6,43,11,98,117,108,107,45,109,101,109,111,114,121,43,14,101,120,116,101,110,100,101,100,45,99,111,110,115,116,43,10,109,117,108,116,105,118,97,108,117,101,43,15,109,117,116,97,98,108,101,45,103,
  108,111,98,97,108,115,43,19,110,111,110,116,114,97,112,112,105,110,103,45,102,112,116,111,105,110,116,43,8,115,105,103,110,45,101,120,116
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
   moves:new Uint32Array(api.memory.buffer,api.moves_ptr(),512)};
 }
} catch (_) { /* Use the identical JS implementation if compilation is blocked. */ }
function sf55cSyncKernelConfig(){
 const kernel=SF55C_KERNEL;if(!kernel)return;
 kernel.config.set(SF55C.piece);
 for(let t=0;t<7;t++){kernel.config.set(SF55C_PST[t],7+t*64);kernel.config.set(SF55C_EG[t],455+t*64);}
}
sf55cSyncKernelConfig();
function sf55cEvaluate(g){
 const k=SF55C_KERNEL;if(!k)return sf55cEvaluateJS(g);
 k.board.set(g.boardState);return k.api.evaluate(g.side,g.kingSq[1],g.kingSq[-1]);
}
function sf55cInCheck(g){
 const k=SF55C_KERNEL;if(!k)return g.in_check();
 k.board.set(g.boardState);return !!k.api.in_check(g.side,g.kingSq[g.side]);
}
function sf55cKernelMoves(g,mode){
 const k=SF55C_KERNEL;k.board.set(g.boardState);
 const count=k.api.generate(g.side,g.castling,g.ep,g.kingSq[g.side],mode);
 if(mode===2)return !!count;
 const moves=new Array(count);
 for(let i=0;i<count;i++){
  const m=k.moves[i];moves[i]={from:m&63,to:(m>>>6)&63,piece:(m>>>12)&7,
   captured:(m>>>15)&7,promotion:(m>>>18)&7,flags:m>>>21};
 }
 return moves;
}
function sf55cLegalMoves(g){return SF55C_KERNEL?sf55cKernelMoves(g,0):g.fastMoves();}
function sf55cTacticalMoves(g){return SF55C_KERNEL?sf55cKernelMoves(g,1):sf55cTacticalMovesJS(g);}
function sf55cHasLegalMove(g){return SF55C_KERNEL?sf55cKernelMoves(g,2):g.fastHasLegalMove();}
