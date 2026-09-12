const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function pub(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
function ownMob(g,r){g.fastApply(r);const side=-g.side;const n=g.fastMobility(side);g.fastUndo();return n;}
const profiles={canonical:{},veryRare:{engine:0.18,mainline:0.22,rare:8.0,dynamic:2.20,tactical:1.28,solid:0.82}};
let ACTIVE={};
stonefishV45ProfileWeight=function(line,profileIndex){let v=line.weight;for(const tag of line.tags){const m=ACTIVE[tag];if(m)v*=m;}return v;};
function inverseWithinSlack(g,c,mode){if(c.length<=1)return c;let max=-Infinity;const vals=[];for(const r of c){const n=ownMob(g,r);vals.push(n);if(n>max)max=n;}let kept=c.filter((_,i)=>vals[i]>=max-4);if(mode==='checkMob'){if(kept.length>1)kept=stonefishV45BestByInverse(g,kept,'oppCheckRisk');if(kept.length>1)kept=stonefishV45BestByInverse(g,kept,'oppMobility');}else if(mode==='mobCheck'){if(kept.length>1)kept=stonefishV45BestByInverse(g,kept,'oppMobility');if(kept.length>1)kept=stonefishV45BestByInverse(g,kept,'oppCheckRisk');}else if(mode==='mobOnly'){if(kept.length>1)kept=stonefishV45BestByInverse(g,kept,'oppMobility');}else if(mode==='checkOnly'){if(kept.length>1)kept=stonefishV45BestByInverse(g,kept,'oppCheckRisk');}return kept;}
function candidate(g,mode){let c=getStonefishV3BestRawMoves(g).slice();if(!c.length)return null;for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){const k=STONEFISH_V4_ORDER[i];if(i===5){const b=stonefishV45BookMove(g,0,c);if(b)return stonefishV3PublicMove(g,b);}if(k==='mobility'&&c.length>1)c=inverseWithinSlack(g,c,mode);c=stonefishV4BestByCriterion(g,c,k);if(i===11&&c.length>1)c=stonefishV45StrictPatternTieBreak(g,c);}return pub(g,c);}
function game(mode,modelWhite){const g=new Chess();for(let p=0;p<1000;p++){const model=(g.turn()==='w')===modelWhite;const m=model?candidate(g,mode):getStonefishV4Move(g);if(!m){if(!g.in_check())return'D';return ((g.turn()==='b')===modelWhite)?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}
function test(label,profile,mode,n=3000){ACTIVE=profiles[profile];let W=0,L=0,D=0,wW=0,wL=0,wD=0,bW=0,bL=0,bD=0;for(let i=0;i<n;i++){const mw=(i%2)===0;const r=game(mode,mw);if(r==='W'){W++;if(mw)wW++;else bW++;}else if(r==='L'){L++;if(mw)wL++;else bL++;}else{D++;if(mw)wD++;else bD++;}}console.log(label,JSON.stringify({W,L,D,wp:(100*W/n).toFixed(1),lp:(100*L/n).toFixed(1),dp:(100*D/n).toFixed(1),white:[wW,wL,wD],black:[bW,bL,bD]}));}
for(const p of ['canonical','veryRare'])for(const m of ['checkMob','mobCheck','mobOnly','checkOnly'])test(p+'_'+m,p,m);
`;
new Function(src+'\n'+harness)();
