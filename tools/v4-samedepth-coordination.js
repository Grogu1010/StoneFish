const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// Keep the search depth exactly at v3. Only alter v4's lexicographic tie-break features.
src=src.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
src=src.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
src=src.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");

src=src.replace("function feature(g,m,c){",String.raw`
function repeatTempo(g,m,lim){
  if(g.fullmove>lim)return 0;
  const h=g.historyStack;
  if(h.length<2)return 1;
  const prev=h[h.length-2];
  if(!prev||prev.side!==g.side||prev.move.to!==m.from)return 1;
  if(m.captured||(m.flags&12)||g.fastGivesCheck(m))return 1;
  return 0;
}
function freshDevelop(g,m,lim){
  if(g.fullmove>lim)return 0;
  const s=g.side,p=Math.abs(g.boardState[m.from]);
  const nh=s===1?[1,6]:[57,62],bh=s===1?[2,5]:[58,61];
  if(p===2)return nh.includes(m.from)?2:0;
  if(p===3)return bh.includes(m.from)?2:0;
  return 1;
}
function castlePrep(g,s){
  const b=g.boardState;let best=0;
  if(s===1){
    if(g.castling&1){let n=0;if(!b[5])n++;if(!b[6])n++;best=Math.max(best,n*3);}
    if(g.castling&2){let n=0;if(!b[1])n++;if(!b[2])n++;if(!b[3])n++;best=Math.max(best,n*2);}
  }else{
    if(g.castling&4){let n=0;if(!b[61])n++;if(!b[62])n++;best=Math.max(best,n*3);}
    if(g.castling&8){let n=0;if(!b[57])n++;if(!b[58])n++;if(!b[59])n++;best=Math.max(best,n*2);}
  }
  return best;
}
function looseNonPawn(g,s){
  let cost=0;
  for(let q=0;q<64;q++){
    const p=g.boardState[q],t=Math.abs(p);
    if(!p||(p>0?1:-1)!==s||t===1||t===6)continue;
    if(!g._isAttacked(q,s))cost+=V[t]||0;
  }
  return-cost;
}
function looseMajor(g,s){
  let cost=0;
  for(let q=0;q<64;q++){
    const p=g.boardState[q],t=Math.abs(p);
    if(!p||(p>0?1:-1)!==s||(t!==4&&t!==5))continue;
    if(!g._isAttacked(q,s))cost+=V[t]||0;
  }
  return-cost;
}
function pawnChain(g,s){
  const b=g.boardState;let n=0;
  for(let q=0;q<64;q++)if(b[q]===s){
    const f=q&7,r=q>>3,ar=r-s;
    if(ar<0||ar>7)continue;
    if(f>0&&b[ar*8+f-1]===s){n++;continue;}
    if(f<7&&b[ar*8+f+1]===s)n++;
  }
  return n;
}
function connectedRooks(g,s){
  const b=g.boardState,rs=[];for(let q=0;q<64;q++)if(b[q]===s*4)rs.push(q);
  if(rs.length<2)return 0;
  for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){
    const a=rs[i],z=rs[j],af=a&7,ar=a>>3,zf=z&7,zr=z>>3;
    if(ar===zr){let ok=true;for(let f=Math.min(af,zf)+1;f<Math.max(af,zf);f++)if(b[ar*8+f]){ok=false;break;}if(ok)return 1;}
    if(af===zf){let ok=true;for(let r=Math.min(ar,zr)+1;r<Math.max(ar,zr);r++)if(b[r*8+af]){ok=false;break;}if(ok)return 1;}
  }
  return 0;
}
function feature(g,m,c){
  if(c.startsWith('repeatTempo@'))return repeatTempo(g,m,+c.split('@')[1]);
  if(c.startsWith('freshDevelop@'))return freshDevelop(g,m,+c.split('@')[1]);`);

src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c==='openingDevelop')z=g.fullmove<=ACTIVE.developUntil?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){", "else if(c==='queenDiscipline'){if(g.fullmove<=ACTIVE.queenUntil){");
src=src.replace("else if(c==='hangingMax')z=hangingMax(g,s);", "else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='castlePrep')z=castlePrep(g,s);else if(c==='looseNonPawn')z=looseNonPawn(g,s);else if(c==='looseMajor')z=looseMajor(g,s);else if(c==='pawnChain')z=pawnChain(g,s);else if(c==='connectedRooks')z=connectedRooks(g,s);");
src=src.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();", "function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,mods,d=8,q=14,e=14){let o=base.slice();for(const mod of mods){const pos=mod[0],feat=mod[1];o.splice(pos,0,feat);}C.push({name,order:o,developUntil:d,queenUntil:q,endgameMaterial:e});}
C.push({name:'control',order:base.slice(),developUntil:8,queenUntil:14,endgameMaterial:14});
for(const n of[8,10,12,14])add('repeat'+n,[[5,'repeatTempo@'+n]]);
for(const n of[8,10,12])add('fresh'+n,[[5,'freshDevelop@'+n]]);
for(const p of[5,7,9])add('castlePrep'+p,[[p,'castlePrep']]);
for(const p of[5,7,9])add('looseNP'+p,[[p,'looseNonPawn']]);
for(const p of[5,7,9])add('looseMajor'+p,[[p,'looseMajor']]);
for(const p of[10,12,14])add('pawnChain'+p,[[p,'pawnChain']]);
for(const p of[12,15,18])add('connectedRooks'+p,[[p,'connectedRooks']]);
add('repeat10_castle',[[5,'repeatTempo@10'],[6,'castlePrep']]);
add('repeat10_looseMajor',[[5,'repeatTempo@10'],[6,'looseMajor']]);
add('fresh10_castle',[[5,'freshDevelop@10'],[6,'castlePrep']]);
add('looseMajor_castle',[[5,'looseMajor'],[6,'castlePrep']]);
add('repeat10_looseNP',[[5,'repeatTempo@10'],[6,'looseNonPawn']]);
console.log('SAMEDEPTH COORD SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,320000)})).sort(rank);for(const x of s.slice(0,15))console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH COORD CONFIRM top 10 x 50');const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,50,325000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH COORD FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,335000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r,JSON.stringify(x.cfg));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);
src=src.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(src);
