const fs=require('fs');
const engine=fs.readFileSync('StonefishChess.js','utf8');
const v3=fs.readFileSync('Stonefish_v3.js','utf8');
const pre=fs.readFileSync('tools/v4-tune.js','utf8');
const hs=pre.indexOf('function seeded('), he=pre.indexOf('const base=[',hs);
if(hs<0||he<0)throw new Error('harness core not found');
let core=pre.slice(hs,he);
core=core.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
core=core.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
core=core.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
const tail=String.raw`
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];let id=0;function add(d,q,e){C.push({name:'t'+id++,order:base,developUntil:d,queenUntil:q,endgameMaterial:e});}
for(const d of [8,10,12,13,14,16,18])for(const q of [6,8,10,12,14])for(const e of [8,10,12,14])add(d,q,e);
const oldChoose4=choose4;choose4=function(g,r,cfg){ACTIVE=cfg;return oldChoose4(g,r,cfg);};
console.log('THRESHOLD SCREEN',C.length,'x 12');const s=C.map(cfg=>({cfg,r:test(cfg,12,42000)})).sort(rank);for(const x of s.slice(0,15))console.log(x.cfg.name,{d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);
console.log('THRESHOLD CONFIRM top 12 x 50');const c=s.slice(0,12).map(x=>({cfg:x.cfg,r:test(x.cfg,50,45000)})).sort(rank);for(const x of c)console.log(x.cfg.name,{d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);
console.log('THRESHOLD FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,50000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,{d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
let ACTIVE={developUntil:13,queenUntil:10,endgameMaterial:10};
new Function(engine+'\n'+v3+'\nlet ACTIVE='+JSON.stringify(ACTIVE)+';\n'+core+'\n'+tail)();
