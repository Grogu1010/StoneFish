const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
src=src.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
src=src.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
src=src.replace("function feature(g,m,c){",String.raw`
function hangStats(g,s){let total=0,count=0,max=0,attacked=0,attackedMax=0,defended=0;for(let q=0;q<64;q++){const p=g.boardState[q],t=Math.abs(p);if(!p||(p>0?1:-1)!==s||t===6)continue;const v=V[t]||0,a=g._isAttacked(q,-s),d=g._isAttacked(q,s);if(d)defended+=v;if(a){attacked+=v;if(v>attackedMax)attackedMax=v;if(!d){total+=v;count++;if(v>max)max=v;}}}return{total,count,max,attacked,attackedMax,defended};}
function feature(g,m,c){`);
src=src.replace("else if(c==='hangingMax')z=hangingMax(g,s);", "else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='hangingTotal')z=-hangStats(g,s).total;else if(c==='hangingCount')z=-hangStats(g,s).count;else if(c==='attackedValue')z=-hangStats(g,s).attacked;else if(c==='attackedMax')z=-hangStats(g,s).attackedMax;else if(c==='defendedValue')z=hangStats(g,s).defended;else if(c==='weightedExposure'){const h=hangStats(g,s);z=-(4*h.total+h.attacked);}");
src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c==='openingDevelop')z=g.fullmove<=ACTIVE.developUntil?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){", "else if(c==='queenDiscipline'){if(g.fullmove<=ACTIVE.queenUntil){");
src=src.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();", "function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,o){C.push({name,order:o,developUntil:8,queenUntil:14,endgameMaterial:14});}
add('control',base.slice());
for(const feat of['hangingTotal','hangingCount','attackedValue','attackedMax','defendedValue','weightedExposure']){
 for(const pos of[3,4,5,9,10]){const o=base.slice();o.splice(pos,0,feat);add(feat+'p'+pos,o);}
 const r=base.filter(x=>x!=='hangingMax');r.splice(3,0,feat);add('replace_'+feat,r);
}
for(const feat of['hangingTotal','weightedExposure','attackedValue']){const o=base.slice();o.splice(4,0,feat);add('afterMax_'+feat,o);}
console.log('SAMEDEPTH PIECE SAFETY SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,480000)})).sort(rank);for(const x of s.slice(0,18))console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH PIECE SAFETY CONFIRM top 10 x 50');const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,50,485000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH PIECE SAFETY FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,495000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r,JSON.stringify(x.cfg));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);
src=src.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(src);
