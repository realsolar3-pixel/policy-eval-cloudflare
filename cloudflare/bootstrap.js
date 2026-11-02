export async function ensureAdmin(env){
 if(!env.DB||!env.BOOTSTRAP_ADMIN_NAME||!env.BOOTSTRAP_ADMIN_CODE||env.BOOTSTRAP_ADMIN_CODE.length<12)return;
 const exists=await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
 if(exists)return;
 const name=env.BOOTSTRAP_ADMIN_NAME;
 const normalized=name.trim().replace(/\s+/g,'').toLowerCase();
 const salt=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BOOTSTRAP_ADMIN_CODE),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},key,256);
 const digest=Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT OR IGNORE INTO users(id,name,normalized,role,salt,secret_hash,initial_code) VALUES(?,?,?,?,?,?,NULL)').bind(crypto.randomUUID(),name,normalized,'admin',salt,digest).run();
}
