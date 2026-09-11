const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`function openingSanity(g,m,c){
  if(g.fullmove>ACTIVE.sanityUntil)return 1;
  const f=m.from&7;
  if(c==='avoidEdgePawn')return(m.piece===1&&!m.captured&&(f===0||f===7))?0:1;
  if(c==='avoidWingPawn')return(m.piece===1&&!m.captured&&(f<=1||f>=6))?0:1;
  if(c==='avoidEarlyRook')return(m.piece===4&&!m.captured)?0:1;
  if(c==='avoidRepeatMinor'){
    if(m.piece!==2&&m.piece!==3)return 1;
    const starts=m.piece===2?[1,6,57,62]:[2,5,58,61];
    return starts.includes(m.from)?1:0;
  }
  if(c==='centerPawn')return(m.piece===1&&(f===3||f===4))?1:0;
  return 0;
}
function feature(g,m,c){if(c==='avoidEdgePawn'||c==='avoidWingPawn'||c==='avoidEarlyRook'||c==='avoidRepeatMinor'||c==='centerPawn')return openingSanity(g,m,c);`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];let id=0;const base=${JSON.stringify(base)};function add(name,criteria,until){const o=base.slice();const p=o.indexOf('mobility');o.splice(p,0,...criteria);C.push({name:name+'_u'+until,order:o,developUntil:8,queenUntil:14,endgameMaterial:14,sanityUntil:until});}
for(const u of[6,8,10]){add('edge',['avoidEdgePawn'],u);add('wing',['avoidWingPawn'],u);add('rook',['avoidEarlyRook'],u);add('repeatMinor',['avoidRepeatMinor'],u);add('centerPawn',['centerPawn'],u);add('edgeRook',['avoidEdgePawn','avoidEarlyRook'],u);add('repeatEdge',['avoidRepeatMinor','avoidEdgePawn'],u);add('repeatRook',['avoidRepeatMinor','avoidEarlyRook'],u);}
console.log('OPENING SANITY SCREEN',C.length,'x 16');const s=C.map(c=>({cfg:c,r:test(c,16,136000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.r);
console.log('OPENING SANITY CONFIRM top 8 x 60');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,60,139000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('OPENING SANITY FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,145000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14,sanityUntil:8};\\n'+harness)();");
eval(source);
