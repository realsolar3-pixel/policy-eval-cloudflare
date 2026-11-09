import {ensureAdmin} from './bootstrap.js';
const norm=x=>String(x||'').trim().replace(/\s+/g,'').toLowerCase();
const defaults={threshold:70,products:[],evaluators:[],round:'',roundEvaluators:{},links:{},templates:[]};
const enc=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const salt=()=>'p20k$'+hex(crypto.getRandomValues(new Uint8Array(16)));
const pin4=()=>String(crypto.getRandomValues(new Uint16Array(1))[0]%10000).padStart(4,'0');
const scryptNote='Cloudflare uses PBKDF2-SHA256 for new accounts; Railway scrypt hashes require credential reset on migration.';
async function hash(s,sl){const k=await crypto.subtle.importKey('raw',enc.encode(s),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(sl),iterations:String(sl).startsWith('p20k$')?20000:100000,hash:'SHA-256'},k,256))}
const json=(v,status=200,headers={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const fail=(m,s=400)=>json({error:m},s);
const get=async(db,sql,...p)=>db.prepare(sql).bind(...p).first();
const all=async(db,sql,...p)=>(await db.prepare(sql).bind(...p).all()).results;
const run=async(db,sql,...p)=>db.prepare(sql).bind(...p).run();
const state=async db=>JSON.parse((await get(db,'SELECT data FROM app_state WHERE id=1'))?.data||JSON.stringify(defaults));
const eligible=(p,n,roster)=> (Array.isArray(p.eligibleEvaluators)?p.eligibleEvaluators:roster).some(x=>norm(x)===norm(n))&&(!p.proposer||norm(p.proposer)!==norm(n));
const cookie=req=>req.headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]||'';
const cookieHeader=(t,max)=>'session='+t+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+max;
async function auth(req,db){const t=cookie(req);if(!t)return null;return get(db,'SELECT u.id,u.name,u.role,s.auth_round FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',await sha(t),new Date().toISOString())}
async function makeUser(db,name,role,code){const sl=salt();await run(db,'INSERT OR IGNORE INTO users(id,name,normalized,role,salt,secret_hash,initial_code) VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),name,norm(name),role,sl,await hash(code,sl),role==='evaluator'?code:null)}
async function handle(req,env){
 const db=env.DB,u=new URL(req.url),p=u.pathname,m=req.method;
 if(!db)return fail('D1 연결이 없습니다',503);
 if(p==='/health')return json({ok:true});
 if(!p.startsWith('/api/')){if(p==='/')return Response.redirect(new URL('/evaluate.html',u),302);return env.ASSETS.fetch(req)}
 if(!['GET','POST','PUT','DELETE'].includes(m))return fail('지원하지 않는 요청',405);
 if(m!=='GET'&&p!=='/api/login'&&req.headers.get('origin')&&new URL(req.headers.get('origin')).host!==u.host)return fail('허용되지 않은 요청',403);
 let b={};if(m!=='GET'){try{b=await req.json()}catch{return fail('JSON 요청이 필요합니다')}}
 const user=await auth(req,db);
 if(p==='/api/login'&&m==='POST'){
  if(b.role==='admin'){
   try {await ensureAdmin(env)} catch(e){console.error('Admin bootstrap failed',e);return fail('관리자 계정 생성 실패: '+String(e?.message||e).slice(0,150),500)}
   const count=await get(db,"SELECT COUNT(*) AS n FROM users WHERE role='admin'");
   if(!count?.n)return fail('관리자 계정 미생성: 런타임 변수 또는 DB 설정 확인',503);
  }
  const name=String(b.name||''),code=String(b.code||''),role=b.role;
  if(!name||!code||!['admin','evaluator'].includes(role))return fail('인증정보 필요');
  const person=await get(db,'SELECT * FROM users WHERE normalized=? AND role=?',norm(name),role);
  let valid=false,round=null;
  if(person&&role==='admin'){valid=(await hash(code,person.salt))===person.secret_hash;if(valid&&!String(person.salt).startsWith('p20k$')){const sl=salt();await run(db,'UPDATE users SET salt=?,secret_hash=? WHERE id=?',sl,await hash(code,sl),person.id)}}
  if(person&&role==='evaluator'){
   round=String(b.round||'').trim();const st=await state(db);
   const active=await get(db,'SELECT status FROM round_status WHERE round=?',round);
   const access=await get(db,'SELECT * FROM round_access WHERE round=?',round);
   if(round&&active?.status==='open'&&access&&(st.roundEvaluators?.[round]||[]).some(n=>norm(n)===norm(name)))valid=(await hash(code,access.salt))===access.code_hash;
  }
  if(!valid)return fail('이름·회차 또는 공통 비밀번호가 올바르지 않습니다',401);
  const token=hex(crypto.getRandomValues(new Uint8Array(24)));
  await run(db,'INSERT INTO sessions(token_hash,user_id,expires_at,auth_round) VALUES(?,?,?,?)',await sha(token),person.id,new Date(Date.now()+43200000).toISOString(),round);
  return json({name:person.name,role,round},200,{'set-cookie':cookieHeader(token,43200)});
 }
 if(p==='/api/me'&&m==='GET')return json(user||{role:null});
 if(p==='/api/logout'&&m==='POST'){if(cookie(req))await run(db,'DELETE FROM sessions WHERE token_hash=?',await sha(cookie(req)));return json({ok:true},200,{'set-cookie':cookieHeader('',0)})}
 if(!user)return fail('로그인이 필요합니다',401);
 if(p.startsWith('/api/admin/')){
  if(user.role!=='admin')return fail('관리자 권한이 필요합니다',403);
  if(p==='/api/admin/state'&&m==='GET'){const s=await state(db),rows=await all(db,'SELECT data FROM responses'),results={};for(const r of rows){const d=JSON.parse(r.data);results[norm(d.evaluator)+'|'+d.round]=d}return json({...s,results})}
  if(p==='/api/admin/state'&&m==='PUT'){
   const {threshold,products,evaluators,round,roundEvaluators,links,templates}=b;
   if(!Number.isInteger(threshold)||threshold<0||threshold>200||!Array.isArray(products)||!Array.isArray(evaluators)||products.length>200||evaluators.length>300||!roundEvaluators||typeof roundEvaluators!=='object'||Array.isArray(roundEvaluators))return fail('설정 형식 오류');
   for(const names of Object.values(roundEvaluators)){if(!Array.isArray(names)||new Set(names.map(norm)).size!==names.length||names.some(n=>!evaluators.some(e=>norm(e.name)===norm(n))))return fail('회차별 평가위원 명단 오류')}
   const ids=new Set();for(const prod of products){if(!prod.id||!prod.name||!prod.round||ids.has(prod.id)||!prod.stages?.s3||!prod.stages?.s4)return fail('상품 설정 오류');ids.add(prod.id);if(prod.eligibleEvaluators!==undefined&&(!Array.isArray(prod.eligibleEvaluators)||prod.eligibleEvaluators.some(n=>!evaluators.some(e=>norm(e.name)===norm(n)))))return fail('평가위원 지정 오류');for(const k of ['s3','s4'])if(!Array.isArray(prod.stages[k].items))return fail('평가항목 설정 오류')}
   const curRev=(await state(db)).rev||0;if(b.rev!==curRev)return fail('다른 화면에서 내용이 바뀌었습니다. 새로고침(F5)한 뒤 다시 저장해 주세요.',409);
   const saved=await run(db,"UPDATE app_state SET data=? WHERE id=1 AND COALESCE(json_extract(data,'$.rev'),0)=?",JSON.stringify({threshold,products,evaluators,round,roundEvaluators,links:links||{},templates:Array.isArray(templates)?templates:[],rev:curRev+1}),curRev);
   if(!saved.meta?.changes)return fail('다른 화면에서 내용이 바뀌었습니다. 새로고침(F5)한 뒤 다시 저장해 주세요.',409);
   const existing=new Set((await all(db,"SELECT normalized FROM users WHERE role='evaluator'")).map(x=>x.normalized));
   for(const e of evaluators)if(e.name&&!existing.has(norm(e.name))){await makeUser(db,e.name,'evaluator',pin4());existing.add(norm(e.name))}
   return json({ok:true,rev:curRev+1});
  }
  if(p==='/api/admin/round-access'&&m==='GET')return json({rounds:(await all(db,'SELECT round FROM round_access ORDER BY round')).map(x=>x.round)});
  if(p==='/api/admin/round-access'&&m==='PUT'){
   const round=String(b.round||'').trim(),code=String(b.code||'');if(!round||code.length<6||code.length>100)return fail('회차와 6자 이상 공통 비밀번호를 입력해 주세요');
   {const st=await state(db);if(!st.products.some(x=>x.round===round)&&!Object.keys(st.roundEvaluators||{}).includes(round))return fail('등록된 회차만 설정할 수 있습니다')}
   const sl=salt();await run(db,'INSERT INTO round_access(round,salt,code_hash) VALUES(?,?,?) ON CONFLICT(round) DO UPDATE SET salt=excluded.salt,code_hash=excluded.code_hash',round,sl,await hash(code,sl));await run(db,"DELETE FROM sessions WHERE auth_round=?",round);return json({ok:true});
  }
  if(p==='/api/admin/round-status'&&m==='GET')return json({statuses:Object.fromEntries((await all(db,'SELECT round,status FROM round_status')).map(x=>[x.round,x.status]))});
  if(p==='/api/admin/round-status'&&m==='PUT'){
   const round=String(b.round||''),status=String(b.status||'');if(!['open','closed'].includes(status))return fail('상태 오류');
   if(!(await state(db)).products.some(x=>x.round===round))return fail('등록된 회차가 아닙니다',404);
   if(status==='open'&&!(await get(db,'SELECT round FROM round_access WHERE round=?',round)))return fail('회차 비밀번호를 먼저 설정해 주세요');
   await db.batch([db.prepare('INSERT INTO round_status(round,status) VALUES(?,?) ON CONFLICT(round) DO UPDATE SET status=excluded.status').bind(round,status),db.prepare('DELETE FROM sessions WHERE auth_round=?').bind(round)]);return json({ok:true,status});
  }
  if(p==='/api/admin/round-data'&&m==='DELETE'){
   const round=String(b.round||'');if(!round||b.confirm!==round)return fail('회차명 확인이 일치하지 않습니다');
   if((await get(db,'SELECT status FROM round_status WHERE round=?',round))?.status!=='closed')return fail('종료된 회차만 삭제할 수 있습니다');
   const s=await state(db);if(!s.products.some(x=>x.round===round))return fail('회차가 존재하지 않습니다');
   s.products=s.products.filter(x=>x.round!==round);if(s.round===round)s.round=s.products.at(-1)?.round||'';delete s.roundEvaluators?.[round];if(s.links)delete s.links[round];s.rev=(s.rev||0)+1;
   await db.batch([db.prepare('DELETE FROM sessions WHERE auth_round=?').bind(round),db.prepare('DELETE FROM response_history WHERE round=?').bind(round),db.prepare('DELETE FROM responses WHERE round=?').bind(round),db.prepare('DELETE FROM round_access WHERE round=?').bind(round),db.prepare('DELETE FROM round_status WHERE round=?').bind(round),db.prepare('UPDATE app_state SET data=? WHERE id=1').bind(JSON.stringify(s))]);return json({ok:true});
  }
  if(p==='/api/admin/codes'&&m==='GET')return json({codes:await all(db,"SELECT name,initial_code code FROM users WHERE role='evaluator' ORDER BY name")});
  if(p==='/api/admin/rotate-evaluator-codes'&&m==='POST'){const people=await all(db,"SELECT id FROM users WHERE role='evaluator'"),updates=[];for(const x of people){const code=pin4(),sl=salt();updates.push(db.prepare('UPDATE users SET salt=?,secret_hash=?,initial_code=? WHERE id=?').bind(sl,await hash(code,sl),code,x.id))}updates.push(db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='evaluator')"));await db.batch(updates);return json({ok:true,count:people.length})}
  if(p==='/api/admin/add-admin'&&m==='POST'){if(!b.name||!b.code||b.code.length<12)return fail('관리자 인증코드 12자 이상');await makeUser(db,b.name,'admin',b.code);return json({ok:true})}
  if(p==='/api/admin/response'&&m==='DELETE'){const person=await get(db,"SELECT id FROM users WHERE normalized=? AND role='evaluator'",norm(b.evaluator));if(!person)return fail('평가위원을 찾을 수 없습니다',404);await run(db,'DELETE FROM responses WHERE user_id=? AND round=?',person.id,b.round);return json({ok:true})}
  if(p==='/api/admin/import-result'&&m==='POST'){
   const s=await state(db);if(b.type!=='policy-eval-result'||!b.evaluator||!b.results||typeof b.results!=='object')return fail('결과 형식 오류');
   const person=await get(db,"SELECT id FROM users WHERE normalized=? AND role='evaluator'",norm(b.evaluator));if(!person)return fail('등록되지 않은 평가위원');
   const matched=s.products.filter(x=>b.results[x.id]);if(!matched.length)return fail('일치하는 상품 없음');const round=String(b.round||matched[0].round);if(matched.some(x=>x.round!==round))return fail('회차 혼합');
   const old=await get(db,'SELECT data FROM responses WHERE user_id=? AND round=?',person.id,round),clean={type:'policy-eval-result',formId:b.formId||'import-'+round,round,evaluator:b.evaluator,savedAt:new Date().toISOString(),results:{...(old?JSON.parse(old.data).results:{})}};
   for(const prod of matched){const a=b.results[prod.id],out={};for(const k of ['s3','s4']){const cfg=prod.stages[k],st=a[k];if(!st||!Array.isArray(st.scores)||(!cfg.skipQual&&(st.scores.length!==cfg.items.length||st.scores.some((v,i)=>!Number.isInteger(v)||v<0||v>cfg.items[i].max))))return fail('평가점수 오류');const total=Number(cfg.quant||0)+st.scores.reduce((x,y)=>x+y,0);if((cfg.skipQual||total<s.threshold)&&!['찬성','반대'].includes(st.vote))return fail('찬반 누락');out[k]={scores:st.scores,vote:st.vote||null}}clean.results[prod.id]={...out,complete:true}}
   const batch=[];if(old)batch.push(db.prepare('INSERT INTO response_history(user_id,round,data) VALUES(?,?,?)').bind(person.id,round,old.data));batch.push(db.prepare('INSERT INTO responses(user_id,round,form_id,data) VALUES(?,?,?,?) ON CONFLICT(user_id,round) DO UPDATE SET data=excluded.data,form_id=excluded.form_id,saved_at=CURRENT_TIMESTAMP').bind(person.id,round,clean.formId,JSON.stringify(clean)));await db.batch(batch);return json({ok:true,products:matched.length});
  }
  if(p==='/api/admin/qr.svg'||p==='/api/admin/export.xlsx')return fail('QR·Excel 내보내기 기능은 아직 이전 중입니다',501);
  return fail('요청한 API가 없습니다',404);
 }
 if(user.role!=='evaluator')return fail('평가위원 권한이 필요합니다',403);
 const round=String(m==='GET'?u.searchParams.get('round')||'':b.round||'');
 if(user.auth_round!==round)return fail('해당 회차로 다시 로그인해 주세요',403);
 if((await get(db,'SELECT status FROM round_status WHERE round=?',round))?.status!=='open')return fail('평가 진행 중인 회차가 아닙니다',403);
 if(p==='/api/form'&&m==='GET'){const s=await state(db),products=s.products.filter(x=>x.round===round&&eligible(x,user.name,s.roundEvaluators?.[round]||[]));return json({formId:'mobile-'+round,round,products,threshold:s.threshold,evaluators:s.evaluators.map(x=>x.name)})}
 if(p==='/api/my-response'&&m==='GET'){const r=await get(db,'SELECT data,saved_at FROM responses WHERE user_id=? AND round=?',user.id,round);return json({response:r?JSON.parse(r.data):null,savedAt:r?.saved_at||null})}
 if(p==='/api/submit'&&m==='POST'){
  const s=await state(db),products=s.products.filter(x=>x.round===round&&eligible(x,user.name,s.roundEvaluators?.[round]||[]));
  if(!round||!products.length||b.type!=='policy-eval-result'||norm(b.evaluator)!==norm(user.name)||!b.results||typeof b.results!=='object')return fail('평가자료 형식 오류');
  if(Object.keys(b.results).some(id=>!products.some(x=>x.id===id)))return fail('평가 권한 없는 안건 포함');
  for(const prod of products){const a=b.results[prod.id];if(!a?.complete)return fail('모든 상품을 평가해 주세요');for(const k of ['s3','s4']){const cfg=prod.stages[k],st=a[k];if(!cfg||!st||!Array.isArray(st.scores))return fail('점수 누락');if(!cfg.skipQual&&(st.scores.length!==cfg.items.length||st.scores.some((v,i)=>!Number.isInteger(v)||v<0||v>cfg.items[i].max)))return fail('점수 범위 오류');const total=Number(cfg.quant||0)+st.scores.reduce((x,y)=>x+y,0);if((cfg.skipQual||total<s.threshold)&&!['찬성','반대'].includes(st.vote))return fail('찬반 누락')}}
  const clean={type:'policy-eval-result',round,formId:'mobile-'+round,evaluator:user.name,results:b.results,savedAt:new Date().toISOString()},old=await get(db,'SELECT data FROM responses WHERE user_id=? AND round=?',user.id,round),batch=[];
  if(old)batch.push(db.prepare('INSERT INTO response_history(user_id,round,data) VALUES(?,?,?)').bind(user.id,round,old.data));
  batch.push(db.prepare('INSERT INTO responses(user_id,round,form_id,data) VALUES(?,?,?,?) ON CONFLICT(user_id,round) DO UPDATE SET data=excluded.data,form_id=excluded.form_id,saved_at=CURRENT_TIMESTAMP').bind(user.id,round,clean.formId,JSON.stringify(clean)));
  await db.batch(batch);return json({ok:true,savedAt:clean.savedAt});
 }
 return fail('요청한 API가 없습니다',404);
}
export default {async fetch(req,env){try{return await handle(req,env)}catch(e){console.error(e);return fail('서버 오류',500)}}};
