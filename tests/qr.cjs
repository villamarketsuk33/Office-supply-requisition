const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture}=require('./backend.cjs');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const approve=(f,pair,user=f.alice)=>f.c.approveDesktopLogin({token:user.token,scanToken:pair.scanToken,code:pair.code});
const login=(f,user=f.alice)=>{const pair=f.c.startDesktopLogin({});approve(f,pair,user);return {pair,user:f.c.pollDesktopLogin(pair).user};};
const post=(f,action,input)=>JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action,args:[input]})}}).text);
test('QR creation issues a five-minute challenge and separate desktop bearer, with hashes stored only',()=>{
  const f=fixture(),before=[...f.props.keys()].filter(k=>k.startsWith('vm-session:')).length,pair=f.c.startDesktopLogin({});
  assert.notEqual(pair.scanToken,pair.desktopToken);assert.match(pair.code,/^\d{6}$/);assert.equal(pair.expiresAt-f.c.Date.now(),300000);
  const serialized=JSON.stringify([...f.props]);assert.ok(!serialized.includes(pair.scanToken));assert.ok(!serialized.includes(pair.desktopToken));
  assert.equal([...f.props.keys()].filter(k=>k.startsWith('vm-session:')).length,before);
  assert.throws(()=>f.c.restoreSession(pair.desktopToken),/SESSION_EXPIRED/);
  assert.equal(f.c.pollDesktopLogin(pair).status,'pending');
});
test('a scanned QR cannot poll or cancel a desktop without its distinct secret',()=>{
  const f=fixture(),pair=f.c.startDesktopLogin({});
  for(const desktopToken of [undefined,pair.scanToken,crypto.randomUUID()+crypto.randomUUID()]){
    assert.throws(()=>f.c.pollDesktopLogin({scanToken:pair.scanToken,desktopToken}),/QR_ACCESS_DENIED/);
    assert.throws(()=>f.c.cancelDesktopLogin({scanToken:pair.scanToken,desktopToken}),/QR_ACCESS_DENIED/);
  }
  assert.equal(f.c.pollDesktopLogin(pair).status,'pending');
});
test('approval requires a valid LINE session and correct human confirmation code',()=>{
  const f=fixture(),pair=f.c.startDesktopLogin({});
  assert.throws(()=>f.c.inspectDesktopLogin({scanToken:pair.scanToken}),/SESSION_EXPIRED/);
  assert.throws(()=>f.c.approveDesktopLogin({scanToken:pair.scanToken,code:pair.code,employeeId:'0003',role:'Admin'}),/SESSION_EXPIRED/);
  assert.throws(()=>approve(f,{...pair,code:'wrong'}),/QR_ACCESS_DENIED/);
  assert.equal(f.c.inspectDesktopLogin({token:f.alice.token,scanToken:pair.scanToken}).code,pair.code);
});
test('approval creates no desktop session until collected, then uses server identity and role',()=>{
  const f=fixture(),pair=f.c.startDesktopLogin({});
  f.c.approveDesktopLogin({token:f.alice.token,scanToken:pair.scanToken,code:pair.code,employeeId:'0003',role:'Admin',dept:'forged'});
  assert.throws(()=>f.c.restoreSession(pair.desktopToken),/SESSION_EXPIRED/);
  const result=f.c.pollDesktopLogin(pair);assert.equal(result.status,'complete');assert.equal(result.user.employeeId,'0001');
  assert.equal(result.user.role,'Staff');assert.equal(result.user.dept,'เนื้อ/ซีฟู้ด');assert.equal(result.user.authMethod,'qr');
  assert.throws(()=>f.c.getDailyWithdrawalSummary(result.user.token),/ไม่มีสิทธิ์/);
});
test('repeat approval by the same LINE employee is safe and another employee cannot overwrite it',()=>{
  const f=fixture(),pair=f.c.startDesktopLogin({});approve(f,pair);assert.equal(approve(f,pair).approved,true);
  assert.throws(()=>approve(f,pair,f.bob),/QR_USED/);
  const user=f.c.pollDesktopLogin(pair).user;assert.equal(user.employeeId,'0001');
  assert.throws(()=>approve(f,pair),/QR_USED/);
});
test('repeated or lost-response collection returns the same session and original fixed expiry',()=>{
  const f=fixture(),{pair,user}=login(f);assert.equal(user.expiresAt-f.c.Date.now(),3600000);
  f.advance(60000);const again=f.c.pollDesktopLogin(pair).user;
  assert.equal(again.token,user.token);assert.equal(again.expiresAt,user.expiresAt);
  f.advance(240000);assert.throws(()=>f.c.pollDesktopLogin(pair),/QR_EXPIRED/);
  assert.equal(f.c.restoreSession(user.token).expiresAt,user.expiresAt);
  f.advance(3300000);assert.throws(()=>f.c.restoreSession(user.token),/SESSION_EXPIRED/);
});
test('QR expiry rejects inspect, approval and collection even if approval preceded expiration',()=>{
  for(const approved of [false,true]){
    const f=fixture(),pair=f.c.startDesktopLogin({});if(approved)approve(f,pair);f.advance(300000);
    assert.throws(()=>approve(f,pair),/QR_EXPIRED/);assert.throws(()=>f.c.pollDesktopLogin(pair),/QR_EXPIRED/);
    assert.throws(()=>f.c.inspectDesktopLogin({token:f.alice.token,scanToken:pair.scanToken}),/QR_EXPIRED/);
    assert.throws(()=>f.c.restoreSession(pair.desktopToken),/SESSION_EXPIRED/);
  }
});
test('cancel and replacement invalidate old requests before or after phone approval',()=>{
  for(const approved of [false,true]){
    const f=fixture(),pair=f.c.startDesktopLogin({});if(approved)approve(f,pair);
    f.c.cancelDesktopLogin(pair);assert.throws(()=>f.c.pollDesktopLogin(pair),/QR_EXPIRED/);
    const first=f.c.startDesktopLogin({}),second=f.c.startDesktopLogin(first);
    assert.throws(()=>approve(f,first),/QR_EXPIRED/);assert.equal(f.c.pollDesktopLogin(second).status,'pending');
  }
});
test('desktop sessions cannot approve another desktop and logout cannot be undone by repolling',()=>{
  const f=fixture(),{pair,user}=login(f),next=f.c.startDesktopLogin({});
  assert.throws(()=>approve(f,next,user),/QR_ACCESS_DENIED/);
  f.c.logoutSession(user.token);assert.throws(()=>f.c.pollDesktopLogin(pair),/SESSION_EXPIRED/);
});
test('current role and status are checked at approval, collection and on every protected desktop call',()=>{
  const f=fixture(),pair=f.c.startDesktopLogin({});approve(f,pair,f.manager);
  f.employees.rows[3][12]='Warehouse';const user=f.c.pollDesktopLogin(pair).user;
  assert.equal(user.role,'Warehouse');assert.doesNotThrow(()=>f.c.getDailyWithdrawalSummary(user.token));
  assert.throws(()=>f.c.getWeeklyWithdrawalReport(user.token),/ไม่มีสิทธิ์/);
  f.employees.rows[3][12]='Staff';assert.throws(()=>f.c.getDailyWithdrawalSummary(user.token),/ไม่มีสิทธิ์/);
  f.employees.rows[3][5]='Inactive';assert.throws(()=>f.c.restoreSession(user.token),/ACCESS_DENIED/);
  const second=fixture(),p=second.c.startDesktopLogin({});approve(second,p);second.employees.rows[1][12]='';
  assert.throws(()=>second.c.pollDesktopLogin(p),/ACCESS_DENIED/);
});
test('E supplies the department in sessions, new logs, daily reports and legacy owner options',()=>{
  const f=fixture();assert.equal(f.alice.dept,'เนื้อ/ซีฟู้ด');f.employees.rows[1][4]='ตำแหน่ง E ใหม่';
  assert.equal(f.c.restoreSession(f.alice.token).dept,'ตำแหน่ง E ใหม่');
  f.c.processOrder({token:f.alice.token,requestId:crypto.randomUUID(),type:'เบิกคลัง',items:[{id:'001',qty:2}],dept:'forged D'});
  assert.equal(f.sheets.TransactionLogs.cell(2,2),'ตำแหน่ง E ใหม่');assert.equal(f.c.getDailyWithdrawalSummary(f.manager.token)[0].department,'ตำแหน่ง E ใหม่');
  assert.equal(f.c.getLegacyOwnerOptions(f.manager.token).employees[0].dept,'ตำแหน่ง E ใหม่');
  f.employees.rows[1][4]='เปลี่ยนภายหลัง';assert.equal(f.c.getMyWithdrawalHistory(f.alice.token)[0].dept,'ตำแหน่ง E ใหม่');
});
test('blank E never falls back to D, while blank D does not prevent a complete E employee',()=>{
  const f=fixture();f.employees.rows[1][3]='';assert.equal(f.c.restoreSession(f.alice.token).dept,'เนื้อ/ซีฟู้ด');
  f.employees.rows[1][3]='D still exists';f.employees.rows[1][4]=' ';assert.throws(()=>f.c.loginWithLine(f.aliceToken),/คอลัมน์ E/);
});
test('creation is bounded and expired QR properties are cleaned',()=>{
  const f=fixture();for(let i=0;i<30;i++)f.c.startDesktopLogin({});assert.throws(()=>f.c.startDesktopLogin({}),/QR_RATE_LIMIT/);
  f.advance(60001);for(let i=0;i<20;i++)f.c.startDesktopLogin({});assert.throws(()=>f.c.startDesktopLogin({}),/QR_RATE_LIMIT/);
  f.advance(300000);f.c.startDesktopLogin({});assert.equal([...f.props.keys()].filter(k=>k.startsWith('vm-qr:')).length,1);
});
test('HTTP QR routes expose protocol markers but no private setup, password login or GET auth routes',()=>{
  const f=fixture(),health=JSON.parse(f.c.doGet().text);assert.equal(health.version,'3.6.0');assert.equal(health.qrProtocol,'desktop-qr-v1');
  const response=post(f,'startDesktopLogin',{});assert.equal(response.ok,true);assert.equal(response.qrProtocol,'desktop-qr-v1');
  for(const action of ['loginWarehouse','setupWarehouseAccounts','createSessionLocked_','qrMobile_'])assert.equal(post(f,action,{}).ok,false);
  assert.equal(f.c.loginWarehouse,undefined);assert.equal(f.c.setupWarehouseAccounts,undefined);
});
test('old password session records are revoked and LINE cannot silently convert a QR token',()=>{
  const f=fixture(),{user}=login(f),key=f.c.sessionKey_(user.token),record=JSON.parse(f.props.get(key));
  record.authMethod='warehouse';f.props.set(key,JSON.stringify(record));assert.throws(()=>f.c.restoreSession(user.token),/ACCESS_DENIED/);
  const another=login(f),line=f.c.loginWithLine({accessToken:f.aliceAccessToken,token:another.user.token});
  assert.equal(line.authMethod,'line');assert.notEqual(line.token,another.user.token);assert.throws(()=>f.c.restoreSession(another.user.token),/SESSION_EXPIRED/);
});
test('a collection property failure fails closed and never renews a successfully created session',()=>{
  const f=fixture(),pair=f.c.startDesktopLogin({});approve(f,pair);
  const original=f.c.PropertiesService.getScriptProperties;
  f.c.PropertiesService.getScriptProperties=()=>{const p=original();return {...p,setProperty:(key,value)=>{if(key.startsWith('vm-session:'))throw Error('write failed');return p.setProperty(key,value);}};};
  assert.throws(()=>f.c.pollDesktopLogin(pair),/write failed/);f.c.PropertiesService.getScriptProperties=original;
  assert.throws(()=>f.c.pollDesktopLogin(pair),/SESSION_EXPIRED/);
});
console.log(`\n${count} QR backend checks passed`);
