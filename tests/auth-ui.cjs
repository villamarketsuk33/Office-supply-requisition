const assert=require('node:assert/strict');
const {fixture,flush}=require('./restock-ui.cjs');
(async()=>{
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
await test('opening the app identifies a registered employee without pressing a login button',async()=>{
  const f=await fixture({openRestock:false});
  assert.equal(f.calls.filter(c=>c.name==='identity-check').length,1);
  assert.equal(f.e('shell').classList.contains('hidden'),false);assert.equal(f.e('auth').classList.contains('hidden'),true);
  assert.equal(f.e('user-name').textContent,'Manager');assert.ok(f.calls.some(c=>c.name==='getInventoryData'));
});
await test('unregistered employees go to the existing registration LIFF without loading protected data',async()=>{
  const url='https://liff.line.me/2011171771-2kU5r1Xp';
  const f=await fixture({openRestock:false,login:()=>{const e=Error('REGISTRATION_REQUIRED: not registered');e.code='REGISTRATION_REQUIRED';e.registrationUrl=url;throw e;}});
  assert.equal(f.calls.filter(c=>c.name==='redirect').length,1);assert.equal(f.calls.find(c=>c.name==='redirect').url,url);
  assert.equal(f.calls.some(c=>c.name==='getInventoryData'),false);assert.equal(f.e('shell').classList.contains('hidden'),true);
  assert.equal(f.e('auth-register').href,url);
});
await test('registered employees without a supply role see the role error and are not redirected',async()=>{
  const f=await fixture({openRestock:false,login:()=>{const e=Error('ACCESS_DENIED: ยังไม่ได้กำหนดสิทธิ์คอลัมน์ M');e.code='ACCESS_DENIED';throw e;}});
  assert.equal(f.calls.some(c=>c.name==='redirect'),false);assert.equal(f.calls.some(c=>c.name==='getInventoryData'),false);
  assert.ok(f.e('auth-status').textContent.includes('คอลัมน์ M'));assert.equal(f.e('line-login').classList.contains('hidden'),false);
});
await test('connection errors show a retry and never masquerade as missing registration',async()=>{
  let attempts=0;const f=await fixture({openRestock:false,login:user=>{if(attempts++===0)throw Error('LINE_CONNECTION_FAILED: network');return user;}});
  assert.equal(f.calls.some(c=>c.name==='redirect'),false);assert.equal(f.calls.some(c=>c.name==='getInventoryData'),false);
  assert.equal(f.e('line-login').disabled,false);f.e('line-login').emit('click');await flush();
  assert.equal(f.calls.filter(c=>c.name==='identity-check').length,2);assert.equal(f.e('user-name').textContent,'Manager');
});
await test('an OAuth redirect in progress does not expose the workspace or trigger registration',async()=>{
  const f=await fixture({openRestock:false,login:()=>null});
  assert.equal(f.calls.some(c=>c.name==='getInventoryData'),false);assert.equal(f.calls.some(c=>c.name==='redirect'),false);
  assert.ok(f.e('auth-status').textContent.includes('กำลังเปิด LINE'));
});
await test('explicit sign out stays signed out until recheck or a new page open',async()=>{
  const f=await fixture({openRestock:false});f.click('logout');await flush();
  assert.equal(f.e('shell').classList.contains('hidden'),true);assert.equal(f.e('user-name').textContent,'');
  assert.equal(f.calls.filter(c=>c.name==='identity-check').length,1);assert.ok(f.calls.some(c=>c.name==='logoutSession'));
  assert.equal(f.e('line-login').classList.contains('hidden'),false);
});
await test('expired or rejected tokens offer explicit renewal instead of retrying the same token',async()=>{
  for(const code of ['LINE_TOKEN_EXPIRED','LINE_TOKEN_INVALID','LINE_VERIFY_FAILED','LINE_OPENID_REQUIRED']){
    let attempts=0;const f=await fixture({openRestock:false,login:(user,settings)=>{if(attempts++===0){const e=Error(code+': rejected');e.code=code;throw e;}assert.equal(settings.fresh,true);return null;}});
    assert.equal(attempts,1);assert.equal(f.e('line-login-label').textContent,'ยืนยันกับ LINE ใหม่');
    assert.equal(f.calls.some(c=>c.name==='getInventoryData'),false);
    f.e('line-login').emit('click');await flush();assert.equal(attempts,2);
  }
});
await test('a channel mismatch keeps its configuration error instead of starting an authorization loop',async()=>{
  const f=await fixture({openRestock:false,login:()=>{const e=Error('LINE_CHANNEL_MISMATCH: wrong channel');e.code='LINE_CHANNEL_MISMATCH';throw e;}});
  assert.equal(f.calls.filter(c=>c.name==='identity-check').length,1);
  assert.equal(f.e('line-login-label').textContent,'ตรวจสอบบัญชีอีกครั้ง');
  assert.equal(f.calls.some(c=>c.name==='redirect'),false);
});
console.log(`\n${count} automatic identity UI checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
