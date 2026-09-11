const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side,visits=g.positionCounts.get(g.fastPositionKey())||0,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
function cycleProgress(g,m,leadMin){const visits=g.positionCounts.get(g.fastPositionKey())||0;if(visits<2)return 0;const s=g.side,lead=npm(g,s)-npm(g,-s);if(lead<leadMin)return 0;return(m.piece===1||m.captured)?1:0;}
function feature(g,m,c){if(c==='rep2Lead2_5')return repByLead(g,m,1,2.5);if(c==='cycleProgress2_5')return cycleProgress(g,m,2.5);`);
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const ctrlCfg={name:'control',order:['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl']};
const bestCfg={name:'best',order:['promotion','rep2Lead2_5','castleNow','openingDevelop','hangingMax','cycleProgress2_5','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl']};
const starts=[760000,780000,800000,840000];
for(const cfg of[ctrlCfg,bestCfg]){let W=0,L=0,D=0;console.log('CFG',cfg.name);for(const st of starts){const r=test(cfg,100,st);W+=r.W;L+=r.L;D+=r.D;console.log(' BLOCK',st,r);}console.log('TOTAL',cfg.name,{W,L,D,games:400,score:W-8*L+.01*D});}
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
