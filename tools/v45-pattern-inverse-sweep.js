const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function pub(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
function prefix(g,n){let c=getStonefishV3BestRawMoves(g).slice();return stonefishV45FilterByV4Order(g,c,STONEFISH_V4_ORDER.slice(0,n));}
function patternAt(g,n){let c=prefix(g,n);c=stonefishV45PatternTieBreak(g,c);return pub(g,c);}
function inverseAdjacent(g,mode){let c=getStonefishV3BestRawMoves(g).slice();for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){const k=STONEFISH_V4_ORDER[i];c=stonefishV4BestByCriterion(g,c,k);if(mode==='all'){if(k==='mobility'&&c.length>1){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');if(c.length>1)c=stonefishV45BestByInverse(g,c,'giveCheck');}else if(k==='kingFreedom'&&c.length>1)c=stonefishV45BestByInverse(g,c,'oppKingFreedom');else if(k==='center'&&c.length>1)c=stonefishV45BestByInverse(g,c,'oppCenter');else if(k==='boardControl'&&c.length>1)c=stonefishV45BestByInverse(g,c,'oppBoardControl');}else if(mode==='mobcheck'&&k==='mobility'&&c.length>1){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');}else if(mode==='space'&&k==='center'&&c.length>1){c=stonefishV45BestByInverse(g,c,'oppCenter');}else if(mode==='king'&&k==='kingFreedom'&&c.length>1){c=stonefishV45BestByInverse(g,c,'oppKingFreedom');}}
return pub(g,c);}
const models={
 pattern6:g=>patternAt(g,6),pattern8:g=>patternAt(g,8),pattern12:g=>patternAt(g,12),pattern14:g=>patternAt(g,14),pattern20:g=>patternAt(g,20),
 invAll:g=>inverseAdjacent(g,'all'),invMobCheck:g=>inverseAdjacent(g,'mobcheck'),invSpace:g=>inverseAdjacent(g,'space'),invKing:g=>inverseAdjacent(g,'king')
};
function play(seed,key){const g=new Chess();const modelWhite=(seed&1)===0;const r4=seeded(0x9e3779b9^(seed*0x45d9f3b));const rm=seeded(0x85ebca6b^(seed*0x27d4eb2d));for(let ply=0;ply<1000;ply++){const isModel=(g.turn()==='w')===modelWhite;const old=Math.random;Math.random=isModel?rm:r4;const m=isModel?models[key](g):getStonefishV4Move(g);Math.random=old;if(!m){if(!g.in_check())return'D';const whiteWon=g.turn()==='b';return whiteWon===modelWhite?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}
function test(key,n=300,start=71000){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(start+i,key);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D};}
for(const key of Object.keys(models))console.log(key,test(key));
`;
new Function(src+'\n'+harness)();
