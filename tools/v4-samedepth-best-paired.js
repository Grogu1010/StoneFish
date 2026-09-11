const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side,visits=g.positionCounts.get(g.fastPositionKey())||0,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
function fiftyByLead(g,m,clockMin,leadMin){if(g.halfmove<clockMin)return 0;g.fastApply(m);const s=-g.side,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(lead<leadMin)return 0;return(m.piece===1||m.captured)?1:0;}
function feature(g,m,c){if(c==='rep2Lead2_5')return repByLead(g,m,1,2.5);if(c==='fiftyLead60')return fiftyByLead(g,m,60,2.5);`);
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const B=['promotion','castleNow','openingDevelop','hangingMax','rep2Lead2_5','fiftyLead60','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const ctrlCfg={name:'control',order:M},bestCfg={name:'best',order:B};
const starts=[90000,740000,820000,860000],matrix={};let changed=0;for(const st of starts){const block={};for(let i=0;i<100;i++){const seed=st+i,a=play(ctrlCfg,seed),b=play(bestCfg,seed),k=a+'>'+b;matrix[k]=(matrix[k]||0)+1;block[k]=(block[k]||0)+1;if(a!==b){changed++;console.log('CHANGE',seed,k);}}console.log('BLOCK',st,block);}console.log('MATRIX',matrix,'changed',changed);
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
