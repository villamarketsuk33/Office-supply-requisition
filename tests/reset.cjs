const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture}=require('./backend.cjs');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const req=()=>crypto.randomUUID();
const create=(f,items,requestId=req())=>f.c.processOrder({token:f.alice.token,requestId,type:'เบิกคลัง',items});
const history=f=>f.c.getMyWithdrawalHistory(f.alice.token);
const edit=(f,order,items,requestId=req())=>f.c.updateMyWithdrawal({token:f.alice.token,requestId,orderId:order.id,revision:order.revision,items});
const stock=(f,row=2)=>f.sheets.Inventory.getRange(row,6,1,4).getValues()[0];
// A formula-aware Inventory mock evaluates F+G-H and rejects any attempt to
// overwrite I, so rollover verifies actual formula recalculation behavior.
function withBalanceFormulas(f){
  const sheet=f.sheets.Inventory,original=sheet.getRange.bind(sheet),formulas=new Map([[2,'=F2+G2-H2'],[3,'=F3+G3-H3']]);
  sheet.getRange=(...args)=>{
    const range=original(...args),get=range.getValues.bind(range),set=range.setValues.bind(range);
    range.getValues=()=>get().map((row,i)=>row.map((value,j)=>range.col+j===9&&formulas.has(range.row+i)
      ?Number(sheet.cell(range.row+i,6))+Number(sheet.cell(range.row+i,7))-Number(sheet.cell(range.row+i,8)):value));
    range.getFormulas=()=>get().map((row,i)=>row.map((_,j)=>range.col+j===9?(formulas.get(range.row+i)||''):''));
    range.setValues=values=>{
      values.forEach((row,i)=>row.forEach((_,j)=>{if(range.col+j===9&&formulas.has(range.row+i))throw Error('I formula must remain untouched');}));
      return set(values);
    };
    return range;
  };
  return formulas;
}
test('time-trigger handler copies raw I to F, zeros G/H and needs no login token',()=>{
  const f=fixture();f.props.delete('LINE_LOGIN_CHANNEL_ID');f.sheets.Inventory.rows[1].splice(5,4,100,25,40,85);
  f.sheets.Inventory.rows[2].splice(5,4,20,5,2,23);
  const logs=JSON.stringify(f.sheets.TransactionLogs.rows),result=f.c.autoResetInventory({triggerUid:'existing-trigger'});
  assert.equal(result.products,2);assert.equal(result.skipped,false);
  assert.deepEqual(stock(f),[85,0,0,85]);assert.deepEqual(stock(f,3),[23,0,0,23]);
  assert.equal(JSON.stringify(f.sheets.TransactionLogs.rows),logs);assert.equal(f.sheets.Inventory.cell(2,2),'001');
  assert.equal(f.sheets.Inventory.cell(1,6),'Initial');assert.equal(f.sheets.Inventory.cell(1,9),'Balance');
  assert.equal(f.sheets.InventoryResets.getLastRow(),2);
});
test('I is the explicit reset source even if it differs from F+G-H',()=>{
  const f=fixture();f.sheets.Inventory.rows[1][8]=17.5;f.c.autoResetInventory();
  assert.equal(f.sheets.Inventory.cell(2,6),17.5);assert.equal(f.c.inventory_().items[0].balance,17.5);
});
test('all I values are captured before writes and I formulas are never replaced',()=>{
  const f=fixture(),formulas=withBalanceFormulas(f);create(f,[{id:'001',qty:8},{id:'002',qty:3}]);
  assert.equal(stock(f)[3],22);f.c.autoResetInventory();
  assert.deepEqual(stock(f),[22,0,0,22]);assert.deepEqual(stock(f,3),[17,0,0,17]);assert.equal(formulas.get(2),'=F2+G2-H2');
});
test('duplicate triggers or a manual rerun cannot erase new same-day withdrawals',()=>{
  const f=fixture();create(f,[{id:'001',qty:6}]);f.c.autoResetInventory();create(f,[{id:'001',qty:3}]);
  const before=stock(f),result=f.c.autoResetInventory();assert.equal(result.skipped,true);
  assert.deepEqual(stock(f),before);assert.equal(f.sheets.Inventory.cell(2,8),3);assert.equal(f.sheets.InventoryResets.getLastRow(),2);
});
test('next Thai calendar date starts another stock period without depending on a user session',()=>{
  const f=fixture();f.setTime('2026-11-05T16:59:59Z');f.sheets.Inventory.rows[1].splice(5,4,10,4,3,11);
  assert.equal(f.c.autoResetInventory().date,'2026-11-05');f.advance(1000);
  f.sheets.Inventory.rows[1].splice(5,4,11,2,4,9);
  assert.equal(f.c.autoResetInventory().date,'2026-11-06');assert.deepEqual(stock(f),[9,0,0,9]);assert.equal(f.sheets.InventoryResets.getLastRow(),3);
});
test('bad or blank I anywhere aborts all inventory writes before creating a reset record',()=>{
  for(const value of ['',null,'#REF!','text',Infinity,NaN]){
    const f=fixture();f.sheets.Inventory.rows[1].splice(5,4,100,30,20,110);f.sheets.Inventory.rows[2][8]=value;
    const before=JSON.stringify(f.sheets.Inventory.rows);assert.throws(()=>f.c.autoResetInventory(),/คอลัมน์ I/);
    assert.equal(JSON.stringify(f.sheets.Inventory.rows),before);assert.equal(f.sheets.InventoryResets,undefined);
  }
});
test('zero and negative closing quantities are copied as recorded rather than silently clamped',()=>{
  const f=fixture();f.sheets.Inventory.rows[1][8]=0;f.sheets.Inventory.rows[2][8]=-2;
  f.c.autoResetInventory();assert.equal(stock(f)[0],0);assert.equal(stock(f,3)[0],-2);
});
test('blank SKU rows and unrelated columns remain untouched between product groups',()=>{
  const f=fixture();f.sheets.Inventory.rows.splice(2,0,['note','','','text','','keep F','keep G','keep H','not a stock value','extra']);
  const blank=JSON.stringify(f.sheets.Inventory.rows[2]);f.c.autoResetInventory();
  assert.equal(JSON.stringify(f.sheets.Inventory.rows[2]),blank);assert.equal(f.sheets.InventoryResets.cell(2,4),2);
});
test('duplicate SKUs, conflicting Q data and an existing unrelated reset sheet fail before stock changes',()=>{
  const duplicate=fixture();duplicate.sheets.Inventory.rows[2][1]='001';assert.throws(()=>duplicate.c.autoResetInventory(),/ซ้ำ/);
  for(const header of ['', 'unrelated']){
    const f=fixture();f.sheets.TransactionLogs.rows[0][16]=header;
    if(!header)f.sheets.TransactionLogs.appendRow(['','','','','','','','','','','','','','','','','unrelated']);
    const before=stock(f);assert.throws(()=>f.c.autoResetInventory(),/คอลัมน์ Q/);assert.deepEqual(stock(f),before);
  }
  const f=fixture();f.sheets.InventoryResets=new f.sheets.Inventory.constructor('InventoryResets',[['Existing unrelated data']]);
  assert.throws(()=>f.c.autoResetInventory(),/โครงสร้าง InventoryResets/);
});
test('inventory and reset marker roll back together on a write failure, and a retry remains possible',()=>{
  const f=fixture();create(f,[{id:'001',qty:4}]);const before=stock(f);f.sheets.Inventory.failNext=range=>range.col===6;
  assert.throws(()=>f.c.autoResetInventory(),/คืนข้อมูลเดิม/);assert.deepEqual(stock(f),before);assert.equal(f.sheets.InventoryResets.getLastRow(),1);
  assert.equal(f.c.autoResetInventory().skipped,false);assert.deepEqual(stock(f),[26,0,0,26]);
  const second=fixture();create(second,[{id:'001',qty:4}]);second.c.autoResetInventory();
  second.advance(86400000);const current=stock(second);second.sheets.InventoryResets.failNext=range=>range.row>1;
  assert.throws(()=>second.c.autoResetInventory(),/คืนข้อมูลเดิม/);assert.deepEqual(stock(second),current);assert.equal(second.sheets.InventoryResets.getLastRow(),2);
});
test('old order reductions and cancellation refund opening stock without consuming the new period H',()=>{
  const f=fixture(),old=create(f,[{id:'001',qty:8}]);f.c.autoResetInventory();create(f,[{id:'001',qty:3}]);
  edit(f,history(f).find(o=>o.id===old.orderId),[{id:'001',qty:5}]);assert.deepEqual(stock(f),[25,0,3,22]);
  edit(f,history(f).find(o=>o.id===old.orderId),[]);assert.deepEqual(stock(f),[30,0,3,27]);
  assert.equal(f.c.getDailyWithdrawalSummary(f.manager.token)[0].items[0].qty,3);
});
test('old order increases, new product additions, restore and repeated edit requests preserve correct stock',()=>{
  const f=fixture(),old=create(f,[{id:'001',qty:4}]);f.c.autoResetInventory();
  const first=history(f).find(o=>o.id===old.orderId),key=req();
  edit(f,first,[{id:'001',qty:7},{id:'002',qty:2}],key);edit(f,first,[{id:'001',qty:7},{id:'002',qty:2}],key);
  assert.deepEqual(stock(f),[23,0,0,23]);assert.deepEqual(stock(f,3),[18,0,0,18]);
  const rows=f.sheets.TransactionLogs.rows.slice(1).filter(r=>r[9]===old.orderId);assert.ok(rows.every(r=>r[16]==='legacy'));
  edit(f,history(f).find(o=>o.id===old.orderId),[]);assert.deepEqual(stock(f),[30,0,0,30]);
  edit(f,history(f).find(o=>o.id===old.orderId),[{id:'001',qty:2}]);assert.deepEqual(stock(f),[28,0,0,28]);
});
test('new-period edits use H and old-period edits remain correct across more than one rollover',()=>{
  const f=fixture(),old=create(f,[{id:'001',qty:4}]);f.c.autoResetInventory();const recent=create(f,[{id:'001',qty:3}]);
  edit(f,history(f).find(o=>o.id===recent.orderId),[{id:'001',qty:5}]);assert.deepEqual(stock(f),[26,0,5,21]);
  f.advance(86400000);f.c.autoResetInventory();f.alice=f.c.loginWithLine({accessToken:f.aliceAccessToken});
  edit(f,history(f).find(o=>o.id===old.orderId),[{id:'001',qty:2}]);assert.deepEqual(stock(f),[23,0,0,23]);
  edit(f,history(f).find(o=>o.id===recent.orderId),[]);assert.deepEqual(stock(f),[28,0,0,28]);
});
test('restocking after reset retains G while an old cancellation refunds F, and reports retain original history',()=>{
  const f=fixture();create(f,[{id:'001',qty:6}]);f.c.autoResetInventory();
  f.c.processRestock({token:f.manager.token,requestId:req(),id:'001',qty:10});edit(f,history(f)[0],[]);
  assert.deepEqual(stock(f),[30,10,0,40]);assert.equal(history(f)[0].status,'cancelled');
  assert.equal(f.sheets.WithdrawalEdits.rows.filter(r=>r[3]==='RESTOCK').length,1);
});
test('old-period increases still reject overdrafts and an audit failure restores F and order quantities',()=>{
  const f=fixture(),order=create(f,[{id:'001',qty:5}]);f.c.autoResetInventory();create(f,[{id:'001',qty:20}]);
  const old=history(f).find(o=>o.id===order.orderId),before=stock(f);
  assert.throws(()=>edit(f,old,[{id:'001',qty:11}]),/ไม่เพียงพอ/);assert.deepEqual(stock(f),before);
  f.sheets.WithdrawalEdits.failNext=true;assert.throws(()=>edit(f,old,[{id:'001',qty:2}]),/คืนข้อมูลเดิม/);
  assert.deepEqual(stock(f),before);assert.equal(history(f).find(o=>o.id===order.orderId).items[0].qty,5);
});
test('old-period refunds preserve I formulas and new-period gross stock totals',()=>{
  const f=fixture();withBalanceFormulas(f);const old=create(f,[{id:'001',qty:7}]);f.c.autoResetInventory();create(f,[{id:'001',qty:2}]);
  edit(f,history(f).find(o=>o.id===old.orderId),[{id:'001',qty:3}]);assert.deepEqual(stock(f),[27,0,2,25]);
});
test('empty inventory is a no-op and does not consume the day reset marker',()=>{
  const f=fixture();f.sheets.Inventory.rows.length=1;assert.equal(f.c.autoResetInventory().products,0);
  assert.equal(f.sheets.InventoryResets,undefined);
  f.sheets.Inventory.appendRow(['','001','Paper','รีม','500',3,1,2,2]);assert.equal(f.c.autoResetInventory().skipped,false);
});
test('existing v3.5 order metadata migrates to legacy and document numbers and owner IDs remain stable',()=>{
  const f=fixture(),order=create(f,[{id:'001',qty:5}]);f.sheets.TransactionLogs.rows.forEach(r=>r.length=16);
  f.c.autoResetInventory();const record=history(f)[0];assert.equal(record.documentNo,order.documentNo);
  assert.equal(f.sheets.TransactionLogs.cell(2,15),'0001');assert.equal(f.sheets.TransactionLogs.cell(1,17),'InventoryPeriod');
  edit(f,record,[]);assert.deepEqual(stock(f),[30,0,0,30]);
});
test('reset does not clear withdrawal history, audit records or document counters',()=>{
  const f=fixture();create(f,[{id:'001',qty:5}]);const logs=JSON.stringify(f.sheets.TransactionLogs.rows),audit=JSON.stringify(f.sheets.WithdrawalEdits.rows),counter=f.props.get('vm-document:20261023');
  f.c.autoResetInventory();assert.equal(JSON.stringify(f.sheets.TransactionLogs.rows),logs);assert.equal(JSON.stringify(f.sheets.WithdrawalEdits.rows),audit);
  assert.equal(f.props.get('vm-document:20261023'),counter);assert.equal(history(f)[0].items[0].qty,5);
});
test('daily reset remains editor/trigger-only and cannot be invoked through the public HTTP API',()=>{
  const f=fixture();const response=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'autoResetInventory',args:[{}]})}}).text);
  assert.equal(response.ok,false);assert.equal(f.sheets.InventoryResets,undefined);
});
console.log(`\n${count} inventory rollover checks passed`);
