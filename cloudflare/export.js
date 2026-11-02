import {buildXlsx} from './xlsx.js';
const norm=x=>String(x||'').trim().replace(/\s+/g,'').toLowerCase();
const eligible=(p,n,roster)=>(Array.isArray(p.eligibleEvaluators)?p.eligibleEvaluators:roster).some(x=>norm(x)===norm(n))&&(!p.proposer||norm(p.proposer)!==norm(n));
export function exportResults(state,records,params){
 const selected=state.products.filter(p=>(!params.get('productId')||p.id===params.get('productId'))&&(!params.get('round')||p.round===params.get('round')));
 const summary=[['상품명','회차','회신/전체','3단계 정량','3단계 평균 총점','3단계 찬성','3단계 반대','4단계 정량','4단계 평균 총점','4단계 찬성','4단계 반대']];
 const sheets=[{name:'전체 요약',rows:summary}],used=new Set(['전체 요약']);
 for(const p of selected){
  const roster=state.roundEvaluators?.[p.round]||[];
  const names=state.evaluators.filter(e=>eligible(p,e.name,roster)).map(e=>e.name);
  const done=records.filter(r=>r.round===p.round&&r.results?.[p.id]?.complete&&names.some(n=>norm(n)===norm(r.evaluator)));
  const stats={};
  for(const k of ['s3','s4']){
   const cfg=p.stages[k],scores=done.map(r=>r.results[p.id][k]?.scores).filter(a=>Array.isArray(a)&&a.length===cfg.items.length&&a.every(Number.isInteger));
   const totals=cfg.skipQual?[]:scores.map(a=>Number(cfg.quant||0)+a.reduce((x,y)=>x+y,0));
   stats[k]={avg:totals.length?Math.round(totals.reduce((a,b)=>a+b,0)/totals.length*10)/10:'',yes:done.filter(r=>r.results[p.id][k]?.vote==='찬성').length,no:done.filter(r=>r.results[p.id][k]?.vote==='반대').length};
  }
  summary.push([p.name,p.round,done.length+'/'+names.length,p.stages.s3.quant,p.stages.s3.skipQual?'정성 생략':stats.s3.avg,stats.s3.yes,stats.s3.no,p.stages.s4.quant,p.stages.s4.skipQual?'정성 생략':stats.s4.avg,stats.s4.yes,stats.s4.no]);
  let name=p.name.replace(/[\\/?*\[\]:]/g,' ').slice(0,25)||'상품',i=2;
  while(used.has(name))name=(p.name.slice(0,20)+' '+i++).slice(0,31);
  used.add(name);
  const headers=['평가위원','상태'];
  for(const k of ['s3','s4']){
   const cfg=p.stages[k],prefix=k==='s3'?'3단계':'4단계';
   headers.push(prefix+' 정량');
   if(!cfg.skipQual){cfg.items.forEach((it,j)=>headers.push(prefix+' 정성'+(j+1)+': '+it.label+' ('+it.max+')'));headers.push(prefix+' 정성계',prefix+' 총점')}
   headers.push(prefix+' 찬반');
  }
  headers.push('제출 시각');
  const rows=[headers];
  for(const person of names){
   const r=done.find(x=>norm(x.evaluator)===norm(person)),row=[person,r?'회신':'미회신'];
   for(const k of ['s3','s4']){
    const cfg=p.stages[k],a=r?.results?.[p.id]?.[k];
    row.push(cfg.quant);
    if(!cfg.skipQual){cfg.items.forEach((_,j)=>row.push(a?.scores?.[j]??''));const q=a?.scores?.reduce((x,y)=>x+y,0);row.push(q??'',q===undefined?'':Number(cfg.quant||0)+q)}
    row.push(a?.vote||'');
   }
   row.push(r?.savedAt||'');rows.push(row);
  }
  sheets.push({name,rows});
 }
 return buildXlsx(sheets);
}
