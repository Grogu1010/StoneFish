const fs=require('fs');
const source=fs.readFileSync('tools/v4-tune.js','utf8');
const start=source.indexOf('const base=['), end=source.indexOf('\n`;\nnew Function',start);
if(start<0||end<0)throw new Error('Could not locate harness tail');
const tail=String.raw`const configs=[
 {name:'old_h3',order:['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl']},
 {name:'kp_before_support',order:['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']},
 {name:'kp_after_support',order:['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingProtection','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']}
];
const blocks=[62000,64000,66000];
for(const cfg of configs){let W=0,L=0,D=0;console.log('VALIDATE',cfg.name);for(const startSeed of blocks){const r=test(cfg,100,startSeed);W+=r.W;L+=r.L;D+=r.D;console.log('BLOCK',startSeed,r);}console.log('TOTAL',cfg.name,{W,L,D,games:300});}`;
eval(source.slice(0,start)+tail+source.slice(end));
