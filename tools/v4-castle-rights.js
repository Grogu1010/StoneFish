const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`function feature(g,m,c){if(c.startsWith('castleRights:')){const until=+c.split(':')[1];if(g.fullmove>until)return 0;g.fastApply(m);const s=-g.side,bits=s===1?3:12,x=g.castling&bits;const z=(x&1?1:0)+(x&2?1:0)+(x&4?1:0)+(x&8?1:0);g.fastUndo();return z;}`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];const base=${JSON.stringify(base)};function add(name,pos,until,e){const o=base.slice();o.splice(pos,0,'castleRights:'+until);C.push({name,order:o,developUntil:8,queenUntil:14,endgameMaterial:e});}
for(const e of[10,14])for(const u of[8,10,12,14,16,20]){add('preH_u'+u+'_e'+e,3,u,e);add('postQ_u'+u+'_e'+e,5,u,e);}
console.log('CASTLE RIGHTS SCREEN',C.length,'x 16');const s=C.map(c=>({cfg:c,r:test(c,16,321000)})).sort(rank);for(const x of s.slice(0,10))console.log(x.cfg.name,x.r);
console.log('CASTLE RIGHTS CONFIRM top 6 x 50');const c=s.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,50,324000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('CASTLE RIGHTS FINAL top 3 x 100');const f=c.slice(0,3).map(x=>({cfg:x.cfg,r:test(x.cfg,100,330000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
