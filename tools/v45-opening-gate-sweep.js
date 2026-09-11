const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function prefix(g,n){let c=getStonefishV3BestRawMoves(g).slice();return stonefishV45FilterByV4Order(g,c,STONEFISH_V4_ORDER.slice(0,n));}
function bookModel(g,n){const c=prefix(g,n);if(!c.length)return null;const b=stonefishV45BookMove(g,0,c);const raw=b||stonefishV3RandomRaw(c);return raw?stonefishV3PublicMove(g,raw):null;}
const gateNames={6:'throughMobility',7:'throughQueen',8:'throughRepeat',12:'throughPieceSupport',13:'throughKingFreedom',14:'throughCenter',20:'fullV4'};
function play(seed,n){const g=new Chess();const modelWhite=(seed&1)===0;const r4=seeded(0x9e3779b9^(seed*0x45d9f3b));const rm=seeded(0x85ebca6b^(seed*0x27d4eb2d));for(let ply=0;ply<1000;ply++){const isModel=(g.turn()==='w')===modelWhite;const old=Math.random;Math.random=isModel?rm:r4;const m=isModel?bookModel(g,n):getStonefishV4Move(g);Math.random=old;if(!m){if(!g.in_check())return'D';const whiteWon=g.turn()==='b';return whiteWon===modelWhite?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}
function playControl(seed){const g=new Chess();const modelWhite=(seed&1)===0;const r4=seeded(0x9e3779b9^(seed*0x45d9f3b));const rm=seeded(0x85ebca6b^(seed*0x27d4eb2d));for(let ply=0;ply<1000;ply++){const isModel=(g.turn()==='w')===modelWhite;const old=Math.random;Math.random=isModel?rm:r4;const m=getStonefishV4Move(g);Math.random=old;if(!m){if(!g.in_check())return'D';const whiteWon=g.turn()==='b';return whiteWon===modelWhite?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}
function test(fn,n=300,start=61000){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=fn(start+i);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D};}
console.log('control-v4-v4',test(playControl));for(const n of [6,7,8,12,13,14,20])console.log(gateNames[n],test(seed=>play(seed,n)));
`;
new Function(src+'\n'+harness)();
