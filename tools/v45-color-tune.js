const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function pub(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
function strictPatternScore(game,raw){
  if(game.fastIsMateMove(raw))return 1000000;
  game.fastApply(raw);const own=-game.side,enemy=game.side;let s=0;
  s+=stonefishV45LadderScore(game,own,enemy)+stonefishV45TriangleScore(game,own,enemy)+stonefishV45BackRankScore(game,own,enemy)+stonefishV45SmotheredScore(game,own,enemy,raw)+stonefishV45ArabianScore(game,own,enemy)+stonefishV45BodenScore(game,own,enemy);
  const freedom=stonefishV4KingFreedom(game,enemy),checking=game.in_check();
  if(checking&&freedom===0&&stonefishV45Pieces(game,own,5).length&&stonefishV45Pieces(game,own,4).length)s+=24;
  game.fastUndo();return s;
}
function strictPatternTie(game,c){if(c.length<=1)return c;let best=0,s=[];for(let i=0;i<c.length;i++){s[i]=strictPatternScore(game,c[i]);if(s[i]>best)best=s[i];}return best>0?c.filter((_,i)=>s[i]===best):c;}
function candidate(g,profile=0){
  let c=getStonefishV3BestRawMoves(g).slice();if(!c.length)return null;
  for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){
    const k=STONEFISH_V4_ORDER[i];
    if(i===5){
      const b=stonefishV45BookMove(g,profile,c);if(b)return stonefishV3PublicMove(g,b);
      c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');
    }
    c=stonefishV4BestByCriterion(g,c,k);
    if(i===11&&c.length>1)c=strictPatternTie(g,c);
  }
  return pub(g,c);
}
const models={control:g=>getStonefishV4Move(g),current:g=>getStonefishV45Move(g),profile0:g=>candidate(g,0),profile7:g=>candidate(g,7),profile8:g=>candidate(g,8)};
function play(seed,key,modelWhite){
  const g=new Chess();
  // Randomness belongs to board colour, never engine identity.
  const rw=seeded((0x9e3779b9^(seed*0x45d9f3b))>>>0), rb=seeded((0x85ebca6b^(seed*0x27d4eb2d))>>>0);
  for(let ply=0;ply<1000;ply++){
    const whiteTurn=g.turn()==='w';const isModel=whiteTurn===modelWhite;
    const old=Math.random;Math.random=whiteTurn?rw:rb;
    const m=isModel?models[key](g):getStonefishV4Move(g);Math.random=old;
    if(!m){if(!g.in_check())return'D';const whiteWon=g.turn()==='b';return whiteWon===modelWhite?'W':'L';}
    g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';
  }return'D';
}
function side(key,white,n,start){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(start+i,key,white);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D};}
function add(a,b){return{W:a.W+b.W,L:a.L+b.L,D:a.D+b.D};}
function test(key){let w={W:0,L:0,D:0},b={W:0,L:0,D:0};for(const s of [201000,221000,241000,261000]){w=add(w,side(key,true,125,s));b=add(b,side(key,false,125,s));}return{white:w,black:b,total:add(w,b)};}
for(const k of Object.keys(models))console.log(k,JSON.stringify(test(k)));
`;
new Function(src+'\n'+harness)();
