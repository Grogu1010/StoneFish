const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function pub(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
function applyPattern(g,c){return stonefishV45PatternTieBreak(g,c);}
function applyBook(g,c){const b=stonefishV45BookMove(g,0,c);return b?[b]:c;}
function combo(g,mode){
  let c=getStonefishV3BestRawMoves(g).slice();
  for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){
    const k=STONEFISH_V4_ORDER[i];
    c=stonefishV4BestByCriterion(g,c,k);
    if(k==='mobility'&&c.length>1){
      if(mode==='mobFirst'){c=stonefishV45BestByInverse(g,c,'oppMobility');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppCheckRisk');}
      else {c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');}
    }
    if(k==='pieceSupport'&&c.length>1){
      c=applyPattern(g,c);
    }
  }
  c=applyBook(g,c);
  return pub(g,c);
}
function comboLatePattern(g){
  let c=getStonefishV3BestRawMoves(g).slice();
  for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){
    const k=STONEFISH_V4_ORDER[i];c=stonefishV4BestByCriterion(g,c,k);
    if(k==='mobility'&&c.length>1){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');}
    if(k==='kingFreedom'&&c.length>1)c=applyPattern(g,c);
  }
  c=applyBook(g,c);return pub(g,c);
}
const models={checkMob:g=>combo(g,'checkFirst'),mobCheck:g=>combo(g,'mobFirst'),latePattern:g=>comboLatePattern(g)};
function play(seed,key){const g=new Chess();const modelWhite=(seed&1)===0;const r4=seeded(0x9e3779b9^(seed*0x45d9f3b));const rm=seeded(0x85ebca6b^(seed*0x27d4eb2d));for(let ply=0;ply<1000;ply++){const isModel=(g.turn()==='w')===modelWhite;const old=Math.random;Math.random=isModel?rm:r4;const m=isModel?models[key](g):getStonefishV4Move(g);Math.random=old;if(!m){if(!g.in_check())return'D';const whiteWon=g.turn()==='b';return whiteWon===modelWhite?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}
function test(key,n=400,start=81000){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(start+i,key);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D};}
for(const key of Object.keys(models))console.log(key,test(key));
`;
new Function(src+'\n'+harness)();
