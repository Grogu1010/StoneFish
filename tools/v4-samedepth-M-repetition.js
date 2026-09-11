const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// SAME DEPTH ONLY. These criteria inspect the resulting position key of the
// candidate move; they do not generate any opponent reply or extra search ply.
src=src.replace("function feature(g,m,c){",String.raw`
function repGuard(g,m,limit){g.fastApply(m);const n=g.positionCounts.get(g.fastPositionKey())||0;g.fastUndo();return n<limit?1:0;}
function feature(g,m,c){if(c==='repThirdGuard')return repGuard(g,m,2);if(c==='repSecondGuard')return repGuard(g,m,1);`);

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,order){C.push({name,order});}
add('control',M.slice());
for(const p of[3,4]){let o=M.slice();o.splice(p,0,'repThirdGuard');add('third_p'+p,o);}
for(const p of[3,4]){let o=M.slice();o.splice(p,0,'repSecondGuard');add('second_p'+p,o);}
let early=M.filter(x=>x!=='repetitionAvoid');early.splice(4,0,'repetitionAvoid');add('fullRepEarly',early);
console.log('M REPETITION EXACT-BLOCK x100');for(const c of C)console.log('BLOCK90000',c.name,test(c,100,90000));
console.log('M REPETITION FRESH-BLOCK x100');for(const c of C)console.log('BLOCK860000',c.name,test(c,100,860000));
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
