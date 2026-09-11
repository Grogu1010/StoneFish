const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(
  "function control(g,s){let z=0;for(let q=0;q<64;q++)if(g._isAttacked(q,s))z++;return z;}",
  "function control(g,s){let z=0;for(let q=0;q<64;q++)if(g._isAttacked(q,s))z++;return z;}\nfunction ownMoves(g,s){const os=g.side,oe=g.ep;g.side=s;g.ep=-1;const a=g.fastMoves();g.side=os;g.ep=oe;return a;}\nfunction mobilePieces(g,s){const a=ownMoves(g,s),u=new Set();for(const m of a)u.add(m.from);return u.size;}\nfunction nonKingMobility(g,s){const a=ownMoves(g,s);let z=0;for(const m of a)if(m.piece!==6)z++;return z;}\nfunction nonPawnMobility(g,s){const a=ownMoves(g,s);let z=0;for(const m of a)if(m.piece!==1&&m.piece!==6)z++;return z;}\nfunction minorMobility(g,s){const a=ownMoves(g,s);let z=0;for(const m of a)if(m.piece===2||m.piece===3)z++;return z;}"
);
source=source.replace(
  "else if(c==='mobility')z=g.fastMobility(s);",
  "else if(c==='mobility')z=g.fastMobility(s);else if(c==='mobilePieces')z=mobilePieces(g,s);else if(c==='nonKingMobility')z=nonKingMobility(g,s);else if(c==='nonPawnMobility')z=nonPawnMobility(g,s);else if(c==='minorMobility')z=minorMobility(g,s);"
);
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const A=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck'];
const B=['kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];function add(n,mid){C.push({name:n,order:[...${JSON.stringify(A)},...mid,...${JSON.stringify(B)}]});}
add('current',['mobility']);add('mobilePieces',['mobilePieces']);add('nonKing',['nonKingMobility']);add('nonPawn',['nonPawnMobility']);add('minor',['minorMobility']);
add('pieces_then_total',['mobilePieces','mobility']);add('total_then_pieces',['mobility','mobilePieces']);add('nonKing_then_pieces',['nonKingMobility','mobilePieces']);add('pieces_then_nonKing',['mobilePieces','nonKingMobility']);add('nonPawn_then_total',['nonPawnMobility','mobility']);add('minor_then_total',['minorMobility','mobility']);
C.push({name:'mob_kp_pieces_support',order:[...${JSON.stringify(A)},'mobility','kingProtection','mobilePieces','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']});
C.push({name:'pieces_kp_mob_support',order:[...${JSON.stringify(A)},'mobilePieces','kingProtection','mobility','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']});
C.push({name:'mob_pieces_kp_support',order:[...${JSON.stringify(A)},'mobility','mobilePieces','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']});
C.push({name:'nonKing_kp_support',order:[...${JSON.stringify(A)},'nonKingMobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']});
C.push({name:'nonPawn_kp_support',order:[...${JSON.stringify(A)},'nonPawnMobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']});
console.log('MOBILITY TYPES SCREEN',C.length,'x 30');const s=C.map(cfg=>({cfg,r:test(cfg,30,72000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('MOBILITY TYPES CONFIRM top 8 x 70');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,70,75000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('MOBILITY TYPES FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,80000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
