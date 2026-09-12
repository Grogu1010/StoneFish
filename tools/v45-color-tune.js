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

function strictPatternScore(game,raw){
  if(game.fastIsMateMove(raw))return 1000000;
  game.fastApply(raw);
  const own=-game.side, enemy=game.side;
  let s=0;
  s+=stonefishV45LadderScore(game,own,enemy);
  s+=stonefishV45TriangleScore(game,own,enemy);
  s+=stonefishV45BackRankScore(game,own,enemy);
  s+=stonefishV45SmotheredScore(game,own,enemy,raw);
  s+=stonefishV45ArabianScore(game,own,enemy);
  s+=stonefishV45BodenScore(game,own,enemy);
  const freedom=stonefishV4KingFreedom(game,enemy), checking=game.in_check();
  if(checking&&freedom===0&&stonefishV45Pieces(game,own,5).length&&stonefishV45Pieces(game,own,4).length)s+=24;
  game.fastUndo();
  return s;
}
function strictPatternTie(game,c){
  if(c.length<=1)return c;
  let best=0;const scores=[];
  for(let i=0;i<c.length;i++){const s=strictPatternScore(game,c[i]);scores[i]=s;if(s>best)best=s;}
  return best>0?c.filter((_,i)=>scores[i]===best):c;
}

function candidateMove(g,profile=0,strict=false){
  let c=getStonefishV3BestRawMoves(g).slice();
  if(!c.length)return null;
  for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){
    const k=STONEFISH_V4_ORDER[i];

    // OPENING: after promotion/castling/development/hanging/repetition safety,
    // allow the weighted book to choose among the still-safe v3 candidates.
    if(i===5){
      const b=stonefishV45BookMove(g,profile,c);
      if(b)return stonefishV3PublicMove(g,b);
      // INVERSES: before our own mobility, first suppress enemy checks,
      // then suppress total enemy mobility.
      c=stonefishV45BestByInverse(g,c,'oppCheckRisk');
      if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');
    }

    c=stonefishV4BestByCriterion(g,c,k);

    // FORCED-MATE PATTERNS after piece support.
    if(i===11&&c.length>1)c=strict?strictPatternTie(g,c):stonefishV45PatternTieBreak(g,c);
  }
  return publicFrom(g,c);
}

function play(seed,profile,strict,modelIsWhite){
  const g=new Chess();
  const r4=seeded((0x9e3779b9^(seed*0x45d9f3b))>>>0);
  const rm=seeded((0x85ebca6b^(seed*0x27d4eb2d))>>>0);
  for(let ply=0;ply<1000;ply++){
    const isModel=(g.turn()==='w')===modelIsWhite;
    const old=Math.random;Math.random=isModel?rm:r4;
    const m=isModel?candidateMove(g,profile,strict):getStonefishV4Move(g);
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
function side(profile,strict,white,n,start){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(start+i,profile,strict,white);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D};}
function add(a,b){return{W:a.W+b.W,L:a.L+b.L,D:a.D+b.D};}
function multi(profile,strict=false){
  let white={W:0,L:0,D:0},black={W:0,L:0,D:0};
  for(const start of [101000,121000,141000]){
    white=add(white,side(profile,strict,true,80,start));
    black=add(black,side(profile,strict,false,80,start+10000));
  }
  return{white,black,total:add(white,black)};
}
for(let p=0;p<=8;p++)console.log('profile'+p,JSON.stringify(multi(p,false)));
console.log('profile0_strictPattern',JSON.stringify(multi(0,true)));
`;
new Function(src+'\n'+harness)();
