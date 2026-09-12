const fs = require('fs');
const files = [
  'StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js',
  'Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'
];
const src = files.map(f => fs.readFileSync(f,'utf8')).join('\n');

const harness = String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function publicFrom(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
function filterPrefix(g,c,n){return stonefishV45FilterByV4Order(g,c,STONEFISH_V4_ORDER.slice(0,n));}
function bookFromAllowed(g,profile,cands){return stonefishV45BookMove(g,profile,cands);}

function refinedVariant(g, opts={}){
  let c=getStonefishV3BestRawMoves(g).slice();
  if(!c.length)return null;

  // Opening layer can enter at v3-only or after a chosen v4 prefix.
  if(opts.bookAt===0){
    const b=bookFromAllowed(g,0,c);
    if(b)return stonefishV3PublicMove(g,b);
  }

  for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){
    const k=STONEFISH_V4_ORDER[i];

    if(opts.bookAt===i && i>0){
      const b=bookFromAllowed(g,0,c);
      if(b)return stonefishV3PublicMove(g,b);
    }

    if(opts.inverseBeforeMobility && k==='mobility'){
      c=stonefishV45BestByInverse(g,c,'oppCheckRisk');
      if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');
    } else if(opts.checkBeforeMobility && k==='mobility'){
      c=stonefishV45BestByInverse(g,c,'oppCheckRisk');
    }

    c=stonefishV4BestByCriterion(g,c,k);

    if(opts.mobilityAfterMobility && k==='mobility'&&c.length>1){
      c=stonefishV45BestByInverse(g,c,'oppMobility');
    }
    if(opts.currentInverse && k==='mobility'&&c.length>1){
      c=stonefishV45BestByInverse(g,c,'oppCheckRisk');
      if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');
    }

    const patternAfter = opts.patternAfter == null ? 11 : opts.patternAfter;
    if(i===patternAfter && c.length>1)c=stonefishV45PatternTieBreak(g,c);
  }

  const b=bookFromAllowed(g,0,c);
  if(b)return stonefishV3PublicMove(g,b);
  return publicFrom(g,c);
}

const models={
  current:g=>getStonefishV45Move(g),
  invBefore:g=>refinedVariant(g,{inverseBeforeMobility:true}),
  invSplit:g=>refinedVariant(g,{checkBeforeMobility:true,mobilityAfterMobility:true}),
  bookV3:g=>refinedVariant(g,{bookAt:0,currentInverse:true}),
  bookAfterHanging:g=>refinedVariant(g,{bookAt:5,currentInverse:true}),
  bookBeforeMobility:g=>refinedVariant(g,{bookAt:5,inverseBeforeMobility:true}),
  patternEarlier:g=>refinedVariant(g,{currentInverse:true,patternAfter:10}),
  patternLater:g=>refinedVariant(g,{currentInverse:true,patternAfter:13})
};

function play(seed,key,modelIsWhite){
  const g=new Chess();
  const r4=seeded((0x9e3779b9^(seed*0x45d9f3b))>>>0);
  const rm=seeded((0x85ebca6b^(seed*0x27d4eb2d))>>>0);
  for(let ply=0;ply<1000;ply++){
    const isModel=(g.turn()==='w')===modelIsWhite;
    const old=Math.random;Math.random=isModel?rm:r4;
    const m=isModel?models[key](g):getStonefishV4Move(g);
    Math.random=old;
    if(!m){
      if(!g.in_check())return'D';
      const whiteWon=g.turn()==='b';
      return whiteWon===modelIsWhite?'W':'L';
    }
    g._applyRaw(m._raw,true);
    if(cheapDraw(g))return'D';
  }
  return'D';
}
function sideTest(key,white,n,start){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(start+i,key,white);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D};}
function test(key,n=160,start=91000){
  const white=sideTest(key,true,n,start);
  const black=sideTest(key,false,n,start+10000);
  return {white,black,total:{W:white.W+black.W,L:white.L+black.L,D:white.D+black.D}};
}
for(const key of Object.keys(models))console.log(key,JSON.stringify(test(key)));
`;
new Function(src+'\n'+harness)();
