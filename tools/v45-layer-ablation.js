const fs = require('fs');
const files = [
  'StonefishChess.js',
  'Stonefish_v3.js',
  'Stonefish_v4.js',
  'Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js',
  'Stonefish_v4_5_safety_patch.js'
];
const src = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');

const harness = String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function publicFromRaw(g,raw){return raw?stonefishV3PublicMove(g,raw):null;}
function finalV4(g){return stonefishV45V4FinalCandidates(g);}
function randomFinal(g,c){return publicFromRaw(g,stonefishV3RandomRaw(c));}

const models={
  v4:g=>getStonefishV4Move(g),
  combo:g=>getStonefishV45MoveWithProfile(g,0),
  book:g=>{const c=finalV4(g);const b=stonefishV45BookMove(g,0,c);return b?publicFromRaw(g,b):randomFinal(g,c);},
  pattern:g=>{let c=finalV4(g);c=stonefishV45PatternTieBreak(g,c);return randomFinal(g,c);},
  oppCheck:g=>{let c=finalV4(g);c=stonefishV45ApplyInverseOrder(g,c,['oppCheckRisk']);return randomFinal(g,c);},
  oppMob:g=>{let c=finalV4(g);c=stonefishV45ApplyInverseOrder(g,c,['oppMobility']);return randomFinal(g,c);},
  giveCheck:g=>{let c=finalV4(g);c=stonefishV45ApplyInverseOrder(g,c,['giveCheck']);return randomFinal(g,c);},
  oppKing:g=>{let c=finalV4(g);c=stonefishV45ApplyInverseOrder(g,c,['oppKingFreedom']);return randomFinal(g,c);},
  oppCenter:g=>{let c=finalV4(g);c=stonefishV45ApplyInverseOrder(g,c,['oppCenter']);return randomFinal(g,c);},
  oppBoard:g=>{let c=finalV4(g);c=stonefishV45ApplyInverseOrder(g,c,['oppBoardControl']);return randomFinal(g,c);}
};

function play(seed,key){
  const g=new Chess();
  const modelWhite=(seed&1)===0;
  const r4=seeded(0x9e3779b9^(seed*0x45d9f3b));
  const rm=seeded(0x85ebca6b^(seed*0x27d4eb2d));
  for(let ply=0;ply<1000;ply++){
    const isModel=(g.turn()==='w')===modelWhite;
    const old=Math.random;Math.random=isModel?rm:r4;
    const m=isModel?models[key](g):models.v4(g);
    Math.random=old;
    if(!m){if(!g.in_check())return'D';const whiteWon=g.turn()==='b';return whiteWon===modelWhite?'W':'L';}
    g._applyRaw(m._raw,true);
    if(cheapDraw(g))return'D';
  }
  return'D';
}
function test(key,n=200,start=52000){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(start+i,key);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D};}
for(const key of ['combo','book','pattern','oppCheck','oppMob','giveCheck','oppKing','oppCenter','oppBoard']) console.log(key,test(key));
`;
new Function(src + '\n' + harness)();
