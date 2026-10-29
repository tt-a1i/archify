import {compileExplainerChart} from '../../../../archify/explainer/charts.mjs';
const prefixes={plain:'',frontmatter:'---\nconfig:\n  pie:\n    legendPosition: bottom\n---\n',directive:'%%{init: {"pie":{"legendPosition":"bottom"}}}%%\n'};
const output=Object.entries(prefixes).map(([kind,prefix])=>{
 const input=prefix+'pie\n  "A" : 10\n  "B" : 3\n  "C" : 8';
 const result=compileExplainerChart(input);
 return {kind,input,width:result.width,height:result.height,error:result.error??null,legend:result.svg?.match(/<g class="pele-legend"[\s\S]*?<\/svg>/)?.[0]??null};
});
console.log(JSON.stringify(output,null,2));
