const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture}=require('./backend.cjs');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
function log(f,id,qty,date='2026-10-23T02:00:00Z',name='Legacy item'){
  f.sheets.TransactionLogs.appendRow([new Date(date),'D','Legacy user',id,name,'ใบ','500',qty,'เบิกคลัง']);
}
const report=f=>f.c.getWeeklyWithdrawalReport(f.manager.token);
function inventoryRow(id,name='Current item',initial=10,incoming=0,outgoing=0){return ['',id,name,'ใบ','500',initial,incoming,outgoing,initial+incoming-outgoing];}
test('historical 177413 resolves to Inventory 0177413 and displays current balance and zero recommendation',()=>{
  const f=fixture();f.sheets.Inventory.rows[1]=inventoryRow('0177413','ถาดขาว BIO T-05 30*21.60*4 ซม.',0,4500,1500);
  log(f,177413,1500);const row=report(f)[0];
  assert.equal(row.id,'0177413');assert.equal(row.totalQty,1500);assert.equal(row.balance,3000);
  assert.equal(row.recommendedQty,0);assert.equal(row.stockStatus,'ok');
});
test('padded and numeric history for the same unique SKU combine before the recommendation is calculated',()=>{
  const f=fixture();f.sheets.Inventory.rows[1]=inventoryRow('0177413','Current tray',2);
  log(f,'177413',3,'2026-10-22T02:00:00Z');log(f,'0177413',4);log(f,'00177413',5);
  const rows=report(f);assert.equal(rows.length,1);const row=rows[0];
  assert.equal(row.id,'0177413');assert.equal(row.name,'Current tray');assert.equal(row.totalQty,12);
  assert.equal(row.recommendedQty,10);assert.equal(row.daysActive,2);assert.equal(row.dailyQty.reduce((sum,d)=>sum+d.qty,0),12);
});
test('exact inventory IDs take precedence and ambiguous numeric aliases cannot select the wrong stock',()=>{
  const f=fixture();f.sheets.Inventory.rows=[f.sheets.Inventory.rows[0],inventoryRow('001','First',1),inventoryRow('01','Second',10)];
  log(f,'001',3);log(f,'01',4);log(f,'1',7);const rows=report(f);
  assert.equal(rows.find(r=>r.id==='001').recommendedQty,2);assert.equal(rows.find(r=>r.id==='01').recommendedQty,0);
  const unresolved=rows.find(r=>r.id==='1');assert.equal(unresolved.balance,null);assert.equal(unresolved.recommendedQty,null);
});
test('matching never guesses from identical names, partial codes or an unmapped changed code',()=>{
  const f=fixture();f.sheets.Inventory.rows[1]=inventoryRow('0245647','ถาดดำ C-01',20);
  log(f,'252284',4,'2026-10-23T02:00:00Z','ถาดดำ C-01');log(f,'24564',2);
  for(const row of report(f)){assert.equal(row.stockStatus,'missing');assert.equal(row.balance,null);assert.equal(row.recommendedQty,null);}
});
test('explicit changed-tray mappings merge old/new demand into their verified current master IDs',()=>{
  const f=fixture();f.sheets.Inventory.rows=[f.sheets.Inventory.rows[0],inventoryRow('0245647','ถาดดำ C-01',4),inventoryRow('0245649','ถาดใส C-04',10),inventoryRow('0245646','ถาดใส C-01',10)];
  log(f,'252286',3);log(f,'0252286',4);log(f,'0245647',2);log(f,'252285',5);log(f,'252287',6);
  const rows=report(f);assert.equal(rows.length,3);const black=rows.find(r=>r.id==='0245647');
  assert.equal(black.totalQty,9);assert.equal(black.balance,4);assert.equal(black.recommendedQty,5);
  assert.equal(rows.find(r=>r.id==='0245649').totalQty,5);assert.equal(rows.find(r=>r.id==='0245646').totalQty,6);
});
test('replacement mappings cannot override a still-existing exact/numeric old SKU or resolve a missing target',()=>{
  const f=fixture();f.sheets.Inventory.rows=[f.sheets.Inventory.rows[0],inventoryRow('0252286','Old stock',2),inventoryRow('0245647','New stock',10)];
  log(f,'252286',5);const row=report(f)[0];assert.equal(row.id,'0252286');assert.equal(row.balance,2);assert.equal(row.recommendedQty,3);
  const missing=fixture();log(missing,'252286',5);assert.equal(report(missing)[0].stockStatus,'missing');
});
test('confirmed film replacement converts one legacy carton to six rolls and combines current roll issues',()=>{
  const f=fixture(),stock=inventoryRow('0272558','Current film',10);stock[3]='ม้วน';stock[4]='1';f.sheets.Inventory.rows=[f.sheets.Inventory.rows[0],stock];
  log(f,'50066',1);f.sheets.TransactionLogs.rows.at(-1)[5]='ลัง';f.sheets.TransactionLogs.rows.at(-1)[6]='6';
  log(f,'272558',3);f.sheets.TransactionLogs.rows.at(-1)[5]='ม้วน';
  const rows=report(f);assert.equal(rows.length,1);assert.equal(rows[0].id,'0272558');assert.equal(rows[0].unit,'ม้วน');assert.equal(rows[0].totalQty,9);
  assert.equal(rows[0].dailyQty.reduce((sum,day)=>sum+day.qty,0),9);assert.equal(rows[0].recommendedQty,0);
});
test('film records already expressed in rolls are not multiplied again',()=>{
  const f=fixture(),stock=inventoryRow('0272558','Film',2);stock[3]='ม้วน';f.sheets.Inventory.rows=[f.sheets.Inventory.rows[0],stock];
  log(f,'0050066',5);f.sheets.TransactionLogs.rows.at(-1)[5]='ม้วน';const row=report(f)[0];
  assert.equal(row.totalQty,5);assert.equal(row.recommendedQty,3);
});
test('an unexpected legacy film unit blocks an invented conversion',()=>{
  const f=fixture(),stock=inventoryRow('0272558','Film',2);stock[3]='ม้วน';f.sheets.Inventory.rows=[f.sheets.Inventory.rows[0],stock];
  log(f,'50066',1);f.sheets.TransactionLogs.rows.at(-1)[5]='แพ็ค';assert.throws(()=>report(f),/หน่วยเบิกเดิม/);
});
test('alphanumeric IDs keep exact identity, and long numeric IDs do not lose Number precision',()=>{
  const f=fixture();f.sheets.Inventory.rows=[f.sheets.Inventory.rows[0],inventoryRow('A001','Alpha',4),inventoryRow('09007199254740993','Long code',5)];
  log(f,'A1',2);log(f,'A001',3);log(f,'9007199254740993',8);const rows=report(f);
  assert.equal(rows.find(r=>r.id==='A1').balance,null);assert.equal(rows.find(r=>r.id==='A001').balance,4);
  assert.equal(rows.find(r=>r.id==='09007199254740993').recommendedQty,3);
});
test('report matching does not change Inventory stock, source IDs, request IDs or historical quantities',()=>{
  const f=fixture();f.sheets.Inventory.rows[1]=inventoryRow('0177413','Tray',50);log(f,'177413',7);
  const beforeStock=JSON.stringify(f.sheets.Inventory.rows),beforeLog=JSON.stringify(f.sheets.TransactionLogs.rows.map(r=>r.slice(0,9)));
  report(f);report(f);assert.equal(JSON.stringify(f.sheets.Inventory.rows),beforeStock);
  assert.equal(JSON.stringify(f.sheets.TransactionLogs.rows.map(r=>r.slice(0,9))),beforeLog);
  assert.equal(f.sheets.WithdrawalEdits,undefined);
});
test('new and edited withdrawal IDs stay text even when the sheet would coerce numeric strings',()=>{
  const f=fixture(),sheet=f.sheets.TransactionLogs,original=sheet.getRange.bind(sheet);
  f.sheets.Inventory.rows[1]=inventoryRow('0177413','First',50);f.sheets.Inventory.rows[2]=inventoryRow('0260193','Second',50);
  sheet.getRange=(...args)=>{
    const range=original(...args),set=range.setValues.bind(range);
    range.setValues=values=>set(values.map((row,i)=>row.map((value,j)=>range.col+j===4&&range.row+i>1&&sheet.formats?.get((range.row+i)+':4')!=='@'&&/^\d+$/.test(value)?Number(value):value)));
    return range;
  };
  f.c.processOrder({token:f.alice.token,requestId:crypto.randomUUID(),type:'เบิกคลัง',items:[{id:'0177413',qty:2}]});
  assert.equal(sheet.cell(2,4),'0177413');const old=f.c.getMyWithdrawalHistory(f.alice.token)[0];
  f.c.updateMyWithdrawal({token:f.alice.token,requestId:crypto.randomUUID(),orderId:old.id,revision:old.revision,items:[{id:'0177413',qty:3},{id:'0260193',qty:1}]});
  assert.equal(sheet.cell(2,4),'0177413');assert.equal(sheet.cell(3,4),'0260193');
  assert.equal(sheet.formats.get('2:4'),'@');assert.equal(sheet.formats.get('3:4'),'@');
});
test('write endpoints still require canonical exact product IDs and never use report aliases to mutate stock',()=>{
  const f=fixture();f.sheets.Inventory.rows[1]=inventoryRow('0177413','Tray',50);
  assert.throws(()=>f.c.processOrder({token:f.alice.token,requestId:crypto.randomUUID(),type:'เบิกคลัง',items:[{id:'177413',qty:1}]}),/ไม่พบรหัสสินค้า/);
  assert.equal(f.sheets.Inventory.cell(2,8),0);
});
console.log(`\n${count} reorder SKU checks passed`);
