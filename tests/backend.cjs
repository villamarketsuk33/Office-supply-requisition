const assert=require('assert/strict'), fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const source=fs.readFileSync(require('path').join(__dirname,'..','apps-script','Code.gs'),'utf8');
class Range {
  constructor(sheet,row,col,height=1,width=1){Object.assign(this,{sheet,row,col,height,width});}
  getValues(){return Array.from({length:this.height},(_,i)=>Array.from({length:this.width},(_,j)=>this.sheet.cell(this.row+i,this.col+j)));}
  getDisplayValues(){return this.getValues().map(row=>row.map(v=>v instanceof Date?v.toISOString():String(v??'')));}
  getFormulas(){return Array.from({length:this.height},()=>Array(this.width).fill(''));}
  setNumberFormat(format){
    if(!this.sheet.formats)this.sheet.formats=new Map();
    for(let i=0;i<this.height;i++)for(let j=0;j<this.width;j++)this.sheet.formats.set((this.row+i)+':'+(this.col+j),format);
    return this;
  }
  setValues(values){assert.equal(values.length,this.height);assert.equal(values[0].length,this.width);if(this.sheet.failNext && (typeof this.sheet.failNext!=='function'||this.sheet.failNext(this))){this.sheet.failNext=false;throw Error('simulated write failure');}values.forEach((row,i)=>row.forEach((v,j)=>{const r=this.row+i,c=this.col+j;while(this.sheet.rows.length<r)this.sheet.rows.push([]);this.sheet.rows[r-1][c-1]=v;}));return this;}
}
class Sheet {
  constructor(name,rows=[]){this.name=name;this.rows=rows;this.maxCols=20;this.maxRows=1000;}
  cell(r,c){return this.rows[r-1]?.[c-1]??'';}
  getRange(...args){return new Range(this,...args);}
  getLastRow(){for(let i=this.rows.length-1;i>=0;i--)if(this.rows[i].some(v=>v!==''&&v!==null&&v!==undefined))return i+1;return 0;}
  getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,...this.rows.map(r=>r.length)));}
  getMaxColumns(){return this.maxCols;}insertColumnsAfter(n,count){this.maxCols+=count;}
  getMaxRows(){return this.maxRows;}insertRowsAfter(n,count){this.maxRows+=count;}
  appendRow(row){this.getRange(this.getLastRow()+1,1,1,row.length).setValues([row]);}
}
function fixture(){
  let now=Date.parse('2026-10-23T03:00:00Z');
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const aliceLine='U'+'a'.repeat(32),bobLine='U'+'b'.repeat(32),managerLine='U'+'c'.repeat(32);
  const employeeRows=[['รหัสพนักงาน','ชื่อ','นามสกุล','แผนก','ตำแหน่ง','สถานะ','LINE User ID','LINE Display Name','วันที่สมัคร LINE','Last Login','สิทธิ์การใช้งาน','Language','สิทธิ์เบิกพัสดุ'],
    ['0001','Alice','','แผนก D เดิม','เนื้อ/ซีฟู้ด','',aliceLine,'Alice LINE','','','Manager','TH','Staff'],
    ['0002','Bob','','แผนก D เดิม','ผัก/ผลไม้','',bobLine,'Bob LINE','','','Staff','','Staff'],
    ['0003','Manager','','แผนก D เดิม','คลังสินค้า','',managerLine,'Manager LINE','','','Staff','','Admin']];
  const sheets={Inventory:new Sheet('Inventory',[['','ID','Name','Unit','Pack','Initial','In','Out','Balance'],['','001','Paper','รีม','500 แผ่น',30,0,0,30],['','002','Pen','กล่อง','12 แท่ง',20,0,0,20]]),TransactionLogs:new Sheet('TransactionLogs',[['Time','Dept','User','ID','Name','Unit','Pack','Qty','Type']])};
  const employees=new Sheet('Employee_Master',employeeRows),ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>sheets[n]=new Sheet(n),getSpreadsheetTimeZone:()=>'Asia/Bangkok'};
  const props=new Map([['LINE_LOGIN_CHANNEL_ID','2011171771']]),claims=new Map(),accessTokens=new Map(),lineCalls=[];
  let locked=false;
  const context={Date:Clock,JSON,Math,Object,String,Number,Array,isFinite,isNaN,Error,console:{log:()=>{}},
    ContentService:{MimeType:{JSON:'JSON'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    SpreadsheetApp:{openById:id=>id==='1aov9pN2ErlXtVGLm1717z3RJZdwnkGrzRs_BCaoqEvQ'?{getSheetByName:n=>n==='Employee_Master'?employees:null}:ss,flush:()=>{}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)})},
    UrlFetchApp:{fetch:(url,options)=>{
      lineCalls.push({url,options});
      const reply=(status,data)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(data)});
      if(url.startsWith('https://api.line.me/oauth2/v2.1/verify?access_token=')){
        assert.equal(options.method,'get');const value=accessTokens.get(decodeURIComponent(url.split('?access_token=')[1]));
        return value?reply(200,{client_id:value.client_id,expires_in:value.expires_in,scope:value.scope}):reply(400,{error:'invalid_request'});
      }
      if(url==='https://api.line.me/v2/profile'){
        assert.equal(options.method,'get');const value=accessTokens.get(options.headers.Authorization.slice(7));
        return value?reply(200,value.profile||{userId:value.userId,displayName:'LINE name is not the employee authority'}):reply(401,{message:'Invalid access token'});
      }
      assert.equal(url,'https://api.line.me/oauth2/v2.1/verify');assert.equal(options.method,'post');assert.equal(options.payload.client_id,'2011171771');
      const value=claims.get(options.payload.id_token);return reply(value?200:400,value||{error:'invalid'});
    }},
    LockService:{getScriptLock:()=>({waitLock:()=>{assert.equal(locked,false);locked=true;},releaseLock:()=>{locked=false;}})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(a,v)=>crypto.createHash('sha256').update(v).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),formatDate:(d,tz,format)=>{if(isNaN(d))throw Error('invalid date');const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));if(format==='yyyyMMdd')return `${parts.year}${parts.month}${parts.day}`;return format==='yyyy-MM-dd'?`${parts.year}-${parts.month}-${parts.day}`:`${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;}}};
  vm.createContext(context);vm.runInContext(source,context);
  function tokenFor(line,label){const token=('id-token-'+label).padEnd(40,'_');claims.set(token,{iss:'https://access.line.me',aud:'2011171771',sub:line,exp:Math.floor(now/1000)+43200});return token;}
  const aliceToken=tokenFor(aliceLine,'alice'),bobToken=tokenFor(bobLine,'bob'),managerToken=tokenFor(managerLine,'manager');
  function accessFor(line,label){const token=('line-access-'+label).padEnd(45,'_');accessTokens.set(token,{userId:line,client_id:'2011171771',expires_in:3600,scope:'profile openid'});return token;}
  const aliceAccessToken=accessFor(aliceLine,'alice'),bobAccessToken=accessFor(bobLine,'bob');
  return {sheets,employees,props,claims,accessTokens,lineCalls,c:context,aliceToken,bobToken,aliceAccessToken,bobAccessToken,aliceLine,advance:ms=>{now+=ms;},setTime:value=>{now=Date.parse(value);},alice:context.loginWithLine(aliceToken),bob:context.loginWithLine(bobToken),manager:context.loginWithLine(managerToken)};
}
if(require.main===module){
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const request=()=>crypto.randomUUID();
const create=(f,items,user=f.alice,requestId=request())=>f.c.processOrder({token:user.token,requestId,type:'เบิกคลัง',items});
const history=f=>f.c.getMyWithdrawalHistory(f.alice.token);
const edit=(f,order,items,extra={})=>f.c.updateMyWithdrawal({token:f.alice.token,requestId:request(),orderId:order.id,revision:order.revision,items,...extra});
test('create uses server user/product data and reduces correct stock',()=>{const f=fixture();create(f,[{id:'001',name:'fake',qty:5}]);assert.equal(f.sheets.Inventory.cell(2,8),5);assert.equal(f.sheets.Inventory.cell(2,9),25);assert.equal(history(f)[0].userName,'Alice');assert.equal(history(f)[0].items[0].name,'Paper');});
test('ordinary users only see their own orders',()=>{const f=fixture();create(f,[{id:'001',qty:1}]);create(f,[{id:'002',qty:2}],f.bob);assert.equal(history(f).length,1);assert.equal(f.c.getMyWithdrawalHistory(f.bob.token).length,1);});
test('forged owner cannot edit another user order',()=>{const f=fixture();create(f,[{id:'001',qty:5}]);const order=history(f)[0];assert.throws(()=>edit(f,order,[{id:'001',qty:9}],{token:f.bob.token}),/เฉพาะ/);assert.equal(f.sheets.Inventory.cell(2,8),5);});
test('increase/decrease adjusts only the difference',()=>{const f=fixture();create(f,[{id:'001',qty:5}]);edit(f,history(f)[0],[{id:'001',qty:8}]);assert.equal(f.sheets.Inventory.cell(2,8),8);edit(f,history(f)[0],[{id:'001',qty:2}]);assert.equal(f.sheets.Inventory.cell(2,8),2);assert.equal(f.sheets.Inventory.cell(2,9),28);});
test('add/remove products and cancel restores full stock; audit retained',()=>{const f=fixture();create(f,[{id:'001',qty:5}]);edit(f,history(f)[0],[{id:'002',qty:7}]);assert.equal(f.sheets.Inventory.cell(2,8),0);assert.equal(f.sheets.Inventory.cell(3,8),7);edit(f,history(f)[0],[]);assert.equal(f.sheets.Inventory.cell(3,8),0);assert.equal(history(f)[0].status,'cancelled');assert.equal(f.sheets.WithdrawalEdits.getLastRow(),4);});
test('cancelled order can be restored and reusing old create key stays deduplicated',()=>{const f=fixture(),id=request();create(f,[{id:'001',qty:5}],f.alice,id);edit(f,history(f)[0],[]);edit(f,history(f)[0],[{id:'002',qty:2}]);create(f,[{id:'001',qty:5}],f.alice,id);assert.equal(history(f).length,1);assert.equal(f.sheets.Inventory.cell(2,8),0);assert.equal(f.sheets.Inventory.cell(3,8),2);});
test('insufficient stock rejects whole multi-item request',()=>{const f=fixture();assert.throws(()=>create(f,[{id:'001',qty:5},{id:'002',qty:21}]),/ไม่เพียงพอ/);assert.equal(f.sheets.Inventory.cell(2,8),0);assert.equal(f.sheets.TransactionLogs.getLastRow(),1);});
test('negative/fractional/NaN quantities rejected without writes',()=>{for(const qty of [-3,0,1.5,'abc',Infinity]){const f=fixture();assert.throws(()=>create(f,[{id:'001',qty}]),/จำนวน/);assert.equal(f.sheets.Inventory.cell(2,8),0);}});
test('edit validates every product before returning old stock',()=>{const f=fixture();create(f,[{id:'001',qty:5}]);const before=history(f)[0];assert.throws(()=>edit(f,before,[{id:'002',qty:21}]),/ไม่เพียงพอ/);assert.equal(f.sheets.Inventory.cell(2,8),5);assert.equal(history(f)[0].revision,before.revision);});
test('stale revision cannot overwrite newer edit',()=>{const f=fixture();create(f,[{id:'001',qty:5}]);const old=history(f)[0];edit(f,old,[{id:'001',qty:6}]);assert.throws(()=>edit(f,old,[{id:'001',qty:7}]),/เปลี่ยนแปลงแล้ว/);assert.equal(f.sheets.Inventory.cell(2,8),6);});
test('repeated create/edit request IDs apply only once',()=>{const f=fixture(),id=request();create(f,[{id:'001',qty:5}],f.alice,id);create(f,[{id:'001',qty:5}],f.alice,id);assert.equal(f.sheets.Inventory.cell(2,8),5);const old=history(f)[0],editId=request();edit(f,old,[{id:'001',qty:9}],{requestId:editId});edit(f,old,[{id:'001',qty:9}],{requestId:editId});assert.equal(f.sheets.Inventory.cell(2,8),9);assert.equal(f.sheets.WithdrawalEdits.getLastRow(),3);});
test('spreadsheet write failure rolls back inventory and log',()=>{const f=fixture();f.sheets.TransactionLogs.failNext=range=>range.row>1&&range.col===1;assert.throws(()=>create(f,[{id:'001',qty:5}]),/คืนข้อมูลเดิม/);assert.equal(f.sheets.Inventory.cell(2,8),0);assert.equal(f.sheets.Inventory.cell(2,9),30);assert.equal(history(f).length,0);});
test('edit audit write failure rolls back inventory, lines, and appended products',()=>{const f=fixture();create(f,[{id:'001',qty:5}]);const before=history(f)[0];f.sheets.WithdrawalEdits.failNext=true;assert.throws(()=>edit(f,before,[{id:'001',qty:2},{id:'002',qty:4}]),/คืนข้อมูลเดิม/);assert.equal(f.sheets.Inventory.cell(2,8),5);assert.equal(f.sheets.Inventory.cell(3,8),0);assert.equal(history(f)[0].revision,before.revision);});
test('legacy same timestamp rows group into one order with leading zero IDs',()=>{const f=fixture(),date=new Date();f.sheets.TransactionLogs.appendRow([date,'Dept','Alice','001','Paper','รีม','500',2,'เบิกคลัง']);f.sheets.TransactionLogs.appendRow([date,'Dept','Alice','002','Pen','กล่อง','12',3,'เบิกคลัง']);assert.equal(history(f).length,0);f.c.linkLegacyOwner({token:f.manager.token,legacyName:'Alice',employeeId:'0001'});const items=history(f);assert.equal(items.length,1);assert.equal(items[0].items[0].id,'001');assert.equal(items[0].items.length,2);assert.equal(history(f)[0].id,items[0].id);});
test('restock permission and request deduplication',()=>{const f=fixture(),id=request();assert.throws(()=>f.c.processRestock({token:f.alice.token,requestId:id,id:'001',qty:4}),/ไม่มีสิทธิ์/);f.c.processRestock({token:f.manager.token,requestId:id,id:'001',qty:4});f.c.processRestock({token:f.manager.token,requestId:id,id:'001',qty:4});assert.equal(f.sheets.Inventory.cell(2,7),4);});
test('report roles enforced; daily and weekly exclude removed quantities',()=>{const f=fixture();create(f,[{id:'001',qty:5},{id:'002',qty:2}]);edit(f,history(f)[0],[{id:'001',qty:3}]);assert.throws(()=>f.c.getDailyWithdrawalSummary(f.alice.token),/ไม่มีสิทธิ์/);const daily=f.c.getDailyWithdrawalSummary(f.manager.token);assert.equal(daily[0].items.length,1);assert.equal(daily[0].items[0].qty,3);assert.equal(f.c.getWeeklyWithdrawalReport(f.manager.token)[0].totalQty,3);});
test('reducing an old order returns stock even if another adjustment made balance negative',()=>{const f=fixture();create(f,[{id:'001',qty:5}]);f.sheets.Inventory.rows[1][5]=3;f.sheets.Inventory.rows[1][8]=-2;edit(f,history(f)[0],[{id:'001',qty:4}]);assert.equal(f.sheets.Inventory.cell(2,8),4);assert.equal(f.sheets.Inventory.cell(2,9),-1);});
test('opens the explicitly supplied spreadsheet ID',()=>{const f=fixture(),original=f.c.SpreadsheetApp.openById;let actual;f.c.SpreadsheetApp.openById=id=>{actual=id;return original(id);};f.c.getInventoryData(f.alice.token);assert.equal(actual,'1artv-NpWPmAEpv9Qs2MmCnyYnSkcI2GZrwfq--4s8Do');});
test('invalid token rejected and logout revokes session',()=>{const f=fixture();assert.throws(()=>f.c.getMyWithdrawalHistory('bad'),/SESSION_EXPIRED/);f.c.logoutSession(f.alice.token);assert.throws(()=>history(f),/SESSION_EXPIRED/);});
test('name login and self-registration are removed; no Users sheet exists',()=>{const f=fixture();assert.equal(f.c.checkLogin,undefined);assert.equal(f.c.registerNewUser,undefined);assert.equal(f.sheets.Users,undefined);assert.equal(f.c.restoreSession(f.alice.token).employeeId,'0001');});
test('LINE verification rejects forged, expired, wrong audience, issuer and malformed subject',()=>{const f=fixture();assert.throws(()=>f.c.loginWithLine('x'.repeat(40)),/ยืนยันตัวตน/);const original={...f.claims.get(f.aliceToken)};for(const bad of [{aud:'another-channel'},{iss:'https://attacker.test'},{sub:'Alice'},{exp:0}]){f.claims.set(f.aliceToken,{...original,...bad});assert.throws(()=>f.c.loginWithLine(f.aliceToken),/token/);}});
test('all business reads and writes require a valid server session',()=>{const f=fixture();for(const name of ['getInventoryData','getMyWithdrawalHistory','getSummaryReport','getDailyWithdrawalSummary','getWeeklyWithdrawalReport','getLegacyOwnerOptions'])assert.throws(()=>f.c[name]('bad'),/SESSION_EXPIRED/);assert.throws(()=>f.c.processOrder({token:'bad',requestId:request(),items:[{id:'001',qty:1}]}),/SESSION_EXPIRED/);});
test('new app reads M only; K cannot grant admin and blank or unknown M denies login',()=>{const f=fixture();assert.equal(f.alice.role,'Staff');assert.equal(f.manager.role,'Admin');for(const role of ['', 'Manager','constructor','toString']){f.employees.rows[1][12]=role;assert.throws(()=>f.c.loginWithLine(f.aliceToken),/สิทธิ์/);}});
test('duplicate employee or LINE identities cannot authenticate',()=>{for(const col of [0,6]){const f=fixture();f.employees.rows[2][col]=f.employees.rows[1][col];assert.throws(()=>f.c.loginWithLine(f.aliceToken),/ซ้ำ/);}});
test('role changes and suspended employees apply immediately to existing sessions',()=>{const f=fixture();f.employees.rows[1][12]='Warehouse';assert.equal(f.c.restoreSession(f.alice.token).role,'Warehouse');f.c.getDailyWithdrawalSummary(f.alice.token);assert.throws(()=>f.c.getWeeklyWithdrawalReport(f.alice.token),/ไม่มีสิทธิ์/);f.employees.rows[1][5]='Inactive';assert.throws(()=>f.c.restoreSession(f.alice.token),/ระงับ/);f.employees.rows[1][5]='';assert.throws(()=>f.c.restoreSession(f.alice.token),/SESSION_EXPIRED/);});
test('session survives server reload, expires at exactly one hour and never slides',()=>{const f=fixture(),expiry=f.alice.expiresAt;assert.equal(expiry-f.c.Date.now(),3600000);f.advance(3599999);assert.equal(f.c.restoreSession(f.alice.token).expiresAt,expiry);vm.runInContext(source,f.c);assert.equal(f.c.restoreSession(f.alice.token).expiresAt,expiry);f.advance(1);assert.throws(()=>f.c.restoreSession(f.alice.token),/SESSION_EXPIRED/);assert.throws(()=>create(f,[{id:'001',qty:1}]),/SESSION_EXPIRED/);assert.equal(f.sheets.Inventory.cell(2,8),0);});
test('ownership uses stable employee ID after name changes, including equal names',()=>{const f=fixture();create(f,[{id:'001',qty:1}]);f.employees.rows[1][1]='Alice Renamed';f.employees.rows[2][1]='Alice';assert.equal(history(f).length,1);assert.equal(f.c.getMyWithdrawalHistory(f.bob.token).length,0);edit(f,history(f)[0],[{id:'001',qty:2}]);assert.equal(f.sheets.Inventory.cell(2,8),2);});
test('new document numbers use Thai date, increment per order and retain internal UUID',()=>{const f=fixture();const a=create(f,[{id:'001',qty:1},{id:'002',qty:1}]),b=create(f,[{id:'001',qty:1}]);assert.equal(a.documentNo,'202610230001');assert.equal(b.documentNo,'202610230002');assert.match(a.orderId,/^[0-9a-f-]{36}$/);assert.equal(f.sheets.TransactionLogs.cell(2,16),f.sheets.TransactionLogs.cell(3,16));});
test('edits, cancellations, restores and request retries keep the same document number',()=>{const f=fixture(),id=request(),result=create(f,[{id:'001',qty:1}],f.alice,id);edit(f,history(f)[0],[]);edit(f,history(f)[0],[{id:'002',qty:1}]);assert.equal(history(f)[0].documentNo,result.documentNo);assert.equal(create(f,[{id:'001',qty:1}],f.alice,id).documentNo,result.documentNo);assert.equal(f.props.get('vm-document:20261023'),'1');});
test('document counter resumes from stored log maximum if counter property is missing',()=>{const f=fixture();create(f,[{id:'001',qty:1}]);f.props.delete('vm-document:20261023');assert.equal(create(f,[{id:'001',qty:1}]).documentNo,'202610230002');});
test('Thai midnight starts a new document date and 0001',()=>{const f=fixture();f.setTime('2026-10-23T16:59:59Z');f.claims.get(f.aliceToken).exp=Date.parse('2026-10-24T17:00:00Z')/1000;f.alice=f.c.loginWithLine(f.aliceToken);assert.equal(create(f,[{id:'001',qty:1}]).documentNo,'202610230001');f.advance(1000);assert.equal(create(f,[{id:'001',qty:1}]).documentNo,'202610240001');});
test('failed saves never reuse reserved document numbers and 9999 limit prevents stock writes',()=>{const f=fixture();f.sheets.TransactionLogs.failNext=r=>r.row>1&&r.col===1;assert.throws(()=>create(f,[{id:'001',qty:1}]),/คืนข้อมูลเดิม/);assert.equal(create(f,[{id:'001',qty:1}]).documentNo,'202610230002');f.props.set('vm-document:20261023','9999');assert.throws(()=>create(f,[{id:'001',qty:1}]),/9,999/);assert.equal(f.sheets.Inventory.cell(2,8),1);});
test('legacy ownership requires an explicit admin mapping; Staff cannot claim legacy names',()=>{const f=fixture();f.sheets.TransactionLogs.appendRow([new Date('2026-10-22T03:00:00Z'),'Old Dept','Alice','001','Paper','รีม','500',2,'เบิกคลัง']);assert.equal(history(f).length,0);assert.throws(()=>f.c.linkLegacyOwner({token:f.alice.token,legacyName:'Alice',employeeId:'0001'}),/ไม่มีสิทธิ์/);const result=f.c.linkLegacyOwner({token:f.manager.token,legacyName:'Alice',employeeId:'0001'});assert.equal(result.orders,1);assert.equal(history(f)[0].documentNo,'202610220001');assert.equal(f.sheets.Inventory.cell(2,8),0);});
test('API exposes JSON only and whitelists methods; login/data are never GET routes',()=>{const f=fixture();const post=body=>JSON.parse(f.c.doPost({postData:{contents:JSON.stringify(body)}}).text);assert.equal(JSON.parse(f.c.doGet({parameter:{action:'getInventoryData',token:f.alice.token}}).text).service,'Villa Market Supplies API');assert.equal(post({action:'getInventoryData',args:[f.alice.token]}).data.length,2);for(const action of ['employeeRows_','createSession_','nextDocumentNo_','constructor','__proto__','checkLogin','registerNewUser'])assert.equal(post({action,args:[null]}).ok,false);assert.equal(post({action:'getInventoryData',args:['bad']}).ok,false);});
test('inventory retains F+G-H calculation and never overwrites existing I formulas',()=>{const f=fixture();f.sheets.Inventory.rows[1][8]=999;assert.equal(f.c.getInventoryData(f.alice.token)[0].balance,30);const getRange=f.sheets.Inventory.getRange.bind(f.sheets.Inventory);f.sheets.Inventory.getRange=(...args)=>{const range=getRange(...args);range.getFormulas=()=>range.getValues().map((row,i)=>row.map((_,j)=>range.col+j===9&&range.row+i>1?'=F2+G2-H2':''));return range;};create(f,[{id:'001',qty:3}]);assert.equal(f.sheets.Inventory.cell(2,8),3);assert.equal(f.sheets.Inventory.cell(2,9),999);});
test('LINE fetch permission failures report a deploy-owner authorization step without leaking the token',()=>{const f=fixture();f.c.UrlFetchApp.fetch=()=>{throw Error('You do not have permission to call UrlFetchApp.fetch. Required scope: https://www.googleapis.com/auth/script.external_request');};assert.throws(()=>f.c.loginWithLine(f.aliceToken),/LINE_PERMISSION_REQUIRED.*testLineConnection/);const response=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:[f.aliceToken]})}}).text);assert.equal(response.ok,false);assert.ok(!response.error.includes(f.aliceToken));});
test('LINE quota, transport and service failures are distinct from invalid login',()=>{const f=fixture();for(const [message,code] of [['Service invoked too many times: urlfetch','LINE_FETCH_QUOTA'],['DNS error','LINE_CONNECTION_FAILED']]){f.c.UrlFetchApp.fetch=()=>{throw Error(message);};assert.throws(()=>f.c.loginWithLine(f.aliceToken),new RegExp(code));}for(const [status,code] of [[429,'LINE_RATE_LIMIT'],[503,'LINE_SERVICE_UNAVAILABLE'],[400,'LINE_VERIFY_FAILED']]){f.c.UrlFetchApp.fetch=()=>({getResponseCode:()=>status});assert.throws(()=>f.c.loginWithLine(f.aliceToken),new RegExp(code));}});
test('LINE verification reports documented expiry, audience and invalid-token reasons without creating sessions',()=>{
  for(const [reason,code] of [['IdToken expired.','LINE_TOKEN_EXPIRED'],['Invalid IdToken Audience.','LINE_CHANNEL_MISMATCH'],['Invalid IdToken.','LINE_TOKEN_INVALID'],['Invalid IdToken Issuer.','LINE_TOKEN_INVALID'],['Invalid IdToken Nonce.','LINE_TOKEN_INVALID'],['Invalid IdToken Subject Identifier.','LINE_TOKEN_INVALID']]){
    const f=fixture(),before=f.props.size;
    f.c.UrlFetchApp.fetch=()=>({getResponseCode:()=>400,getContentText:()=>JSON.stringify({error:'invalid_request',error_description:reason})});
    const result=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:[{idToken:f.aliceToken,token:f.alice.token}]})}}).text);
    assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(f.props.size,before);
    assert.equal(result.registrationUrl,undefined);assert.ok(!result.error.includes(f.aliceToken));
    if(code==='LINE_CHANNEL_MISMATCH')assert.ok(result.error.includes('2011171771'));
  }
});
test('unknown or malformed LINE error responses never echo raw response text or tokens',()=>{
  for(const body of [JSON.stringify({error_description:'Untrusted '+ 'private-line-token'}),'<html>private-line-token</html>']){
    const f=fixture();f.c.UrlFetchApp.fetch=()=>({getResponseCode:()=>400,getContentText:()=>body});
    assert.throws(()=>f.c.loginWithLine(f.aliceToken),e=>e.message.startsWith('LINE_VERIFY_FAILED:')&&!e.message.includes('private-line-token'));
  }
});
test('ID-token verification explicitly uses form encoding with the original token string',()=>{
  const f=fixture(),fetch=f.c.UrlFetchApp.fetch;
  f.c.UrlFetchApp.fetch=(url,options)=>{assert.equal(options.contentType,'application/x-www-form-urlencoded');assert.equal(typeof options.payload.id_token,'string');assert.equal(options.payload.id_token,f.aliceToken);return fetch(url,options);};
  const result=f.c.loginWithLine({idToken:'  '+f.aliceToken+'  ',token:f.alice.token});
  assert.equal(result.token,f.alice.token);assert.equal(result.expiresAt,f.alice.expiresAt);
});
test('manual connection test uses a dummy token, creates no sessions and is excluded from HTTP API',()=>{const f=fixture(),before=f.props.size,result=f.c.testLineConnection();assert.equal(result.ok,true);assert.equal(result.lineHttpStatus,400);assert.equal(f.props.size,before);const response=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'testLineConnection',args:[null]})}}).text);assert.equal(response.ok,false);f.c.UrlFetchApp.fetch=()=>{throw Error('Original Google authorization error');};assert.throws(()=>f.c.testLineConnection(),/Original Google authorization error/);});
test('manifest explicitly grants the external-request and spreadsheet scopes required by this API',()=>{const manifest=JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','apps-script','appsscript.json'),'utf8'));assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'));assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));});
test('reorder demand sums daily withdrawals for seven dates without averaging',()=>{
  const f=fixture(),quantities=[2,3,0,4,5,0,6];
  quantities.forEach((qty,index)=>{if(qty)f.sheets.TransactionLogs.appendRow([new Date(`2026-10-${17+index}T02:00:00Z`),'Dept','Alice','001','Paper','รีม','500 แผ่น',qty,'เบิกคลัง']);});
  f.sheets.Inventory.rows[1][7]=20;
  const row=f.c.getWeeklyWithdrawalReport(f.manager.token)[0];
  assert.equal(row.totalQty,20);assert.equal(row.balance,10);assert.equal(row.recommendedQty,10);assert.equal(row.daysActive,5);
  assert.equal(row.periodStart,'2026-10-17');assert.equal(row.periodEnd,'2026-10-23');
  assert.equal(Array.from(row.dailyQty,r=>r.qty).join(','),quantities.join(','));
  assert.equal(row.dailyQty.length,7);assert.equal(row.dailyQty.reduce((sum,r)=>sum+r.qty,0),row.totalQty);
  assert.equal(Object.hasOwn(row,'avgPerDay'),false);
});
test('daily totals combine all departments and multiple issues on the same date',()=>{
  const f=fixture();create(f,[{id:'001',qty:3}]);create(f,[{id:'001',qty:4}],f.bob);
  const row=f.c.getWeeklyWithdrawalReport(f.manager.token)[0];
  assert.equal(row.totalQty,7);assert.equal(row.dailyQty[6].qty,7);assert.equal(row.daysActive,1);
});
test('reorder window uses Thai midnight and excludes older, future, removed and invalid lines',()=>{
  const f=fixture(),log=f.sheets.TransactionLogs;
  const append=(date,qty,type='เบิกคลัง')=>log.appendRow([isNaN(new Date(date))?date:new Date(date),'D','Alice','001','Paper','รีม','500',qty,type]);
  append('2026-10-16T16:59:59Z',100);append('2026-10-16T17:00:00Z',2);append('2026-10-23T03:00:00Z',3);
  append('2026-10-23T03:00:01Z',200);append('2026-10-24T01:00:00Z',200);append('2026-10-22T01:00:00Z',-3);
  append('2026-10-22T01:00:00Z',100,'รับเข้า');append('not-a-date',100);
  const row=f.c.getWeeklyWithdrawalReport(f.manager.token)[0];
  assert.equal(row.totalQty,5);assert.equal(row.dailyQty[0].qty,2);assert.equal(row.dailyQty[6].qty,3);
});
test('enough or exact stock recommends zero, with quantities kept in the issue unit',()=>{
  const f=fixture();create(f,[{id:'001',qty:5}]);let row=f.c.getWeeklyWithdrawalReport(f.manager.token)[0];
  assert.equal(row.recommendedQty,0);assert.equal(row.unit,'รีม');assert.equal(row.packSize,'500 แผ่น');
  f.sheets.Inventory.rows[1][5]=10;row=f.c.getWeeklyWithdrawalReport(f.manager.token)[0];
  assert.equal(row.balance,5);assert.equal(row.recommendedQty,0);
  f.sheets.Inventory.rows[1][5]=7;row=f.c.getWeeklyWithdrawalReport(f.manager.token)[0];
  assert.equal(row.recommendedQty,3);
});
test('edits, cancellations and restocking recompute the recommendation from current data',()=>{
  const f=fixture();create(f,[{id:'001',qty:20}]);assert.equal(f.c.getWeeklyWithdrawalReport(f.manager.token)[0].recommendedQty,10);
  f.c.processRestock({token:f.manager.token,requestId:request(),id:'001',qty:4});
  assert.equal(f.c.getWeeklyWithdrawalReport(f.manager.token)[0].recommendedQty,6);
  edit(f,history(f)[0],[{id:'001',qty:12}]);let row=f.c.getWeeklyWithdrawalReport(f.manager.token)[0];
  assert.equal(row.totalQty,12);assert.equal(row.dailyQty[6].qty,12);assert.equal(row.recommendedQty,0);
  edit(f,history(f)[0],[]);assert.equal(f.c.getWeeklyWithdrawalReport(f.manager.token).length,0);
});
test('unknown products and negative stock require checking rather than a false order quantity',()=>{
  const f=fixture();create(f,[{id:'001',qty:5}]);f.sheets.Inventory.rows[1][5]=1;
  f.sheets.TransactionLogs.appendRow([new Date('2026-10-22T01:00:00Z'),'D','Old user','003','Missing item','อัน','1',7,'เบิกคลัง']);
  const rows=f.c.getWeeklyWithdrawalReport(f.manager.token),negative=rows.find(r=>r.id==='001'),missing=rows.find(r=>r.id==='003');
  assert.equal(negative.balance,-4);assert.equal(negative.stockStatus,'negative');assert.equal(negative.recommendedQty,null);
  assert.equal(missing.totalQty,7);assert.equal(missing.stockStatus,'missing');assert.equal(missing.balance,null);assert.equal(missing.recommendedQty,null);
});
test('recommendations round shortages up to whole issue units and never change inventory or place an order',()=>{
  const f=fixture();f.sheets.Inventory.rows[1][5]=10.5;create(f,[{id:'001',qty:6}]);
  const before=JSON.stringify(f.sheets.Inventory.rows),audits=f.sheets.WithdrawalEdits.getLastRow();
  const report=f.c.getWeeklyWithdrawalReport(f.manager.token);
  assert.equal(report[0].totalQty,6);assert.equal(report[0].balance,4.5);assert.equal(report[0].recommendedQty,2);
  assert.equal(JSON.stringify(f.sheets.Inventory.rows),before);assert.equal(f.sheets.WithdrawalEdits.getLastRow(),audits);
});
test('no withdrawal data yields no invented weekly demand or order suggestion',()=>{
  const f=fixture();assert.equal(f.c.getWeeklyWithdrawalReport(f.manager.token).length,0);
});
test('automatic identity check reuses the matching session without extending its one-hour expiry',()=>{
  const f=fixture(),expiry=f.alice.expiresAt;f.advance(1200000);
  const result=f.c.loginWithLine({idToken:f.aliceToken,token:f.alice.token});
  assert.equal(result.token,f.alice.token);assert.equal(result.expiresAt,expiry);assert.equal(result.name,'Alice');
});
test('a changed LINE account cannot restore the previous employee session',()=>{
  const f=fixture(),result=f.c.loginWithLine({idToken:f.bobToken,token:f.alice.token});
  assert.equal(result.employeeId,'0002');assert.notEqual(result.token,f.alice.token);
  assert.throws(()=>f.c.restoreSession(f.alice.token),/SESSION_EXPIRED/);
});
test('expired cached sessions require verified LINE identity and receive a fresh fixed expiry',()=>{
  const f=fixture();f.advance(3600000);
  const result=f.c.loginWithLine({idToken:f.aliceToken,token:f.alice.token});
  assert.notEqual(result.token,f.alice.token);assert.equal(result.expiresAt-f.c.Date.now(),3600000);
  assert.throws(()=>f.c.restoreSession(f.alice.token),/SESSION_EXPIRED/);
});
test('unregistered LINE identities route only to the existing Customer Interaction LIFF',()=>{
  const f=fixture();f.claims.get(f.aliceToken).sub='U'+'d'.repeat(32);
  const result=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:[{idToken:f.aliceToken,token:f.alice.token}]})}}).text);
  assert.equal(result.ok,false);assert.equal(result.code,'REGISTRATION_REQUIRED');
  assert.equal(result.registrationUrl,'https://liff.line.me/2011171771-2kU5r1Xp');
  assert.ok(!result.registrationUrl.includes(f.aliceToken));assert.ok(!result.registrationUrl.includes(f.alice.token));
  assert.throws(()=>f.c.restoreSession(f.alice.token),/SESSION_EXPIRED/);
});
test('registered users lacking M role, suspended accounts and duplicates do not route to registration',()=>{
  for(const change of [f=>f.employees.rows[1][12]='',f=>f.employees.rows[1][5]='Inactive',f=>f.employees.rows[2][6]=f.aliceLine]){
    const f=fixture();change(f);
    const result=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:[f.aliceToken]})}}).text);
    assert.equal(result.ok,false);assert.equal(result.code,'ACCESS_DENIED');assert.equal(result.registrationUrl,undefined);
  }
});
test('invalid LINE tokens or network errors never route to registration or create a session',()=>{
  const f=fixture(),count=f.props.size;
  let result=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:['bad-token'.repeat(5)]})}}).text);
  assert.equal(result.code,'LINE_VERIFY_FAILED');assert.equal(result.registrationUrl,undefined);assert.equal(f.props.size,count);
  f.c.UrlFetchApp.fetch=()=>{throw Error('DNS unavailable');};
  result=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:[f.aliceToken]})}}).text);
  assert.equal(result.code,'LINE_CONNECTION_FAILED');assert.equal(result.registrationUrl,undefined);
});
test('registration destination can be configured with HTTPS while unsafe destinations are rejected',()=>{
  const f=fixture();f.claims.get(f.aliceToken).sub='U'+'d'.repeat(32);
  const invoke=()=>JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:[f.aliceToken]})}}).text);
  f.props.set('REGISTRATION_URL','https://example.test/register');assert.equal(invoke().registrationUrl,'https://example.test/register');
  for(const url of ['javascript:alert(1)','http://example.test/','https://name:password@example.test/']){
    f.props.set('REGISTRATION_URL',url);const result=invoke();assert.equal(result.code,'REGISTRATION_CONFIG_ERROR');assert.equal(result.registrationUrl,undefined);
  }
});
test('access login works with an expired ID token and resolves identity only through LINE server verification',()=>{
  const f=fixture();f.claims.get(f.aliceToken).exp=0;f.lineCalls.length=0;
  const u=f.c.loginWithLine({accessToken:f.aliceAccessToken,token:f.alice.token,employeeId:'0003',role:'Admin',lineUserId:'U'+'c'.repeat(32)});
  assert.equal(u.employeeId,'0001');assert.equal(u.role,'Staff');assert.equal(u.name,'Alice');assert.equal(u.token,f.alice.token);
  assert.equal(u.expiresAt,f.alice.expiresAt);assert.equal(f.lineCalls.length,2);
  assert.ok(f.lineCalls[0].url.startsWith('https://api.line.me/oauth2/v2.1/verify?access_token='));
  assert.equal(f.lineCalls[1].url,'https://api.line.me/v2/profile');assert.equal(f.lineCalls[1].options.headers.Authorization,'Bearer '+f.aliceAccessToken);
});
test('wrong-channel, expired, malformed and unscoped access tokens never reach employee profile lookup or create sessions',()=>{
  for(const [change,code] of [[{client_id:'another-channel'},'LINE_CHANNEL_MISMATCH'],[{expires_in:0},'LINE_ACCESS_INVALID'],[{expires_in:'NaN'},'LINE_ACCESS_INVALID'],[{scope:'openid'},'LINE_PROFILE_REQUIRED']]){
    const f=fixture(),before=f.props.size;Object.assign(f.accessTokens.get(f.aliceAccessToken),change);f.lineCalls.length=0;
    assert.throws(()=>f.c.loginWithLine({accessToken:f.aliceAccessToken,idToken:f.aliceToken}),new RegExp(code));
    assert.equal(f.props.size,before);assert.equal(f.lineCalls.length,1);
  }
  for(const accessToken of ['',null,{},'forged-access-token-value','bad\r\nAuthorization: injected']){
    const f=fixture(),before=f.props.size;
    assert.throws(()=>f.c.loginWithLine({accessToken,idToken:f.aliceToken}),/LINE_ACCESS_INVALID/);assert.equal(f.props.size,before);
  }
});
test('profile failure or malformed LINE identities deny access after successful token verification',()=>{
  for(const profile of [{userId:'Alice'},{userId:'U'+'a'.repeat(31)},{displayName:'Alice'}]){
    const f=fixture(),before=f.props.size;f.accessTokens.get(f.aliceAccessToken).profile=profile;
    assert.throws(()=>f.c.loginWithLine({accessToken:f.aliceAccessToken}),/LINE_PROFILE_FAILED/);assert.equal(f.props.size,before);
  }
  const f=fixture(),fetch=f.c.UrlFetchApp.fetch,before=f.props.size;
  f.c.UrlFetchApp.fetch=(url,options)=>url==='https://api.line.me/v2/profile'?{getResponseCode:()=>401}:fetch(url,options);
  assert.throws(()=>f.c.loginWithLine({accessToken:f.aliceAccessToken}),/LINE_ACCESS_INVALID/);assert.equal(f.props.size,before);
});
test('access verification network, quota and service errors do not disclose tokens or authenticate',()=>{
  for(const [status,code] of [[429,'LINE_RATE_LIMIT'],[503,'LINE_SERVICE_UNAVAILABLE'],[403,'LINE_ACCESS_VERIFY_FAILED']]){
    const f=fixture(),before=f.props.size;f.c.UrlFetchApp.fetch=()=>({getResponseCode:()=>status});
    assert.throws(()=>f.c.loginWithLine({accessToken:f.aliceAccessToken}),new RegExp(code));assert.equal(f.props.size,before);
  }
  const f=fixture();f.c.UrlFetchApp.fetch=()=>{throw Error('DNS '+f.aliceAccessToken);};
  assert.throws(()=>f.c.loginWithLine({accessToken:f.aliceAccessToken}),e=>e.message.startsWith('LINE_CONNECTION_FAILED:')&&!e.message.includes(f.aliceAccessToken));
});
test('access identity changes revoke a previous employee session and missing registration never grants a role',()=>{
  const f=fixture(),next=f.c.loginWithLine({accessToken:f.bobAccessToken,token:f.alice.token});
  assert.equal(next.employeeId,'0002');assert.throws(()=>f.c.restoreSession(f.alice.token),/SESSION_EXPIRED/);
  f.accessTokens.get(f.aliceAccessToken).userId='U'+'d'.repeat(32);
  const result=JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:[{accessToken:f.aliceAccessToken}]})}}).text);
  assert.equal(result.code,'REGISTRATION_REQUIRED');assert.equal(result.authProtocol,'line-access-v1');
  assert.equal(result.registrationUrl,'https://liff.line.me/2011171771-2kU5r1Xp');
});
test('HTTP access login and restored sessions retain fixed expiry while applying current employee role',()=>{
  const f=fixture();f.advance(120000);const invoke=()=>JSON.parse(f.c.doPost({postData:{contents:JSON.stringify({action:'loginWithLine',args:[{accessToken:f.aliceAccessToken,token:f.alice.token}]})}}).text);
  let result=invoke();assert.equal(result.ok,true);assert.equal(result.authProtocol,'line-access-v1');assert.equal(result.data.expiresAt,f.alice.expiresAt);
  f.employees.rows[1][12]='Warehouse';result=invoke();assert.equal(result.data.role,'Warehouse');assert.equal(result.data.expiresAt,f.alice.expiresAt);
  f.employees.rows[1][12]='';assert.equal(invoke().code,'ACCESS_DENIED');
});
console.log(`\n${count} backend checks passed`);

}
module.exports={fixture};
