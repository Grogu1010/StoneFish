const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`function fourthRisk(g,root){
  g.fastApply(root);
  const replies=g.fastMoves();
  if(!replies.length){g.fastUndo();return 0;}
  let worst=0;
  for(const reply of replies){
    g.fastApply(reply);
    const responses=g.fastMoves();
    if(!responses.length&&g.in_check()){g.fastUndo();g.fastUndo();return -1000000;}
    let bestGain=-1;
    for(const r of responses){const x=V[r.captured]||0;if(x>bestGain)bestGain=x;}
    let bestRisk=Infinity;
    for(const response of responses){
      if((V[response.captured]||0)!==bestGain)continue;
      g.fastApply(response);
      const fourth=g.fastMoves();
      let risk=0;
      for(const fm of fourth){const cap=V[fm.captured]||0;if(cap>risk)risk=cap;}
      g.fastUndo();
      if(risk<bestRisk)bestRisk=risk;
    }
    if(bestRisk===Infinity)bestRisk=0;
    g.fastUndo();
    if(bestRisk>worst)worst=bestRisk;
  }
  g.fastUndo();
  return -worst;
}
function feature(g,m,c){if(c==='fourthRisk')return fourthRisk(g,m);`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];const base=${JSON.stringify(base)};function add(name,pos,e){const o=base.slice();o.splice(pos,0,'fourthRisk');C.push({name,order:o,developUntil:8,queenUntil:14,endgameMaterial:e});}
for(const e of[10,14]){add('hang_e'+e,4,e);add('queen_e'+e,5,e);add('mob_e'+e,9,e);}
console.log('FOURTH RISK SCREEN',C.length,'x 16');const s=C.map(c=>({cfg:c,r:test(c,16,221000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('FOURTH RISK CONFIRM top 4 x 50');const c=s.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,50,224000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('FOURTH RISK FINAL top 2 x 100');const f=c.slice(0,2).map(x=>({cfg:x.cfg,r:test(x.cfg,100,230000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
