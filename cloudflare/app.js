import base from './worker.js';
import {ensureAdmin} from './bootstrap.js';
import {renderQr} from './qr.js';
import {exportResults} from './export.js';
export default {async fetch(req,env,ctx){
 const url=new URL(req.url),path=url.pathname;
 if(path==='/api/setup-check'&&req.method==='GET'){
  let adminCount=null,dbError=null;
  try {if(env.DB){const r=await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first();adminCount=r?.n??0;}}
  catch(e){dbError='DB query failed';}
  return new Response(JSON.stringify({
   dbConnected:!!env.DB,
   adminNameConfigured:!!String(env.BOOTSTRAP_ADMIN_NAME||'').trim(),
   adminCodeConfigured:typeof env.BOOTSTRAP_ADMIN_CODE==='string'&&env.BOOTSTRAP_ADMIN_CODE.length>=12,
   adminCount,dbError
  }),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
 }
 if(path==='/api/login'&&req.method==='POST'){const data=await req.clone().json().catch(()=>({}));if(data.role==='admin'){try{await ensureAdmin(env)}catch(e){return new Response(JSON.stringify({error:'관리자 계정 초기화 실패: '+String(e?.message||e).slice(0,180),stage:'bootstrap',type:e?.name||'Error',detail:String(e?.message||'').slice(0,180)}),{status:500,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}}}
 if(path!=='/api/admin/qr.svg'&&path!=='/api/admin/export.xlsx')return base.fetch(req,env,ctx);
 const check=await base.fetch(new Request(new URL('/api/me',url),{headers:req.headers}),env,ctx);
 const me=await check.json().catch(()=>({}));
 if(me.role!=='admin')return new Response(JSON.stringify({error:'관리자 권한이 필요합니다'}),{status:401,headers:{'content-type':'application/json'}});
 const row=await env.DB.prepare('SELECT data FROM app_state WHERE id=1').first(),state=JSON.parse(row?.data||'{}');
 if(path==='/api/admin/qr.svg'){
  const round=String(url.searchParams.get('round')||'').trim();
  if(!round||!state.products?.some(x=>x.round===round))return new Response('등록된 회차가 아닙니다',{status:404});
  const target=new URL('/evaluate.html?round='+encodeURIComponent(round),url).href;
  return new Response(await renderQr(target),{headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':'no-store'}});
 }
 const rows=(await env.DB.prepare('SELECT data FROM responses').all()).results.map(x=>JSON.parse(x.data));
 const bytes=exportResults(state,rows,url.searchParams);
 const filename=url.searchParams.get('productId')?'상품별_평가결과.xlsx':'정책협의회_평가결과.xlsx';
 return new Response(bytes,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(filename),'cache-control':'no-store'}});
}};
