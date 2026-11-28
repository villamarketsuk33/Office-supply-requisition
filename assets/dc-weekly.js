/* Weekly DC requests: isolated from daily stock / fulfillment and label printing. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number(v).toLocaleString('th-TH'),key=()=>crypto.randomUUID(),empty=message=>`<div class="empty"><strong>${esc(message)}</strong></div>`;
  let ctx=null,cart=[],orders=[],editing=null,requestId=null,cancel=null,report=null,week=null;
  function today(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
  function weekOf(value){const d=new Date(value+'T00:00:00Z');if(!/^20\d{2}-\d{2}-\d{2}$/.test(value)||isNaN(d)||d.toISOString().slice(0,10)!==value)throw Error('กรุณาเลือกวันที่ในสัปดาห์');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const start=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);return {start,end:d.toISOString().slice(0,10)};}
  function range(w){const format=v=>new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T00:00:00Z'));return format(w.start)+' – '+format(w.end);}
  function qty(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>1000000)throw Error('กรุณาใส่จำนวนเต็มตั้งแต่ 1 ถึง 1,000,000');return n;}
  const warehouse=()=>['admin','แอดมิน','warehouse','คลัง'].includes(String(ctx?.user.role||'').toLowerCase());
  function products(){const q=$('dc-search').value.trim().toLowerCase();return q?ctx.inventory.filter(i=>[i.id,i.name].join(' ').toLowerCase().includes(q)).sort((a,b)=>(b.id.toLowerCase()===q?1:0)-(a.id.toLowerCase()===q?1:0)).slice(0,8):[];}
  function search(){const results=products();$('dc-results').classList.toggle('hidden',!$('dc-search').value.trim());$('dc-results').innerHTML=results.length?results.map(i=>`<button type="button" class="result" data-action="dc-add" data-id="${esc(i.id)}"><span><span class="result-name">${esc(i.name)}</span><span class="result-meta" style="display:block">${esc(i.id)} · ${esc(i.unit)} · ${esc(i.packSize)}</span></span><span class="chip">เพิ่ม</span></button>`).join(''):empty('ไม่พบสินค้าในทะเบียน Inventory');}
  function add(id){const item=ctx.inventory.find(i=>i.id===id);if(!item)return;let index=cart.findIndex(i=>i.id===id);if(index>=0)cart[index].qty=qty(cart[index].qty+1);else {index=cart.length;cart.push({...item,qty:1});}requestId=null;$('dc-search').value='';$('dc-results').classList.add('hidden');renderCart();const input=$('dc-cart').querySelector(`[data-dc-quantity="${index}"]`);input?.focus();input?.select();}
  function renderCart(){
    $('dc-editor-title').textContent=editing?'แก้ไข #'+editing.documentNo:'รายการเบิก DC';
    $('dc-editor-owner').textContent=ctx.user.name+' · '+ctx.user.dept;
    $('dc-cart-count').textContent=cart.length+' รายการ';$('dc-submit').disabled=!cart.length;
    $('dc-submit').textContent=editing?'บันทึกการแก้ไข':'ยืนยันใบเบิก DC';$('dc-discard').classList.toggle('hidden',!editing&&!cart.length);
    $('dc-week').disabled=Boolean(editing);
    $('dc-cart').innerHTML=cart.length?cart.map((i,index)=>`<div class="cart-item"><div class="item-copy"><strong>${esc(i.name)}</strong><small>${esc(i.id)} · ${esc(i.packSize)} · ${esc(i.unit)}</small></div><input class="control qty-input" type="number" inputmode="numeric" min="1" max="1000000" step="1" value="${i.qty}" data-dc-quantity="${index}" aria-label="จำนวน DC ${esc(i.name)}"><button type="button" class="icon-btn" data-action="dc-remove" data-index="${index}" aria-label="ลบ ${esc(i.name)}">×</button></div>`).join(''):empty('ค้นหาและเพิ่มสินค้าที่ต้องการเบิกจาก DC');
  }
  function resetCart(){cart=[];editing=null;requestId=null;$('dc-search').value='';$('dc-results').classList.add('hidden');renderCart();}
  function renderOrders(){
    $('dc-week-label').textContent=range(week);$('dc-history-count').textContent=orders.length+' ใบ';
    $('dc-history').innerHTML=orders.length?orders.map(o=>`<article class="order-card"><div class="order-card-top"><div><div class="order-title"><strong>#${esc(o.documentNo)}</strong><span class="chip ${o.status==='active'?'chip-green':'chip-red'}">${o.status==='active'?'รวมในรายงาน':'ยกเลิกแล้ว'}</span></div><p class="order-date">อัปเดต ${esc(o.updatedAt)}</p></div><span class="chip">${o.items.length} รายการ</span></div><p class="order-preview">${o.items.slice(0,3).map(i=>`${esc(i.name)} × ${num(i.qty)} ${esc(i.unit)}`).join(' · ')}${o.items.length>3?' และอีก '+(o.items.length-3)+' รายการ':''}</p><div class="dc-order-actions"><button class="btn btn-small" data-action="dc-edit" data-id="${esc(o.id)}">${o.status==='active'?'ดู / แก้ไข':'เรียกคืนใบเบิก'}</button><button class="btn btn-small" data-action="dc-print-order" data-id="${esc(o.id)}">พิมพ์ใบเบิก</button>${o.status==='active'?`<button class="btn btn-small btn-danger" data-action="dc-cancel" data-id="${esc(o.id)}">ยกเลิก</button>`:''}</div></article>`).join(''):empty('ยังไม่มีใบเบิก DC ของคุณในสัปดาห์นี้');
  }
  async function loadMine(){
    const selected=weekOf($('dc-week').value||today());$('dc-week').value=selected.start;
    const result=await ctx.rpc('getMyDCOrders',{token:ctx.user.token,weekDate:selected.start});
    week=result.week;orders=result.orders;renderOrders();renderCart();
  }
  async function save(){
    if(!cart.length)return;cart.forEach(i=>qty(i.qty));if(!requestId)requestId=key();
    const result=await ctx.rpc('saveMyDCOrder',{token:ctx.user.token,requestId,weekDate:$('dc-week').value,orderId:editing?.id||'',revision:editing?.revision||'',items:cart.map(i=>({id:i.id,qty:i.qty}))});
    orders=[result.order,...orders.filter(o=>o.id!==result.order.id)];report=null;resetCart();renderOrders();ctx.toast('บันทึกใบเบิก DC #'+result.order.documentNo+' แล้ว');
  }
  async function edit(id){await loadMine();const order=orders.find(o=>o.id===id);if(!order)throw Error('ไม่พบใบเบิก กรุณาเลือกสัปดาห์ใหม่');if(cart.length&&editing?.id!==id)throw Error('กรุณาบันทึกหรือล้างรายการที่กำลังแก้ไข ก่อนเปิดใบเบิกอื่น');editing=order;cart=order.items.map(i=>({...i}));requestId=null;renderCart();$('dc-editor-title').scrollIntoView?.({behavior:'smooth',block:'center'});$('dc-search').focus();}
  function confirmCancel(id){const order=orders.find(o=>o.id===id);if(!order)return;cancel={...order,requestId:key()};$('dc-cancel-label').textContent='#'+order.documentNo;$('dc-cancel-dialog').showModal();}
  async function cancelOrder(){
    if(!cancel)return;const result=await ctx.rpc('saveMyDCOrder',{token:ctx.user.token,requestId:cancel.requestId,weekDate:cancel.week.start,orderId:cancel.id,revision:cancel.revision,items:[]});
    $('dc-cancel-dialog').close();orders=orders.map(o=>o.id===result.order.id?result.order:o);if(editing?.id===result.order.id)resetCart();cancel=null;report=null;renderOrders();ctx.toast('ยกเลิกใบเบิก DC แล้ว รายงานจะไม่นับยอดใบนี้');
  }
  function table(items,details=false){return `<div class="table-scroll"><table><thead><tr><th>รหัส / สินค้า</th><th>บรรจุ</th><th>หน่วย</th><th class="number">รวมเบิก DC</th></tr></thead><tbody>${items.map(i=>`<tr><td><strong>${esc(i.name)}</strong><div class="table-sub">${esc(i.id)}</div>${i.unitWarning?'<p class="dc-unit-warning">รหัสนี้มีหลายหน่วย/ขนาดบรรจุ แยกยอดให้ตรวจสอบ</p>':''}${details?`<details class="dc-sources"><summary>ดูผู้เบิก ${i.sources.length} ใบ</summary><ul>${i.sources.map(s=>`<li>${esc(s.userName)} · ${esc(s.dept)} · #${esc(s.documentNo)} <strong>${num(s.qty)} ${esc(i.unit)}</strong></li>`).join('')}</ul></details>`:''}</td><td>${esc(i.packSize)}</td><td>${esc(i.unit)}</td><td class="number stock-number">${num(i.qty)}</td></tr>`).join('')}</tbody></table></div>`;}
  function renderSummary(){
    if(!report){$('dc-summary-content').innerHTML=empty('เลือกสัปดาห์เพื่อดูรายงาน');return;}
    $('dc-summary-week-label').textContent=range(report.week);$('dc-summary-updated').textContent='ข้อมูล ณ '+report.generatedAt;
    $('dc-summary-overview').innerHTML=[['ใบเบิก',report.orderCount,'ใบ'],['ผู้เบิก',report.userCount,'คน'],['สินค้า',report.productCount,'รหัส']].map(([label,n,unit])=>`<div class="card stat"><div><div class="stat-label">${label}</div><div class="stat-number">${num(n)} <small>${unit}</small></div></div></div>`).join('');
    const q=$('dc-summary-search').value.trim().toLowerCase(),items=report.items.filter(i=>[i.id,i.name].join(' ').toLowerCase().includes(q));
    $('dc-summary-content').innerHTML=items.length?table(items,true):empty(report.items.length?'ไม่พบสินค้าตามคำค้น':'ยังไม่มีรายการเบิก DC ในสัปดาห์นี้');
    $('dc-summary-print').disabled=!report.items.length;
  }
  async function loadSummary(){
    if(!warehouse())throw Error('เฉพาะ Admin และ Warehouse ที่ดูสรุปทุกคนได้');
    const selected=weekOf($('dc-summary-week').value||today());$('dc-summary-week').value=selected.start;
    report=null;$('dc-summary-print').disabled=true;$('dc-summary-content').innerHTML=empty('กำลังรวมรายการเบิก DC…');$('dc-summary-overview').textContent='';$('dc-summary-updated').textContent='';
    report=await ctx.rpc('getDCWeeklySummary',{token:ctx.user.token,weekDate:selected.start});renderSummary();
  }
  function print(content){$('print-order').innerHTML=content;document.body.classList.add('printing-order');window.print();}
  async function printSummary(){await loadSummary();if(!report.items.length){ctx.toast('สัปดาห์นี้ยังไม่มีรายการให้พิมพ์');return;}print(`<header class="document-heading"><div><strong>VILLA MARKET</strong><h1>สรุปการเบิก DC ประจำสัปดาห์</h1></div><div><strong>${esc(range(report.week))}</strong><p>ข้อมูล ณ ${esc(report.generatedAt)}</p></div></header><p>รวม ${report.orderCount} ใบเบิก · ${report.userCount} คน · ${report.departmentCount} แผนก · ${report.productCount} รหัสสินค้า</p>${table(report.items)}<p class="dc-print-note">รวมยอดล่าสุดของใบเบิกที่ไม่ถูกยกเลิกในรอบที่เลือก · แยกสินค้าตามรหัส หน่วย และขนาดบรรจุ<br>รายงานนี้ใช้เตรียมสั่งจาก DC การรับเข้าสต็อกให้บันทึกตามจำนวนที่รับจริง</p><div class="dc-signatures"><span>ผู้จัดทำ ____________________</span><span>ผู้ตรวจสอบ ____________________</span></div>`);}
  async function printOrder(id){await loadMine();const o=orders.find(o=>o.id===id);if(!o)throw Error('ไม่พบใบเบิก DC');print(`<header class="document-heading"><div><strong>VILLA MARKET</strong><h1>ใบเบิกพัสดุจาก DC</h1></div><div><strong>#${esc(o.documentNo)}</strong><p>${esc(range(o.week))}</p></div></header><p>ผู้เบิก ${esc(o.userName)} · แผนก ${esc(o.dept)}<br>สถานะ ${o.status==='active'?'มีรายการเบิก':'ยกเลิกแล้ว'} · อัปเดต ${esc(o.updatedAt)}</p>${table(o.items)}<div class="dc-signatures"><span>ผู้เบิก ____________________</span><span>ผู้ตรวจสอบ ____________________</span></div>`);}
  function execute(fn,saving=false){if(ctx)ctx.run(fn,saving);}
  $('dc-week').addEventListener('change',()=>execute(loadMine));$('dc-summary-week').addEventListener('change',()=>execute(loadSummary));
  $('dc-search').addEventListener('input',()=>{if(ctx)search();});$('dc-search').addEventListener('keydown',e=>{if(e.key!=='Enter'||!ctx)return;e.preventDefault();execute(()=>{const item=products()[0];if(item)add(item.id);});});
  $('dc-summary-search').addEventListener('input',renderSummary);
  document.addEventListener('change',e=>{if(!ctx||e.target.dataset.dcQuantity===undefined)return;const item=cart[Number(e.target.dataset.dcQuantity)];if(!item)return;try{item.qty=qty(e.target.value);requestId=null;}catch(error){e.target.value=item.qty;ctx.toast(error.message,true);}});
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-action],[data-page]');if(!ctx||!el||ctx.busy())return;
    const action=el.dataset.action;if(!action?.startsWith('dc-'))return;
    if(action==='dc-add')execute(()=>add(el.dataset.id));
    if(action==='dc-remove')execute(()=>{cart.splice(Number(el.dataset.index),1);requestId=null;renderCart();});
    if(action==='dc-discard')execute(resetCart);
    if(action==='dc-submit')execute(save,true);
    if(action==='dc-edit')execute(()=>edit(el.dataset.id));
    if(action==='dc-cancel')execute(()=>confirmCancel(el.dataset.id));
    if(action==='dc-cancel-no'){$('dc-cancel-dialog').close();cancel=null;}
    if(action==='dc-cancel-yes')execute(cancelOrder,true);
    if(action==='dc-refresh')execute(loadMine);
    if(action==='dc-summary-refresh')execute(loadSummary);
    if(action==='dc-print-summary')execute(printSummary);
    if(action==='dc-print-order')execute(()=>printOrder(el.dataset.id));
  });
  window.VillaDC={
    async open(page,context){ctx=context;if(page==='dc'){if(!$('dc-week').value)$('dc-week').value=weekOf(today()).start;await loadMine();}else if(page==='dc-summary'){if(!$('dc-summary-week').value)$('dc-summary-week').value=weekOf(today()).start;await loadSummary();}},
    clear(){ctx=null;cart=[];orders=[];editing=null;requestId=null;cancel=null;report=null;week=null;['dc-cart','dc-history','dc-results','dc-summary-content','dc-summary-overview','dc-summary-updated','dc-week-label','dc-summary-week-label','dc-editor-owner'].forEach(id=>$(id).textContent='');['dc-week','dc-search','dc-summary-week','dc-summary-search'].forEach(id=>$(id).value='');$('dc-week').disabled=false;$('dc-summary-print').disabled=true;}
  };
})();
