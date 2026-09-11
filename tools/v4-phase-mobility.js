const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(
  "function feature(g,m,c){",
`function anyQueen(g){for(let q=0;q<64;q++)if(Math.abs(g.boardState[q])===5)return true;return false;}
function anyHeavy(g){for(let q=0;q<64;q++){const t=Math.abs(g.boardState[q]);if(t===4||t===5)return true;}return false;}
function kplaceNoQueen(g,s){const k=g.kingSq[s],f=k&7,r=k>>3;if(eg(g,s)&&!anyQueen(g))return 7-Math.abs(f-3.5)-Math.abs(r-3.5);const a=s===1?2:58,b=s===1?6:62,h=s===1?4:60;return(k===a||k===b)?3:(k===h?1:0);}
function kplaceNoHeavy(g,s){const k=g.kingSq[s],f=k&7,r=k>>3;if(eg(g,s)&&!anyHeavy(g))return 7-Math.abs(f-3.5)-Math.abs(r-3.5);const a=s===1?2:58,b=s===1?6:62,h=s===1?4:60;return(k===a||k===b)?3:(k===h?1:0);}
function pprogNoQueen(g,s){if(!eg(g,s)||anyQueen(g))return 0;let z=0;for(let q=0;q<64;q++)if(g.boardState[q]===s){const r=q>>3;z+=s===1?r-1:6-r;}return z;}
function nonKingMob(g,s){const old=g.side,ep=g.ep;g.side=s;g.ep=-1;const ms=g.fastMoves();g.side=old;g.ep=ep;let n=0;for(const m of ms)if(m.piece!==6)n++;return n;}
function feature(g,m,c){`
);
source=source.replace(
  "if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='fiftyReset')",
  "if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='endgameCheckNoQueen')return eg(g,g.side)&&!anyQueen(g)&&g.fastGivesCheck(m)?1:0;if(c==='fiftyReset')"
);
source=source.replace(
  "else if(c==='endgamePawnProgress')z=pprog(g,s);else if(c==='endgameCheck')z=eg(g,s)&&g.in_check()?1:0;else if(c==='mobility')z=g.fastMobility(s);",
  "else if(c==='endgamePawnProgress')z=pprog(g,s);else if(c==='pawnProgressNoQueen')z=pprogNoQueen(g,s);else if(c==='endgameCheck')z=eg(g,s)&&g.in_check()?1:0;else if(c==='mobilityNoKing')z=nonKingMob(g,s);else if(c==='mobility')z=g.fastMobility(s);"
);
source=source.replace(
  "else if(c==='kingPlacement')z=kplace(g,s);",
  "else if(c==='kingPlacementNoQueen')z=kplaceNoQueen(g,s);else if(c==='kingPlacementNoHeavy')z=kplaceNoHeavy(g,s);else if(c==='kingPlacement')z=kplace(g,s);"
);
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);
if(start<0||end<0)throw new Error('Could not locate harness tail');
const tail=String.raw`const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,o){C.push({name,order:o});}add('base',base.slice());
function repl(name,from,to){const o=base.map(x=>x===from?to:x);add(name,o);}
repl('king_noqueen','kingPlacement','kingPlacementNoQueen');repl('king_noheavy','kingPlacement','kingPlacementNoHeavy');repl('mob_noking','mobility','mobilityNoKing');repl('pawn_noqueen','endgamePawnProgress','pawnProgressNoQueen');repl('check_noqueen','endgameCheck','endgameCheckNoQueen');
add('drop_kingPlacement',base.filter(x=>x!=='kingPlacement'));
add('drop_endgameCheck',base.filter(x=>x!=='endgameCheck'));
add('drop_endgamePawnProgress',base.filter(x=>x!=='endgamePawnProgress'));
const combos=[
 ['phase_safe',{'kingPlacement':'kingPlacementNoQueen','endgamePawnProgress':'pawnProgressNoQueen','endgameCheck':'endgameCheckNoQueen'}],
 ['phase_noheavy',{'kingPlacement':'kingPlacementNoHeavy','endgamePawnProgress':'pawnProgressNoQueen','endgameCheck':'endgameCheckNoQueen'}],
 ['mob_phase',{'mobility':'mobilityNoKing','kingPlacement':'kingPlacementNoQueen','endgamePawnProgress':'pawnProgressNoQueen','endgameCheck':'endgameCheckNoQueen'}],
 ['mob_noheavy',{'mobility':'mobilityNoKing','kingPlacement':'kingPlacementNoHeavy','endgamePawnProgress':'pawnProgressNoQueen','endgameCheck':'endgameCheckNoQueen'}]
];
for(const [name,map] of combos)add(name,base.map(x=>map[x]||x));
for(const pos of[4,5,8,9,10,11,12,13]){const o=base.filter(x=>x!=='mobility');o.splice(pos,0,'mobilityNoKing');add('mobNoKing_p'+pos,o);}
console.log('PHASE MOBILITY SCREEN',C.length,'x 24');const s=C.map(cfg=>({cfg,r:test(cfg,24,112000)})).sort(rank);for(const x of s.slice(0,14))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('PHASE MOBILITY CONFIRM top 10 x 60');const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,60,114000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('PHASE MOBILITY FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,118000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
