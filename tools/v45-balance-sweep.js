const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function pub(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
function oppMob(g,r){g.fastApply(r);const n=g.fastMoves().length;g.fastUndo();return n;}
function inverseIfMeaningful(g,c,minGain){
  if(c.length<=1)return c;
  const own=stonefishV4BestByCriterion(g,c,'mobility');
  let ownBest=Infinity;for(const r of own){const n=oppMob(g,r);if(n<ownBest)ownBest=n;}
  let invBest=Infinity;const vals=[];for(const r of c){const n=oppMob(g,r);vals.push(n);if(n<invBest)invBest=n;}
  if(ownBest-invBest<minGain)return c;
  return c.filter((_,i)=>vals[i]===invBest);
}
function candidate(g,minGain){let c=getStonefishV3BestRawMoves(g).slice();if(!c.length)return null;for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){const k=STONEFISH_V4_ORDER[i];if(i===5){const b=stonefishV45BookMove(g,0,c);if(b)return stonefishV3PublicMove(g,b);}if(k==='mobility'&&g.fullmove>=24&&c.length>1)c=inverseIfMeaningful(g,c,minGain);c=stonefishV4BestByCriterion(g,c,k);if(i===11&&c.length>1)c=stonefishV45StrictPatternTieBreak(g,c);}return pub(g,c);}
function game(minGain,modelWhite){const g=new Chess();for(let p=0;p<1000;p++){const model=(g.turn()==='w')===modelWhite;const m=model?candidate(g,minGain):getStonefishV4Move(g);if(!m){if(!g.in_check())return'D';return ((g.turn()==='b')===modelWhite)?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}
function test(minGain,n=3000){let W=0,L=0,D=0,wW=0,wL=0,wD=0,bW=0,bL=0,bD=0;for(let i=0;i<n;i++){const mw=(i%2)===0;const r=game(minGain,mw);if(r==='W'){W++;if(mw)wW++;else bW++;}else if(r==='L'){L++;if(mw)wL++;else bL++;}else{D++;if(mw)wD++;else bD++;}}return{W,L,D,wp:(100*W/n).toFixed(1),lp:(100*L/n).toFixed(1),dp:(100*D/n).toFixed(1),white:[wW,wL,wD],black:[bW,bL,bD]};}
for(const g of [1,2,3,4,5,6,8,10,12,16])console.log('gain'+g,JSON.stringify(test(g)));
`;
new Function(src+'\n'+harness)();
