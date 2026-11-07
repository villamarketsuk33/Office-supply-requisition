const assert=require('node:assert/strict'),{fixture}=require('./backend.cjs');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
function log(f,qty=5,unit='รีม',id='001'){f.sheets.TransactionLogs.appendRow([new Date('2026-10-23T02:00:00Z'),'D','User',id,'Item',unit,'500',qty,'เบิกคลัง']);}
const report=f=>f.c.getWeeklyWithdrawalReport(f.manager.token);
const par=(f,value,row=1)=>{f.sheets.Inventory.rows[row][10]=value;};
test('configured K replaces demand as target, while blank K keeps the seven-day sum',()=>{
  const f=fixture();log(f,20);let row=report(f)[0];assert.equal(row.par,null);assert.equal(row.calculationSource,'withdrawal7d');assert.equal(row.recommendedQty,0);
  par(f,50);row=report(f)[0];assert.equal(row.targetQty,50);assert.equal(row.totalQty,20);assert.equal(row.balance,30);assert.equal(row.recommendedQty,20);assert.equal(row.parStatus,'ok');assert.equal(row.calculationSource,'par');
});
test('a configured target remains visible with no current withdrawals',()=>{
  const f=fixture();par(f,42);const row=report(f)[0];assert.equal(row.totalQty,0);assert.equal(row.daysActive,0);assert.equal(row.recommendedQty,12);assert.equal(row.dailyQty.length,7);assert.ok(row.dailyQty.every(d=>d.qty===0));
});
test('explicit zero is a real target and is not replaced with demand',()=>{const f=fixture();log(f,100);par(f,0);const row=report(f)[0];assert.equal(row.par,0);assert.equal(row.targetQty,0);assert.equal(row.recommendedQty,0);});
test('invalid K is isolated to that recommendation and does not block employee inventory reads',()=>{
  for(const value of [-1,1.5,'#REF!','12 ลัง',true,Infinity,'1e3',Number.MAX_SAFE_INTEGER+1]){
    const f=fixture();par(f,value);par(f,25,2);const rows=report(f),bad=rows.find(r=>r.id==='001'),good=rows.find(r=>r.id==='002');
    assert.equal(bad.parStatus,'invalid');assert.equal(bad.targetQty,null);assert.equal(bad.recommendedQty,null);assert.equal(good.recommendedQty,5);assert.equal(f.c.getInventoryData(f.alice.token).length,2);
  }
});
test('blank strings fall back, numeric strings parse, and unchanged reads never replace fixed targets',()=>{
  const f=fixture();log(f,4);par(f,' ');assert.equal(report(f)[0].parStatus,'unset');par(f,' 38 ');assert.equal(report(f)[0].recommendedQty,8);
  const before=JSON.stringify(f.sheets.Inventory.rows);report(f);report(f);assert.equal(JSON.stringify(f.sheets.Inventory.rows),before);
});
test('restocking and editing alter recommendations without changing K',()=>{
  const f=fixture();par(f,50);f.c.processOrder({token:f.alice.token,requestId:require('crypto').randomUUID(),type:'เบิกคลัง',items:[{id:'001',qty:4}]});
  assert.equal(report(f)[0].recommendedQty,24);f.c.processRestock({token:f.manager.token,requestId:require('crypto').randomUUID(),id:'001',qty:10});assert.equal(report(f)[0].recommendedQty,14);assert.equal(f.sheets.Inventory.cell(2,11),50);
});
test('daily reset preserves K, total historical demand and purchase recommendation',()=>{
  const f=fixture();log(f,5);par(f,50);const before=report(f)[0];f.c.autoResetInventory();const after=report(f)[0];assert.equal(after.par,50);assert.equal(after.totalQty,5);assert.equal(after.recommendedQty,before.recommendedQty);assert.equal(f.sheets.Inventory.cell(2,11),50);assert.equal(f.sheets.Inventory.cell(2,7),0);assert.equal(f.sheets.Inventory.cell(2,8),0);
});
test('legacy aliases use K from the canonical product and film quantities remain rolls',()=>{
  const f=fixture();f.sheets.Inventory.rows[1]=['','0272558','Film','ม้วน','1',10,0,0,10,'',15];log(f,1,'ลัง','50066');const row=report(f)[0];assert.equal(row.id,'0272558');assert.equal(row.totalQty,6);assert.equal(row.par,15);assert.equal(row.recommendedQty,5);assert.equal(row.demandStatus,'ok');
});
test('incompatible history units cannot seed a false total or recommendation, even with K set',()=>{
  const f=fixture();par(f,40);log(f,2,'ลัง');const row=report(f)[0];assert.equal(row.demandStatus,'unit_mismatch');assert.equal(row.totalQty,null);assert.equal(row.recommendedQty,null);assert.ok(row.dailyQty.every(d=>d.qty===null));assert.equal(row.demandUnits[0],'ลัง');
});
test('equivalent kilogram labels remain comparable without multiplying by pack size',()=>{const f=fixture();f.sheets.Inventory.rows[1][3]='กิโล';log(f,3,'กก.');const row=report(f)[0];assert.equal(row.totalQty,3);assert.equal(row.demandStatus,'ok');});
test('negative or missing stock never invents a safe PAR recommendation',()=>{
  const f=fixture();par(f,50);f.sheets.Inventory.rows[1][5]=-1;log(f,3,'ใบ','999');const rows=report(f);assert.equal(rows.find(r=>r.id==='001').recommendedQty,null);assert.equal(rows.find(r=>r.id==='999').recommendedQty,null);
});
test('PAR report remains admin-only and exposes its deployed protocol',()=>{
  const f=fixture();assert.throws(()=>f.c.getWeeklyWithdrawalReport(f.alice.token),/ไม่มีสิทธิ์/);const health=JSON.parse(f.c.doGet().text);assert.equal(health.version,'3.6.0');assert.equal(health.reorderProtocol,'par-k-v1');
  const response=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'getWeeklyWithdrawalReport',args:[f.manager.token]})}}).text);assert.equal(response.ok,true);assert.equal(response.reorderProtocol,'par-k-v1');
});
console.log(`\n${count} PAR checks passed`);
