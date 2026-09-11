const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=8?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=14");
source=source.replace("function feature(g,m,c){",`function matDiff(g,s){return npm(g,s)-npm(g,-s);}
function drawState(g){const key=g.fastPositionKey(),rep=(g.positionCounts.get(key)||0)+1;return {immediate:g.halfmove>=100||g._insufficientMaterial()||rep>=3,rep,half:g.halfmove};}
function feature(g,m,c){`);
source=source.replace("else if(c==='boardControl')z=control(g,s);",`else if(c==='boardControl')z=control(g,s);else if(c.startsWith('drawNow:')){const t=+c.split(':')[1],behind=matDiff(g,s)<=-t,d=drawState(g);z=behind?(d.immediate?1:0):(d.immediate?0:1);}else if(c.startsWith('repeatPolicy:')){const t=+c.split(':')[1],behind=matDiff(g,s)<=-t,d=drawState(g);z=behind?d.rep:-d.rep;}else if(c.startsWith('fiftyPolicy:')){const t=+c.split(':')[1],behind=matDiff(g,s)<=-t;z=behind?g.halfmove:-g.halfmove;}`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];let id=0;const base=${JSON.stringify(base)};function add(order,t,e,n){C.push({name:n||('d'+id++),order,behind:t,endgameMaterial:e});}for(const t of[0.5,1.5,3.5])for(const e of[10,14]){for(const pos of[4,5,8,9,10]){let o=base.slice();o.splice(pos,0,'drawNow:'+t,'repeatPolicy:'+t);add(o,t,e);}for(const pos of[5,8,9]){let o=base.slice();o.splice(pos,0,'drawNow:'+t,'repeatPolicy:'+t,'fiftyPolicy:'+t);add(o,t,e);}}
console.log('DRAW POLICY SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,124000)})).sort(rank);for(const x of s.slice(0,15))console.log(x.cfg.name,{t:x.cfg.behind,e:x.cfg.endgameMaterial},x.cfg.order.join('>'),x.r);
console.log('DRAW POLICY CONFIRM top 10 x 60');const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,60,127000)})).sort(rank);for(const x of c)console.log(x.cfg.name,{t:x.cfg.behind,e:x.cfg.endgameMaterial},x.r);
console.log('DRAW POLICY FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,132000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,{t:x.cfg.behind,e:x.cfg.endgameMaterial},x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={endgameMaterial:10};\\n'+harness)();");
eval(source);
