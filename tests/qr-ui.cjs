const assert=require('node:assert/strict');
const {fixture,flush}=require('./restock-ui.cjs');
(async()=>{
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
await test('desktop waits for the recheck button and displays a locally rendered QR instead of a password form',async()=>{
  const f=await fixture({desktop:true,openRestock:false});
  assert.equal(f.calls.some(c=>c.name==='identity-check'),false);assert.equal(f.calls.some(c=>c.name==='startDesktopLogin'),false);
  assert.equal(f.e('line-login').classList.contains('hidden'),false);assert.equal(f.e('shell').classList.contains('hidden'),true);
  f.e('line-login').emit('click');await flush();assert.equal(f.calls.filter(c=>c.name==='startDesktopLogin').length,1);
  assert.equal(f.e('desktop-qr-panel').classList.contains('hidden'),false);assert.ok(f.e('desktop-qr-image').innerHTML.includes('<svg'));
  assert.equal(f.e('desktop-qr-code').textContent,'123456');assert.equal(f.e('warehouse-password'),undefined);
});
await test('confirmed warehouse QR opens daily reports and print with no LINE SDK login on the computer',async()=>{
  const f=await fixture({desktop:true,openRestock:false,request:name=>name==='pollDesktopLogin'?{status:'complete',user:{name:'Warehouse',dept:'ตำแหน่ง E',role:'Warehouse',token:'qr-session',expiresAt:Date.now()+3600000,authMethod:'qr'}}:undefined});
  f.e('line-login').emit('click');await flush();await f.tick();
  assert.equal(f.e('shell').classList.contains('hidden'),false);assert.equal(f.e('user-name').textContent,'Warehouse');
  assert.ok(f.calls.some(c=>c.name==='getDailyWithdrawalSummary'));assert.equal(f.calls.some(c=>c.name==='identity-check'),false);
  assert.equal(f.e('notice-dialog').open,false);f.click('print');assert.ok(f.calls.some(c=>c.name==='print'));
});
await test('desktop Staff keeps own requisitions and never loads warehouse reports',async()=>{
  const f=await fixture({desktop:true,openRestock:false,restoredUser:{name:'Staff',dept:'ตำแหน่ง E',role:'Staff',token:'qr-session',expiresAt:Date.now()+3600000,authMethod:'qr'}});
  assert.equal(f.e('shell').classList.contains('hidden'),false);assert.equal(f.calls.some(c=>c.name==='getDailyWithdrawalSummary'),false);
  assert.equal(f.calls.some(c=>c.name==='identity-check'),false);
});
await test('cancel stops polling, hides the QR and does not log in or initialize LINE',async()=>{
  const f=await fixture({desktop:true,openRestock:false});f.e('line-login').emit('click');await flush();
  f.e('desktop-qr-cancel').emit('click');await flush();assert.ok(f.calls.some(c=>c.name==='cancelDesktopLogin'));
  await f.tick();assert.equal(f.calls.some(c=>c.name==='pollDesktopLogin'),false);assert.equal(f.e('desktop-qr-panel').classList.contains('hidden'),true);
  assert.equal(f.e('line-login').classList.contains('hidden'),false);assert.equal(f.e('shell').classList.contains('hidden'),true);
});
await test('expired QR returns to retry without automatically creating requests forever',async()=>{
  const f=await fixture({desktop:true,openRestock:false,request:name=>{if(name==='pollDesktopLogin'){const e=Error('QR_EXPIRED: expired');e.code='QR_EXPIRED';throw e;}}});
  f.e('line-login').emit('click');await flush();await f.tick();
  assert.equal(f.e('desktop-qr-panel').classList.contains('hidden'),true);assert.equal(f.e('line-login').disabled,false);
  assert.equal(f.calls.filter(c=>c.name==='startDesktopLogin').length,1);assert.equal(f.e('shell').classList.contains('hidden'),true);
});
await test('mobile still identifies automatically and requires an explicit confirmation only for a scanned desktop QR',async()=>{
  const f=await fixture({openRestock:false,scanToken:'a'.repeat(72)});
  assert.equal(f.calls.filter(c=>c.name==='identity-check').length,1);assert.equal(f.e('shell').classList.contains('hidden'),false);
  assert.equal(f.e('qr-approval-dialog').open,true);assert.equal(f.e('qr-approval-code').textContent,'123456');
  assert.equal(f.e('notice-dialog').open,false);assert.equal(f.calls.some(c=>c.name==='approveDesktopLogin'),false);
  f.e('qr-approval-confirm').emit('click');f.e('qr-approval-confirm').emit('click');await flush();
  assert.equal(f.calls.filter(c=>c.name==='approveDesktopLogin').length,1);assert.equal(f.e('qr-approval-dialog').open,false);
});
await test('mobile cancellation never approves a computer and normal mobile login keeps the notice',async()=>{
  const f=await fixture({openRestock:false,scanToken:'a'.repeat(72)});f.e('qr-approval-deny').emit('click');await flush();
  assert.equal(f.calls.some(c=>c.name==='approveDesktopLogin'),false);assert.equal(f.e('qr-approval-dialog').open,false);
  const ordinary=await fixture({openRestock:false});assert.equal(ordinary.e('notice-dialog').open,true);
});
await test('logout stays logged out and a new desktop QR requires another click',async()=>{
  const f=await fixture({desktop:true,openRestock:false,restoredUser:{name:'Warehouse',dept:'ตำแหน่ง E',role:'Warehouse',token:'qr-session',expiresAt:Date.now()+3600000,authMethod:'qr'}});
  f.click('logout');await flush();assert.equal(f.e('shell').classList.contains('hidden'),true);assert.ok(f.calls.some(c=>c.name==='logoutSession'));
  assert.equal(f.calls.some(c=>c.name==='startDesktopLogin'),false);assert.equal(f.calls.some(c=>c.name==='identity-check'),false);
});
console.log(`\n${count} QR UI checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
