const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','assets','api.js'),'utf8');
function fixture(options={}){
  let now=Date.parse('2026-10-23T03:00:00Z');
  class Clock extends Date {static now(){return now;}}
  const stored=options.stored||new Map(),temporary=options.temporary||new Map(),calls=[],storage=m=>({getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)});
  const c={Date:Clock,JSON,Number,String,Error,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,location:{origin:'https://example.github.io',pathname:'/supplies/'},localStorage:storage(stored),sessionStorage:storage(temporary),VILLA_CONFIG:{webAppUrl:'https://script.google.com/macros/s/test_deployment/exec',liffId:'2011171771-Abc123'},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true,authProtocol:'line-access-v1',data:{token:'app-session',expiresAt:now+3600000}})}},liff:{init:async()=>{},isLoggedIn:()=>true,getIDToken:()=>{throw Error('cached ID token must not be used');},getAccessToken:()=>('line-access-token').padEnd(40,'_'),isInClient:()=>false,logout:()=>{c.lineLoggedOut=true;},login:options=>{c.redirect=options;}}};
  c.window=c;vm.createContext(c);vm.runInContext(source,c);
  return {c,api:c.VillaAPI,stored,temporary,calls,advance:ms=>{now+=ms;}};
}
(async()=>{
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
await test('API sends a readable simple POST, with tokens in the body only',async()=>{const f=fixture();await f.api.request('restoreSession','secret-session');const {url,options}=f.calls[0];assert.equal(url,f.c.VILLA_CONFIG.webAppUrl);assert.ok(!url.includes('secret-session'));assert.equal(options.method,'POST');assert.equal(options.mode,'cors');assert.equal(options.redirect,'follow');assert.equal(options.credentials,'omit');assert.equal(options.headers['Content-Type'],'text/plain;charset=utf-8');assert.equal(JSON.parse(options.body).args[0],'secret-session');});
await test('stores only app token and expiry; expired sessions are removed',()=>{const f=fixture();f.api.saveSession({token:'app-token',expiresAt:f.c.Date.now()+3600000,name:'Private',role:'Admin',idToken:'LINE-secret'});assert.deepEqual(Object.keys(JSON.parse([...f.stored.values()][0])).sort(),['expiresAt','token']);assert.equal(f.api.readSession().token,'app-token');f.advance(3600000);assert.equal(f.api.readSession(),null);assert.equal(f.stored.size,0);});
await test('invalid API URLs and missing LIFF config fail before network calls',async()=>{for(const value of ['http://script.google.com/macros/s/test/exec','https://evil.test/macros/s/test/exec','https://script.google.com/macros/s/test/dev','https://script.google.com/macros/s/test/exec?token=x']){const f=fixture();f.c.VILLA_CONFIG.webAppUrl=value;await assert.rejects(()=>f.api.request('restoreSession','secret'),/webAppUrl/);assert.equal(f.calls.length,0);}const f=fixture();f.c.VILLA_CONFIG.liffId='';assert.throws(()=>f.api.validateConfig(),/liffId/);});
await test('LINE access token is submitted for server verification without reading or storing a cached ID token',async()=>{const f=fixture();const user=await f.api.login();assert.equal(user.token,'app-session');assert.equal(JSON.parse(f.calls[0].options.body).action,'loginWithLine');assert.match(JSON.parse(f.calls[0].options.body).args[0].accessToken,/^line-access-token/);assert.equal(f.stored.size,0);assert.equal(f.temporary.size,0);});
await test('LINE callback returns to the same GitHub Pages path',async()=>{const f=fixture();f.c.liff.isLoggedIn=()=>false;assert.equal(await f.api.login(),null);assert.equal(f.c.redirect.redirectUri,'https://example.github.io/supplies/');assert.equal(f.api.pendingLogin(),true);assert.equal(f.calls.length,0);f.advance(600001);assert.equal(f.api.pendingLogin(),false);});
await test('missing ID token does not block verified access-token identity',async()=>{const f=fixture();f.c.liff.getIDToken=()=>null;assert.equal((await f.api.login()).token,'app-session');assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].options.body).args[0].idToken,undefined);});
await test('business, JSON and network errors are surfaced without retrying writes',async()=>{const f=fixture();let calls=0;f.c.fetch=async()=>{calls++;return {ok:true,json:async()=>({ok:false,error:'SESSION_EXPIRED: login again'})};};await assert.rejects(()=>f.api.request('processOrder',{}),/SESSION_EXPIRED/);assert.equal(calls,1);f.c.fetch=async()=>({ok:true,json:async()=>{throw Error('HTML sign-in page');}});await assert.rejects(()=>f.api.request('restoreSession','token'),/JSON/);f.c.fetch=async()=>{throw Error('network');};await assert.rejects(()=>f.api.request('processOrder',{}),/เชื่อมต่อ API/);});
await test('blocked browser storage does not crash cleanup',()=>{const f=fixture();f.c.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};assert.equal(f.api.saveSession({token:'x',expiresAt:1}),false);assert.equal(f.api.readSession(),null);assert.doesNotThrow(()=>f.api.clearSession());});
await test('static UI assets and DOM references are complete; no Apps Script HTML remains',()=>{const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),app=fs.readFileSync(path.join(root,'assets','app.js'),'utf8'),backend=fs.readFileSync(path.join(root,'apps-script','Code.gs'),'utf8');assert.ok(html.includes('id="line-login"'));assert.ok(html.includes('id="notice-dialog"'));assert.ok(!html.includes('<iframe'));assert.ok(!/google\.script|checkLogin|registerNewUser/.test(app));assert.ok(!/HtmlService|createTemplateFromFile|createHtmlOutputFromFile/.test(backend));assert.ok(!fs.existsSync(path.join(root,'apps-script','index.html')));const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size,'duplicate DOM IDs');for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){if(!/^https?:/.test(match[1]))assert.ok(fs.existsSync(path.join(root,match[1].split('?')[0])),'missing asset '+match[1]);}const defined=new Set([...ids,...[...app.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1])]);for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(defined.has(match[1]),'missing element '+match[1]);});
await test('weekly planning UI uses totals, daily detail and stock suggestions with no average display',()=>{
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),app=fs.readFileSync(path.join(root,'assets','app.js'),'utf8');
  assert.ok(html.includes('id="weekly-search"'));assert.ok(html.includes('id="weekly-status"'));assert.ok(html.includes('id="weekly-overview"'));
  assert.ok(html.includes('พาร์เป้าหมาย − สต็อกคงเหลือ'));assert.ok(html.includes('คอลัมน์ K')); assert.ok(app.includes('i.dailyQty'));assert.ok(app.includes('i.recommendedQty'));
  assert.ok(app.includes('renderWeekly()'));assert.ok(!/avgPerDay|ค่าเฉลี่ยต่อวัน|เฉลี่ยวันละ|÷ 7/.test(app+html));
});
await test('identity verification sends the saved app token for fixed-expiry reuse',async()=>{
  const f=fixture();f.api.saveSession({token:'existing-app-session',expiresAt:f.c.Date.now()+3600000});
  await f.api.login();const body=JSON.parse(f.calls[0].options.body);
  assert.equal(body.args[0].token,'existing-app-session');assert.match(body.args[0].accessToken,/^line-access-token/);
});
await test('registration errors preserve the verified server destination without persisting LINE tokens',async()=>{
  const f=fixture();f.c.fetch=async()=>({ok:true,json:async()=>({ok:false,authProtocol:'line-access-v1',error:'REGISTRATION_REQUIRED: missing employee',code:'REGISTRATION_REQUIRED',registrationUrl:'https://liff.line.me/2011171771-2kU5r1Xp'})});
  let error;try{await f.api.login();}catch(e){error=e;}
  assert.equal(error.code,'REGISTRATION_REQUIRED');assert.equal(f.api.registrationDestination(error),'https://liff.line.me/2011171771-2kU5r1Xp');assert.equal(f.stored.size,0);
});
await test('only registration-required errors with safe HTTPS destinations can redirect',()=>{
  const f=fixture();for(const registrationUrl of ['javascript:alert(1)','http://example.test/','https://name:secret@example.test/','not a URL'])assert.equal(f.api.registrationDestination({code:'REGISTRATION_REQUIRED',registrationUrl}),null);
  assert.equal(f.api.registrationDestination({code:'ACCESS_DENIED',registrationUrl:'https://example.test/register'}),null);
});
await test('registration cannot redirect back into the current LIFF or the same app page',()=>{
  const f=fixture();
  assert.equal(f.api.registrationDestination({code:'REGISTRATION_REQUIRED',registrationUrl:'https://liff.line.me/'+f.c.VILLA_CONFIG.liffId}),null);
  assert.equal(f.api.registrationDestination({code:'REGISTRATION_REQUIRED',registrationUrl:'https://example.github.io/supplies/'}),null);
  assert.equal(f.api.registrationDestination({code:'REGISTRATION_REQUIRED',registrationUrl:'https://example.github.io/supplies/index.html'}),null);
});
await test('explicit LINE renewal logs out and starts fresh authorization without resubmitting an invalid token',async()=>{
  const f=fixture();f.api.saveSession({token:'existing-app-session',expiresAt:f.c.Date.now()+123000});
  assert.equal(await f.api.login({fresh:true}),null);assert.equal(f.c.lineLoggedOut,true);
  assert.equal(f.c.redirect.redirectUri,'https://example.github.io/supplies/');assert.equal(f.calls.length,0);
  assert.equal(f.api.readSession().expiresAt,f.c.Date.now()+123000);assert.equal(f.api.pendingLogin(),true);
});
await test('LINE renewal in a LIFF browser re-enters its own LIFF URL and never calls liff.login',async()=>{
  const f=fixture();f.c.liff.isInClient=()=>true;f.c.location.replace=url=>{f.c.reopened=url;};
  f.c.liff.login=()=>{throw Error('unsupported in LIFF browser');};
  assert.equal(await f.api.login({fresh:true}),null);assert.equal(f.c.reopened,'https://liff.line.me/'+f.c.VILLA_CONFIG.liffId);
  assert.equal(f.c.lineLoggedOut,true);assert.equal(f.calls.length,0);
});
await test('a channel mismatch stops without unnecessary reauthorization',async()=>{
  const f=fixture();f.c.fetch=async(url,options)=>{f.calls.push({url,options});return {ok:true,json:async()=>({ok:false,authProtocol:'line-access-v1',code:'LINE_CHANNEL_MISMATCH',error:'LINE_CHANNEL_MISMATCH: mismatch'})};};
  await assert.rejects(()=>f.api.login(),e=>e.code==='LINE_CHANNEL_MISMATCH');
  assert.equal(f.calls.length,1);assert.equal(f.c.lineLoggedOut,undefined);assert.equal(f.c.redirect,undefined);
});
await test('an invalid access token automatically reauthorizes once, including across page reloads',async()=>{
  const stored=new Map(),temporary=new Map(),make=()=>{const f=fixture({stored,temporary});f.c.fetch=async()=>({ok:true,json:async()=>({ok:false,authProtocol:'line-access-v1',code:'LINE_ACCESS_INVALID',error:'LINE_ACCESS_INVALID: expired'})});return f;};
  const first=make();assert.equal(await first.api.login(),null);assert.equal(first.c.lineLoggedOut,true);assert.ok(first.c.redirect);
  const reopened=make();await assert.rejects(()=>reopened.api.login(),e=>e.code==='LINE_ACCESS_INVALID');
  assert.equal(reopened.c.lineLoggedOut,undefined);assert.equal(reopened.c.redirect,undefined);
});
await test('a missing access token automatically reauthorizes without sending a forged identity',async()=>{
  const f=fixture();f.c.liff.getAccessToken=()=>null;assert.equal(await f.api.login(),null);assert.ok(f.c.redirect);
  await assert.rejects(()=>f.api.login(),e=>e.code==='LINE_ACCESS_MISSING');assert.equal(f.calls.length,0);
});
await test('automatic renewal in a LIFF browser uses its LIFF URL rather than unsupported login calls',async()=>{
  const f=fixture();f.c.liff.isInClient=()=>true;f.c.location.replace=url=>{f.c.reopened=url;};f.c.liff.login=()=>{throw Error('unsupported');};
  f.c.fetch=async()=>({ok:true,json:async()=>({ok:false,authProtocol:'line-access-v1',code:'LINE_ACCESS_INVALID',error:'expired'})});
  assert.equal(await f.api.login(),null);assert.equal(f.c.reopened,'https://liff.line.me/'+f.c.VILLA_CONFIG.liffId);
});
await test('blocked session storage stops automatic redirect loops but leaves an explicit renewal possible',async()=>{
  const f=fixture();f.c.sessionStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  f.c.fetch=async()=>({ok:true,json:async()=>({ok:false,authProtocol:'line-access-v1',code:'LINE_ACCESS_INVALID',error:'expired'})});
  await assert.rejects(()=>f.api.login(),e=>e.code==='LINE_ACCESS_INVALID');assert.equal(f.c.redirect,undefined);
  assert.equal(await f.api.login({fresh:true}),null);assert.ok(f.c.redirect);
});
await test('an old backend reports an explicit deployment upgrade and does not trigger an authorization loop',async()=>{
  const f=fixture();f.c.fetch=async()=>({ok:true,json:async()=>({ok:false,error:'LINE token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'})});
  await assert.rejects(()=>f.api.login(),e=>e.code==='API_UPDATE_REQUIRED');assert.equal(f.c.redirect,undefined);
});
await test('successful verification clears only this LIFF renewal guard',async()=>{
  const f=fixture();await f.api.login({fresh:true});f.temporary.set('other-app:session','untouched');
  assert.ok([...f.temporary.keys()].some(k=>k.startsWith('villa-supplies:line-renewal:')));
  assert.equal((await f.api.login()).token,'app-session');assert.equal(f.temporary.get('other-app:session'),'untouched');
  assert.equal([...f.temporary.keys()].some(k=>k.startsWith('villa-supplies:line-renewal:')),false);
});
await test('actual client and backend enter directly with a valid access token despite an expired ID token',async()=>{
  const server=require('./backend.cjs').fixture(),f=fixture();server.claims.get(server.aliceToken).exp=0;
  f.api.saveSession(server.alice);f.c.liff.getAccessToken=()=>server.aliceAccessToken;
  f.c.fetch=async(url,options)=>({ok:true,json:async()=>JSON.parse(server.c.doPost({postData:{contents:options.body}}).text)});
  const user=await f.api.login();assert.equal(user.name,'Alice');assert.equal(user.role,'Staff');assert.equal(user.token,server.alice.token);
  assert.equal(user.expiresAt,server.alice.expiresAt);assert.equal(f.c.redirect,undefined);
  server.employees.rows[1][12]='';await assert.rejects(()=>f.api.login(),e=>e.code==='ACCESS_DENIED');assert.equal(f.c.redirect,undefined);
});
await test('actual client and backend route only verified unregistered accounts to existing registration',async()=>{
  const server=require('./backend.cjs').fixture(),f=fixture();server.accessTokens.get(server.aliceAccessToken).userId='U'+'d'.repeat(32);
  f.c.liff.getAccessToken=()=>server.aliceAccessToken;f.c.fetch=async(url,options)=>({ok:true,json:async()=>JSON.parse(server.c.doPost({postData:{contents:options.body}}).text)});
  let error;try{await f.api.login();}catch(e){error=e;}
  assert.equal(error.code,'REGISTRATION_REQUIRED');assert.equal(f.api.registrationDestination(error),'https://liff.line.me/2011171771-2kU5r1Xp');assert.equal(f.c.lineLoggedOut,undefined);
});
await test('desktop sessions restore without LINE and forged local flags cannot convert LINE sessions',async()=>{
  const f=fixture();f.c.liff=undefined;f.api.saveSession({token:'desktop-token',expiresAt:f.c.Date.now()+3600000,authMethod:'qr'});
  f.c.fetch=async()=>({ok:true,json:async()=>({ok:true,data:{token:'desktop-token',authMethod:'qr'}})});
  assert.equal((await f.api.restoreDesktopSession()).authMethod,'qr');
  f.c.fetch=async()=>({ok:true,json:async()=>({ok:true,data:{token:'line-token',authMethod:'line'}})});
  assert.equal(await f.api.restoreDesktopSession(),null);assert.equal(f.api.readSession(),null);
});
await test('revoked QR sessions clear local storage without initializing LINE',async()=>{
  const f=fixture();f.c.liff=undefined;f.api.saveSession({token:'desktop-token',expiresAt:f.c.Date.now()+3600000,authMethod:'qr'});
  f.c.fetch=async()=>({ok:true,json:async()=>({ok:false,code:'ACCESS_DENIED',error:'ACCESS_DENIED: revoked'})});
  await assert.rejects(()=>f.api.restoreDesktopSession(),e=>e.code==='ACCESS_DENIED');assert.equal(f.api.readSession(),null);assert.equal(f.c.redirect,undefined);
});
await test('old password sessions and password entry points are removed',async()=>{
  const f=fixture();f.stored.set(f.api.sessionKey,JSON.stringify({token:'old',authMethod:'warehouse',expiresAt:f.c.Date.now()+3600000}));
  assert.equal(await f.api.restoreDesktopSession(),null);assert.equal(f.calls.length,0);assert.equal(f.api.loginWarehouse,undefined);
});
await test('new QR UI reports an explicit backend deployment update',async()=>{
  const f=fixture();f.c.fetch=async()=>({ok:true,json:async()=>({ok:false,error:'ไม่รองรับคำขอนี้'})});
  await assert.rejects(()=>f.api.request('startDesktopLogin',{}),e=>e.code==='API_UPDATE_REQUIRED');assert.equal(f.c.redirect,undefined);
});
await test('QR scan context is read after LIFF initialization and survives external reauthorization',async()=>{
  const f=fixture(),scan='a'.repeat(72);f.c.URLSearchParams=URLSearchParams;
  f.c.location.search='?liff.state=temporary';f.c.liff.init=async()=>{f.c.location.search='?desktopLogin='+scan;};
  f.c.liff.isLoggedIn=()=>false;await f.api.login();
  assert.equal(f.api.pendingDesktopApproval(),scan);assert.equal(f.c.redirect.redirectUri,'https://example.github.io/supplies/?desktopLogin='+scan);
  assert.equal(f.api.desktopQrUrl(scan),'https://liff.line.me/2011171771-Abc123?desktopLogin='+scan);
  assert.ok(!JSON.stringify([...f.temporary]).includes('line-access-token'));f.api.finishDesktopApproval();assert.equal(f.api.pendingDesktopApproval(),'');
});
await test('QR scan context survives native LINE renewal without leaking a desktop secret',async()=>{
  const f=fixture(),scan='b'.repeat(72);f.c.URLSearchParams=URLSearchParams;f.c.location.search='?desktopLogin='+scan;
  f.c.liff.isInClient=()=>true;f.c.location.replace=url=>{f.c.reopened=url;};
  await f.api.login({fresh:true});assert.equal(f.c.reopened,'https://liff.line.me/'+f.c.VILLA_CONFIG.liffId+'?desktopLogin='+scan);
});
await test('actual API client and backend pair one desktop after a verified mobile LINE approval',async()=>{
  const server=require('./backend.cjs').fixture(),f=fixture();
  f.c.fetch=async(url,options)=>({ok:true,json:async()=>JSON.parse(server.c.doPost({postData:{contents:options.body}}).text)});
  const pair=await f.api.request('startDesktopLogin',{});
  assert.equal((await f.api.request('pollDesktopLogin',pair)).status,'pending');
  const info=await f.api.request('inspectDesktopLogin',{token:server.bob.token,scanToken:pair.scanToken});
  await f.api.request('approveDesktopLogin',{token:server.bob.token,scanToken:pair.scanToken,code:info.code});
  const completed=await f.api.request('pollDesktopLogin',pair);f.api.saveSession(completed.user);
  assert.equal(completed.user.employeeId,'0002');assert.equal(completed.user.authMethod,'qr');
  assert.equal((await f.api.restoreDesktopSession()).expiresAt,completed.user.expiresAt);
});
await test('weekly API refuses an old backend and preserves authenticated PAR reports',async()=>{
  const f=fixture();await assert.rejects(()=>f.api.request('getWeeklyWithdrawalReport','test'),/3.6.0/);
  f.c.fetch=async()=>({ok:true,json:async()=>({ok:true,reorderProtocol:'par-k-v1',data:[{par:40,recommendedQty:10}]})});
  assert.equal((await f.api.request('getWeeklyWithdrawalReport','test'))[0].par,40);
});
console.log(`\n${count} client checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
