(() => {
  'use strict';
  const $=id=>document.getElementById(id), icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={user:null,inventory:[],history:[],weekly:[],cart:[],selected:null,page:'requisition',editing:null,editItems:[],busy:false,pending:0,orderRequest:null,editRequest:null,restockRequest:null,warehouse:[],warehouseDrafts:{},fulfillmentRequests:{},pendingFulfillment:null};
  let freshLineLogin=false,desktopMode=false,qrRequest=null,qrTimer=null,qrGeneration=0,qrApproval=null;
  const titles={requisition:'เบิกพัสดุ',history:'ประวัติการเบิกของฉัน',inventory:'สต็อกคงเหลือ',daily:'ใบจัดของประจำวัน',weekly:'วางแผนสั่งซื้อ'};
  const key=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2);
  const role=()=>String(state.user?.role||'').trim().toLowerCase();
  const isAdmin=()=>['admin','แอดมิน'].includes(role()), isWarehouse=()=>isAdmin()||['warehouse','คลัง'].includes(role());
  const stock=id=>state.inventory.find(i=>i.id===id), num=n=>Number(n).toLocaleString('th-TH');
  const empty=(title,description)=>`<div class="empty"><div class="empty-icon">${icon('box')}</div><strong>${esc(title)}</strong><p class="small">${esc(description)}</p></div>`;
  const documentLabel=order=>String(order.documentNo||order.id);
  function toast(message,error=false){const item=document.createElement('div');item.className='toast'+(error?' error':'');item.innerHTML=icon(error?'info':'check')+`<span>${esc(message)}</span><button aria-label="ปิดข้อความ">×</button>`;item.querySelector('button').onclick=()=>item.remove();$('toasts').appendChild(item);setTimeout(()=>item.remove(),error?14000:6500);}
  function rpc(name,...args){
    const token=state.user?.token;
    state.pending++;$('busy-bar').classList.remove('hidden');
    return VillaAPI.request(name,...args).then(result=>{
      if(token&&token!==state.user?.token)throw new Error('SESSION_CHANGED');
      return result;
    }).finally(()=>{state.pending--;$('busy-bar').classList.toggle('hidden',state.pending===0);});
  }
  function handleError(error){
    if(error.message==='SESSION_CHANGED')return;
    if(error.code==='REGISTRATION_REQUIRED'){goRegistration(error);return;}
    toast(error.message||String(error),true);
    if(/SESSION_EXPIRED|ACCESS_DENIED/.test(String(error.message))){signOut();$('auth-status').textContent=error.message;}
  }
  async function run(task,saving=false){if(state.busy)return;state.busy=true;if(saving)$('busy-overlay').classList.remove('hidden');document.querySelectorAll('dialog button').forEach(b=>b.disabled=true);try{await task();}catch(e){handleError(e);}finally{state.busy=false;$('busy-overlay').classList.add('hidden');document.querySelectorAll('dialog button').forEach(b=>b.disabled=false);if($('restock-dialog').open)renderRestockProduct();}}
  function updateStats(){const available=state.inventory.filter(i=>i.balance>0).length;$('stat-inventory').innerHTML=num(available)+' <small>รายการ</small>';$('stat-orders').innerHTML=num(state.history.length)+' <small>ใบ</small>';$('stat-cart').innerHTML=num(state.cart.length)+' <small>รายการ</small>';$('nav-history-count').textContent=state.history.length;}
  async function loadWorkspace(){const [inventory,history]=await Promise.all([rpc('getInventoryData',state.user.token),rpc('getMyWithdrawalHistory',state.user.token)]);state.inventory=inventory;state.history=history;updateStats();}
  async function signIn(user){state.user=user;const persisted=VillaAPI.saveSession(user);if(!persisted)toast('เบราว์เซอร์ไม่อนุญาตให้จดจำการเข้าสู่ระบบ เมื่อปิดหน้านี้ต้องเข้าสู่ระบบใหม่',true);updateSessionClock();$('auth').classList.add('hidden');$('shell').classList.remove('hidden');$('user-name').textContent=user.name;$('user-dept').textContent=user.dept+' · '+user.role;$('user-avatar').textContent=user.name.slice(0,2).toUpperCase();$('greeting').textContent='สวัสดี, '+user.name;$('order-dept').textContent=user.dept;document.querySelectorAll('[data-role]').forEach(el=>el.classList.toggle('hidden',el.dataset.role==='admin'?!isAdmin():!isWarehouse()));renderCart();stopDesktopQr(false);if(!desktopMode&&!VillaAPI.pendingDesktopApproval())$('notice-dialog').showModal();await loadWorkspace();await navigate(desktopMode&&isWarehouse()?'daily':'requisition');}
  function signOut(options={}){stopDesktopQr();qrApproval=null;const token=state.user?.token;if(options.clear!==false)VillaAPI.clearSession();if(token&&options.revoke!==false)VillaAPI.request('logoutSession',token).catch(()=>{});state.user=null;document.body.classList.remove('printing-order');$('print-order').textContent='';state.editItems=[];state.editRequest=null;state.restockRequest=null;state.cart=[];state.history=[];state.weekly=[];state.selected=null;state.editing=null;state.orderRequest=null;state.inventory=[];document.querySelectorAll('dialog').forEach(d=>d.close());$('shell').classList.add('hidden');$('auth').classList.remove('hidden');$('auth-status').textContent='ออกจากระบบแล้ว กดตรวจสอบบัญชีอีกครั้งเพื่อเข้าใช้งาน';$('line-login').classList.remove('hidden');$('line-login').disabled=false;$('auth-register').classList.add('hidden');$('auth-register').removeAttribute('href');$('product-search').value='';$('selection').classList.add('hidden');['history-search','history-from','history-to','inventory-search','edit-search','weekly-search','restock-product','restock-qty'].forEach(id=>$(id).value='');$('history-status').value='all';$('weekly-status').value='all';['history-content','inventory-content','daily-content','weekly-content','weekly-overview','edit-items','edit-info','product-results','edit-results','restock-product-info','legacy-name','legacy-employee','cart-items','user-name','user-dept','session-label','order-dept','greeting'].forEach(id=>$(id).textContent='');renderAuthMode();closeNav();}
  function updateSessionClock(){
    if(!state.user)return;
    const remaining=Number(state.user.expiresAt)-Date.now();
    if(remaining<=0){signOut();$('auth-status').textContent='ครบ 1 ชั่วโมงแล้ว กรุณาตรวจสอบบัญชีอีกครั้ง';return;}
    $('session-label').textContent='เซสชันเหลือ '+Math.ceil(remaining/60000)+' นาที';
  }
  function goRegistration(error){
    const destination=VillaAPI.registrationDestination(error);
    signOut();
    if(!destination){$('auth-status').textContent='ไม่พบลิงก์ลงทะเบียนที่ถูกต้อง กรุณาติดต่อผู้ดูแล';return;}
    const link=$('auth-register');link.href=destination;link.classList.remove('hidden');
    $('line-login').classList.add('hidden');
    $('auth-status').textContent='ยังไม่พบทะเบียนพนักงาน กำลังพาไปลงทะเบียนที่เว็บ Customer Interaction…';
    location.replace(destination);
  }
  async function lineLogin(){
    $('line-login').disabled=true;$('line-login').classList.add('hidden');$('auth-register').classList.add('hidden');
    $('auth-status').textContent='กำลังตรวจสอบบัญชี LINE และข้อมูลพนักงาน…';
    try{
      const user=await VillaAPI.login({fresh:freshLineLogin});
      freshLineLogin=false;$('line-login-label').textContent='ตรวจสอบบัญชีอีกครั้ง';
      if(user){await signIn(user);await showDesktopApproval();}
      else $('auth-status').textContent='กำลังเปิด LINE เพื่อยืนยันบัญชี…';
    }catch(error){
      if(error.code==='REGISTRATION_REQUIRED'){goRegistration(error);return;}
      freshLineLogin=['LINE_ACCESS_INVALID','LINE_ACCESS_MISSING','LINE_REAUTH_REQUIRED','LINE_PROFILE_REQUIRED','LINE_TOKEN_EXPIRED','LINE_TOKEN_INVALID','LINE_VERIFY_FAILED','LINE_OPENID_REQUIRED'].includes(error.code);
      $('line-login-label').textContent=freshLineLogin?'ยืนยันกับ LINE ใหม่':'ตรวจสอบบัญชีอีกครั้ง';
      $('auth-status').textContent=error.message||'ตรวจสอบบัญชีไม่สำเร็จ กรุณาลองใหม่';
      $('line-login').classList.remove('hidden');$('line-login').disabled=false;
      throw error;
    }
  }
  function preferDesktopLogin(){
    if(window.liff&&typeof liff.isInClient==='function'&&liff.isInClient())return false;
    const mode=new URLSearchParams(location.search||'').get('login');
    if(mode==='qr'||mode==='desktop'||mode==='warehouse')return true;
    if(mode==='line')return false;
    // Device detection only chooses the screen; LINE identity and roles are
    // always verified by the API. Phones retain automatic LINE verification.
    return typeof window.matchMedia==='function'&&window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }
  function renderAuthMode(){
    $('auth-heading').textContent=desktopMode?'เข้าสู่ระบบบนคอม':'ตรวจสอบข้อมูลพนักงาน';
    $('auth-description').textContent=desktopMode?'กดตรวจสอบบัญชีอีกครั้ง แล้วสแกน QR ด้วย LINE บนมือถือเพื่อเข้าสู่ระบบ':'ระบบตรวจสอบบัญชี LINE ให้อัตโนมัติ หากยังไม่มีทะเบียน จะพาไปลงทะเบียนที่เว็บเดิม';
    if(desktopMode){$('line-login').classList.remove('hidden');$('line-login').disabled=false;$('line-login-label').textContent='ตรวจสอบบัญชีอีกครั้ง';}
  }
  function stopDesktopQr(cancel=true){
    qrGeneration++;if(qrTimer!==null)clearTimeout(qrTimer);qrTimer=null;
    const previous=qrRequest;qrRequest=null;
    $('desktop-qr-panel').classList.add('hidden');$('desktop-qr-image').innerHTML='';
    if(previous&&cancel)VillaAPI.request('cancelDesktopLogin',{scanToken:previous.scanToken,desktopToken:previous.desktopToken}).catch(()=>{});
  }
  function desktopQrFailed(message){
    stopDesktopQr();$('auth-status').textContent=message;
    $('line-login').classList.remove('hidden');$('line-login').disabled=false;
  }
  function updateQrClock(){
    if(!qrRequest)return;
    const remaining=Number(qrRequest.expiresAt)-Date.now();
    if(remaining<=0){desktopQrFailed('QR หมดอายุแล้ว กดตรวจสอบบัญชีอีกครั้งเพื่อสร้าง QR ใหม่');return;}
    $('desktop-qr-status').textContent='รอการยืนยันบนมือถือ · QR เหลือ '+Math.ceil(remaining/1000)+' วินาที';
  }
  async function pollDesktopQr(generation){
    const current=qrRequest;if(!current||generation!==qrGeneration)return;
    if(Date.now()>=current.expiresAt){updateQrClock();return;}
    try{
      const result=await VillaAPI.request('pollDesktopLogin',{scanToken:current.scanToken,desktopToken:current.desktopToken});
      if(generation!==qrGeneration||current!==qrRequest)return;
      if(result.status==='complete'){
        if(result.user?.authMethod!=='qr')throw new Error('ข้อมูลยืนยัน QR ไม่ถูกต้อง');
        stopDesktopQr(false);try{await signIn(result.user);}catch(error){handleError(error);}return;
      }
    }catch(error){
      if(generation!==qrGeneration||current!==qrRequest)return;
      if(['QR_EXPIRED','QR_USED','QR_ACCESS_DENIED','ACCESS_DENIED','REGISTRATION_REQUIRED','SESSION_EXPIRED','API_UPDATE_REQUIRED'].includes(error.code)){
        desktopQrFailed(error.message);return;
      }
      $('auth-status').textContent='กำลังเชื่อมต่ออีกครั้ง… หากยืนยันบนมือถือแล้ว กรุณารอ';
    }
    if(generation===qrGeneration&&qrRequest)qrTimer=setTimeout(()=>pollDesktopQr(generation),5000);
  }
  async function startDesktopQr(){
    const previous=qrRequest;stopDesktopQr(false);const generation=qrGeneration;
    $('line-login').disabled=true;$('auth-status').textContent='กำลังสร้าง QR สำหรับคอมเครื่องนี้…';
    try{
      const next=await VillaAPI.request('startDesktopLogin',previous?{scanToken:previous.scanToken,desktopToken:previous.desktopToken}:{});
      if(generation!==qrGeneration){VillaAPI.request('cancelDesktopLogin',{scanToken:next.scanToken,desktopToken:next.desktopToken}).catch(()=>{});return;}
      qrRequest=next;
      if(typeof window.qrcode!=='function')throw new Error('โหลดตัวสร้าง QR ไม่สำเร็จ กรุณารีเฟรชหน้าเว็บ');
      const qr=qrcode(0,'M');qr.addData(VillaAPI.desktopQrUrl(next.scanToken),'Byte');qr.make();
      $('desktop-qr-image').innerHTML=qr.createSvgTag({cellSize:4,margin:16,scalable:true});
      $('desktop-qr-code').textContent=next.code;$('desktop-qr-panel').classList.remove('hidden');
      $('line-login').classList.add('hidden');$('auth-status').textContent='เปิดตัวสแกน QR ใน LINE บนมือถือ แล้วกดยืนยันการเข้าคอม';
      updateQrClock();qrTimer=setTimeout(()=>pollDesktopQr(generation),5000);
    }catch(error){desktopQrFailed(error.message||'สร้าง QR ไม่สำเร็จ กรุณาลองอีกครั้ง');throw error;}
    finally{$('line-login').disabled=false;}
  }
  async function showDesktopApproval(){
    const scanToken=VillaAPI.pendingDesktopApproval();if(!scanToken||!state.user||desktopMode)return;
    try{
      const info=await rpc('inspectDesktopLogin',{token:state.user.token,scanToken});
      qrApproval={scanToken,code:info.code,expiresAt:info.expiresAt};
      $('qr-approval-name').textContent=state.user.name+' · '+state.user.dept;
      $('qr-approval-code').textContent=info.code;$('qr-approval-status').textContent='อนุญาตเฉพาะเมื่อคุณเป็นผู้เปิด QR นี้บนคอม';
      $('qr-approval-confirm').disabled=false;$('qr-approval-dialog').showModal();
    }catch(error){VillaAPI.finishDesktopApproval();toast(error.message,true);}
  }
  function dismissDesktopApproval(){
    qrApproval=null;VillaAPI.finishDesktopApproval();$('qr-approval-dialog').close();
  }
  async function confirmDesktopApproval(){
    if(!qrApproval)return;
    if(Date.now()>=qrApproval.expiresAt){dismissDesktopApproval();throw new Error('QR หมดอายุแล้ว กรุณาสร้างใหม่บนคอม');}
    const current=qrApproval;
    try{await rpc('approveDesktopLogin',{token:state.user.token,scanToken:current.scanToken,code:current.code});}
    catch(error){if(['QR_EXPIRED','QR_USED','QR_ACCESS_DENIED'].includes(error.code))dismissDesktopApproval();throw error;}
    dismissDesktopApproval();toast('ยืนยันสำเร็จ คอมจะเข้าสู่ระบบในสักครู่');
  }
  async function initializeAuth(){
    desktopMode=preferDesktopLogin();renderAuthMode();
    try{
      VillaAPI.validateConfig();
      if(desktopMode){
        const user=await VillaAPI.restoreDesktopSession();
        if(user)await signIn(user);else $('auth-status').textContent='กดตรวจสอบบัญชีอีกครั้งเพื่อแสดง QR เข้าสู่ระบบ';
      }else await lineLogin();
    }catch(error){
      $('auth-status').textContent=error.message||'ตรวจสอบบัญชีไม่สำเร็จ กรุณาลองใหม่';
      $('line-login').classList.remove('hidden');$('line-login').disabled=false;
      handleError(error);
    }
  }
  async function openLegacy(){
    const data=await rpc('getLegacyOwnerOptions',state.user.token);
    $('legacy-name').innerHTML='<option value="">เลือกชื่อผู้เบิกเดิม</option>'+data.legacyNames.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    $('legacy-employee').innerHTML='<option value="">เลือกพนักงาน</option>'+data.employees.map(e=>`<option value="${esc(e.id)}">${esc(e.id)} · ${esc(e.name)} · ${esc(e.dept)}</option>`).join('');
    if(!data.legacyNames.length){toast('ไม่มีประวัติเดิมที่ยังไม่ได้เชื่อม');return;}
    $('legacy-dialog').showModal();
  }
  function printOrder(){
    const order=state.editing;if(!order)return;
    $('print-order').innerHTML=`<header class="document-heading"><div><strong>VILLA MARKET</strong><h1>ใบเบิกพัสดุสำนักงาน</h1></div><div><strong>เลขที่ ${esc(documentLabel(order))}</strong><p>วันที่ ${esc(order.date)}</p></div></header><p>ผู้เบิก: ${esc(order.userName)}<br>แผนก: ${esc(order.dept)}<br>สถานะ: ${order.status==='cancelled'?'ยกเลิกแล้ว':order.fulfillmentStatus==='ready'?'พร้อมรับพัสดุ':'รอจัดของ'}</p><table><thead><tr><th>รหัสสินค้า</th><th>รายการ</th><th>ขนาดบรรจุ</th><th class="number">ขอเบิก</th><th class="number">จัดจริง</th><th>หน่วย</th></tr></thead><tbody>${order.items.map(i=>`<tr><td>${esc(i.id)}</td><td>${esc(i.name)}</td><td>${esc(i.packSize)}</td><td class="number">${num(i.requestedQty??i.qty)}</td><td class="number">${i.fulfilledQty===null||i.fulfilledQty===undefined?'—':num(i.fulfilledQty)}</td><td>${esc(i.unit)}</td></tr>`).join('')}</tbody></table><p class="small muted" style="margin-top:20px">ข้อมูลที่บันทึกแล้ว · อัปเดตล่าสุด ${esc(order.updatedAt)}</p>`;
    document.body.classList.add('printing-order');window.print();
  }
  function closeNav(){$('sidebar').classList.remove('is-open');$('scrim').classList.remove('is-open');}
  async function navigate(page){if(!state.user)return;if(['inventory','weekly'].includes(page)&&!isAdmin())return;if(page==='daily'&&!isWarehouse())return;state.page=page;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('hidden',el.id!=='page-'+page));document.querySelectorAll('.nav-item[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));$('breadcrumb-title').textContent=titles[page];closeNav();if(page==='history'){state.history=await rpc('getMyWithdrawalHistory',state.user.token);updateStats();renderHistory();}if(page==='inventory'){state.inventory=await rpc('getSummaryReport',state.user.token);updateStats();renderInventory();}if(page==='daily')await loadWarehouse();if(page==='weekly'){state.weekly=await rpc('getWeeklyWithdrawalReport',state.user.token);renderWeekly();}}
  function findProducts(query){const q=query.trim().toLowerCase();if(!q)return [];return state.inventory.filter(i=>String(i.name).toLowerCase().includes(q)||String(i.id).toLowerCase().includes(q)).sort((a,b)=>(b.id.toLowerCase()===q?1:0)-(a.id.toLowerCase()===q?1:0)).slice(0,8);}
  function availableFor(id,editing){const item=stock(id);const original=editing?state.editing.items.filter(i=>i.id===id).reduce((s,i)=>s+i.qty,0):0;return (item?.balance??0)+original;}
  function searchProducts(editing=false){const input=editing?'edit-search':'product-search',target=editing?'edit-results':'product-results';const results=findProducts($(input).value);$(target).classList.toggle('hidden',!$(input).value.trim());$(target).innerHTML=results.length?results.map(item=>`<button type="button" class="result" data-action="${editing?'edit-add':'select-product'}" data-id="${esc(item.id)}"><span><span class="result-name">${esc(item.name)}</span><span class="result-meta" style="display:block">${esc(item.id)} · ${esc(item.unit)} · ${esc(item.packSize)}</span></span><span class="result-stock">${num(availableFor(item.id,editing))} ${esc(item.unit)}</span></button>`).join(''):'<div class="empty small" style="padding:20px">ไม่พบสินค้าที่ค้นหา</div>';}
  function selectProduct(id){const item=stock(id);if(!item)return;state.selected=item;$('product-search').value=item.name;$('product-results').classList.add('hidden');$('selection').classList.remove('hidden');$('selection').innerHTML=`<div class="selection-name">${esc(item.name)}</div><p class="small muted" style="margin-top:5px">${esc(item.id)} · ${esc(item.packSize)}</p><p style="font-size:11px;color:var(--blue);margin-top:7px">คงเหลือ ${num(item.balance)} ${esc(item.unit)}</p><div class="quantity-add"><div class="field"><label for="product-qty">จำนวนที่เบิก (${esc(item.unit)})</label><input id="product-qty" class="control" type="number" min="1" max="1000000" step="1" value="1"></div><button class="btn btn-primary" data-action="add-cart">${icon('plus')}เพิ่มรายการ</button></div>`;$('product-qty').focus();$('product-qty').select();}
  function validQty(value){const qty=Number(value);if(!Number.isSafeInteger(qty)||qty<=0||qty>1000000)throw new Error('กรุณาระบุจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000');return qty;}
  function addCart(){if(!state.selected)return;const item=state.selected,qty=validQty($('product-qty').value),existing=state.cart.find(i=>i.id===item.id),total=(existing?.qty||0)+qty;if(total>item.balance)throw new Error('สต็อกไม่เพียงพอ คงเหลือ '+num(item.balance)+' '+item.unit);if(existing)existing.qty=total;else state.cart.push({...item,qty});state.orderRequest=null;renderCart();$('selection').classList.add('hidden');$('product-search').value='';state.selected=null;$('product-search').focus();}
  function itemRow(item,index,editing=false){if(editing&&state.editing?.canEdit===false)return `<div class="cart-item"><div class="item-copy"><strong>${esc(item.name)}</strong><small>${esc(item.id)} · ขอ ${num(item.requestedQty)} ${esc(item.unit)} · จัดจริง ${num(item.fulfilledQty)} ${esc(item.unit)}</small></div></div>`;return `<div class="cart-item ${editing?'editor-item':''}"><div class="item-square">${icon('box')}</div><div class="item-copy"><strong>${esc(item.name)}</strong><small>${esc(item.id)} · ${esc(item.packSize)}</small><small>${esc(item.unit)}${editing?' · เบิกได้รวม '+num(availableFor(item.id,true))+' '+esc(item.unit):''}</small></div><input class="control qty-input" type="number" min="1" step="1" max="1000000" value="${item.qty}" data-quantity="${editing?'edit':'cart'}" data-index="${index}" aria-label="จำนวน ${esc(item.name)}"><button class="icon-btn" data-action="${editing?'edit-remove':'cart-remove'}" data-index="${index}" aria-label="ลบ ${esc(item.name)}">${icon('trash')}</button></div>`;}
  function renderCart(){$('cart-items').innerHTML=state.cart.length?state.cart.map((i,index)=>itemRow(i,index)).join(''):empty('ยังไม่มีรายการเบิก','ค้นหาพัสดุ แล้วเพิ่มรายการที่ต้องการ');$('cart-count').textContent=state.cart.length+' รายการ';$('submit-order').disabled=!state.cart.length;updateStats();}
  async function submitOrder(){if(!state.cart.length)return;state.cart.forEach(i=>validQty(i.qty));if(!state.orderRequest)state.orderRequest=key();const result=await rpc('processOrder',{token:state.user.token,requestId:state.orderRequest,type:'เบิกคลัง',items:state.cart.map(i=>({id:i.id,qty:i.qty}))});state.cart=[];state.orderRequest=null;state.selected=null;$('selection').classList.add('hidden');$('product-search').value='';renderCart();toast('บันทึกใบเบิก #'+(result.documentNo||result.orderId)+' เรียบร้อยแล้ว');await loadWorkspace();await navigate('history');}
  function filteredHistory(){const q=$('history-search').value.trim().toLowerCase(),from=$('history-from').value,to=$('history-to').value,status=$('history-status').value;return state.history.filter(order=>(!from||order.dateKey>=from)&&(!to||order.dateKey<=to)&&(status==='all'||status===order.status)&&(!q||(order.documentNo||order.id).toLowerCase().includes(q)||order.items.some(i=>[i.name,i.id].join(' ').toLowerCase().includes(q))));}
  function renderHistory(){const orders=filteredHistory();$('history-result-count').textContent='พบ '+orders.length+' ใบเบิก';$('history-content').innerHTML=orders.length?orders.map(order=>`<article class="order-card"><div class="order-card-top"><div><div class="order-title">${icon('list')}<strong>#${esc(documentLabel(order))}</strong><span class="chip ${order.status==='active'?'chip-green':'chip-red'}">${order.status==='active'?'มีรายการเบิก':'ยกเลิกแล้ว'}</span></div><p class="order-date">${esc(order.date)} · ${esc(order.dept)}</p></div><span class="chip">${order.items.length} รายการ${order.fulfillmentStatus==='ready'?' · พร้อมรับแล้ว':''}</span></div><p class="order-preview">${order.items.length?order.items.slice(0,2).map(i=>esc(i.name)+' × '+num(i.qty)+' '+esc(i.unit)).join(' &nbsp;·&nbsp; '):'ทุกรายการถูกยกเลิกและคืนสต็อกแล้ว'}${order.items.length>2?' และอีก '+(order.items.length-2)+' รายการ':''}</p><div class="order-card-bottom"><span class="small muted">อัปเดตล่าสุด ${esc(order.updatedAt)}</span><button class="btn btn-small" data-action="open-edit" data-id="${esc(order.id)}">${icon('edit')}${order.canEdit===false?'ดูผลจัดของ':'ดู / แก้ไขใบเบิก'}</button></div></article>`).join(''):empty('ยังไม่พบใบเบิก','ลองเปลี่ยนตัวกรอง หรือเริ่มทำรายการเบิกใหม่');}
  async function openEdit(id){state.history=await rpc('getMyWithdrawalHistory',state.user.token);const order=state.history.find(i=>i.id===id);if(!order)return;state.inventory=await rpc('getInventoryData',state.user.token);state.editing=order;state.editItems=order.items.map(i=>({...i}));state.editRequest=null;$('edit-order-id').textContent='#'+documentLabel(order);$('edit-info').innerHTML=`<span>วันที่เบิก: ${esc(order.date)}</span><span>ผู้เบิก: ${esc(order.userName)}</span><span>แผนก: ${esc(order.dept)}</span>`;$('edit-search').value='';$('edit-search').disabled=order.canEdit===false;document.querySelectorAll('[data-action="save-edit"],[data-action="cancel-order"]').forEach(el=>el.classList.toggle('hidden',order.canEdit===false));$('edit-info').innerHTML+=order.fulfillmentStatus==='ready'?'<span>พร้อมรับแล้ว · '+esc(order.readyAt)+' · ติดต่อคลังหากต้องการเปลี่ยนแปลง</span>':'';$('edit-results').classList.add('hidden');renderEditor();$('edit-dialog').showModal();}
  function renderEditor(){$('edit-items').innerHTML=state.editItems.length?state.editItems.map((i,index)=>itemRow(i,index,true)).join(''):empty('ไม่มีสินค้าในใบเบิกนี้','เพิ่มสินค้าใหม่ หรือบันทึกเพื่อยกเลิกใบเบิก');}
  function addEditItem(id){const item=stock(id);if(!item)return;const existing=state.editItems.find(i=>i.id===id);if((existing?.qty||0)+1>availableFor(id,true))throw new Error('สต็อกไม่เพียงพอสำหรับรายการที่เพิ่ม');if(existing)existing.qty++;else state.editItems.push({...item,qty:1});state.editRequest=null;$('edit-search').value='';$('edit-search').disabled=order.canEdit===false;document.querySelectorAll('[data-action="save-edit"],[data-action="cancel-order"]').forEach(el=>el.classList.toggle('hidden',order.canEdit===false));$('edit-info').innerHTML+=order.fulfillmentStatus==='ready'?'<span>พร้อมรับแล้ว · '+esc(order.readyAt)+' · ติดต่อคลังหากต้องการเปลี่ยนแปลง</span>':'';$('edit-results').classList.add('hidden');renderEditor();}
  async function saveEdit(cancelled=false){if(!state.editing)return;if(state.editing.canEdit===false)throw new Error('คลังจัดของเสร็จแล้ว กรุณาติดต่อคลัง');const items=cancelled?[]:state.editItems;items.forEach(i=>validQty(i.qty));if(!state.editRequest)state.editRequest=key();await rpc('updateMyWithdrawal',{token:state.user.token,requestId:state.editRequest,orderId:state.editing.id,revision:state.editing.revision,items:items.map(i=>({id:i.id,qty:i.qty}))});$('edit-dialog').close();state.editing=null;state.editItems=[];state.editRequest=null;toast(cancelled||!items.length?'ยกเลิกใบเบิกและคืนสต็อกเรียบร้อยแล้ว':'แก้ไขใบเบิกและปรับสต็อกเรียบร้อยแล้ว');await loadWorkspace();renderHistory();renderCart();}
  function renderInventory(){const q=$('inventory-search').value.trim().toLowerCase();const items=state.inventory.filter(i=>[i.id,i.name].join(' ').toLowerCase().includes(q));$('inventory-content').innerHTML=items.length?`<table><thead><tr><th>พัสดุ</th><th>หน่วย / บรรจุ</th><th class="number">ยกมา</th><th class="number">รับเข้า</th><th class="number">เบิก</th><th class="number">คงเหลือ</th></tr></thead><tbody>${items.map(i=>`<tr><td><strong>${esc(i.name)}</strong><div class="table-sub">${esc(i.id)}</div></td><td>${esc(i.unit)}<div class="table-sub">${esc(i.packSize)}</div></td><td class="number">${num(i.initial)}</td><td class="number">${num(i.in)}</td><td class="number">${num(i.out)}</td><td class="number stock-number ${i.balance<=0?'low':''}">${num(i.balance)}</td></tr>`).join('')}</tbody></table>`:empty('ไม่พบสินค้า','ลองค้นหาด้วยชื่อ หรือรหัสอื่น');}
  function notificationLabel(n){
    if(n?.status==='accepted')return 'LINE รับคำขอแจ้งเตือนแล้ว (ไม่ใช่การยืนยันว่าอ่านแล้ว)';
    const labels={NOT_CONFIGURED:'ยังไม่ได้เปิดแจ้งเตือน LINE หรือยังไม่ได้ตั้งค่า OA',PROVIDER_NOT_CONFIRMED:'ต้องตั้ง Messaging API ให้อยู่ Provider เดียวกับ LINE Login',FREE_QUOTA_EXHAUSTED:'โควตาฟรีหมดแล้ว ผลจัดของบันทึกครบแล้ว',FREE_PLAN_REQUIRED:'บัญชี OA นี้ไม่เข้าเงื่อนไขแพ็กเกจฟรี จึงหยุดส่ง',QUOTA_CHECK_FAILED:'ตรวจโควตา LINE ไม่สำเร็จ จึงยังไม่ส่ง',RECIPIENT_MISSING:'ไม่พบข้อมูล LINE ที่ยืนยันได้ของผู้เบิก ให้ผู้ดูแลตรวจทะเบียน',ADD_FRIEND_REQUIRED:'ให้ผู้เบิกเพิ่มเพื่อน LINE OA และตรวจ Provider ให้ตรงกัน',RETRY_WINDOW_EXPIRED:'ผลส่งเดิมยังไม่ยืนยัน กรุณาตรวจใน LINE OA ก่อน หยุดลองส่งเพื่อป้องกันซ้ำ',NETWORK_ERROR:'LINE ตอบกลับไม่ครบ สามารถลองแจ้งอีกครั้งได้หลัง 30 วินาที',STATUS_SAVE_FAILED:'ผลแจ้งเตือนยังไม่ยืนยัน กรุณาโหลดข้อมูลใหม่ก่อนลองอีกครั้ง'};
    return labels[n?.code]||(n?.status==='pending'?'รอแจ้งเตือน LINE':'ยังยืนยันผลแจ้ง LINE ไม่ได้ กรุณาตรวจการตั้งค่าแล้วลองอีกครั้ง');
  }
  function hydrateWarehouse(order){state.warehouseDrafts[order.id]=Object.fromEntries(order.items.map(i=>[i.lineId,i.fulfilledQty===null||i.fulfilledQty===undefined?'':String(i.fulfilledQty)]));delete state.fulfillmentRequests[order.id];}
  async function loadWarehouse(){
    if(!$('warehouse-date').value)$('warehouse-date').value=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Bangkok'}).format(new Date());
    state.warehouse=await rpc('getWarehouseOrders',{token:state.user.token,date:$('warehouse-date').value});state.warehouseDrafts={};state.fulfillmentRequests={};state.warehouse.forEach(hydrateWarehouse);renderWarehouse();
  }
  function renderWarehouse(){
    const status=$('warehouse-status').value||'all',orders=state.warehouse.filter(o=>status==='all'||(status==='ready'?o.fulfillmentStatus==='ready':o.fulfillmentStatus!=='ready'));
    $('warehouse-print-date').textContent='วันที่ใบเบิก '+$('warehouse-date').value;
    $('daily-content').innerHTML=orders.length?orders.map(order=>{
      const ready=order.fulfillmentStatus==='ready',draft=state.warehouseDrafts[order.id]||{},n=order.notification;
      return `<article class="card warehouse-card"><div class="card-head"><div><h2>#${esc(documentLabel(order))}</h2><p class="table-sub">${esc(order.userName)} · ${esc(order.dept)} · ${esc(order.date)}</p></div><span class="chip ${ready?'chip-green':''}">${ready?'พร้อมรับพัสดุ':order.fulfillmentStatus==='draft'&&!order.draftStale?'บันทึกร่างแล้ว':'รอจัดของ'}</span></div>${order.draftStale?'<p class="warehouse-warning">ผู้เบิกแก้ไขรายการแล้ว กรุณาตรวจและกรอกจำนวนจัดจริงใหม่</p>':''}<div class="table-scroll"><table><thead><tr><th>รายการ / รหัส</th><th>หน่วย</th><th class="number">ขอเบิก</th><th class="number">จัดให้จริง</th></tr></thead><tbody>${order.items.map(i=>`<tr><td><strong>${esc(i.name)}</strong><div class="table-sub">${esc(i.id)} · บรรจุ ${esc(i.packSize)}</div></td><td>${esc(i.unit)}</td><td class="number">${num(i.requestedQty)}</td><td class="number">${ready?`<strong>${num(i.fulfilledQty)}</strong>`:`<input class="control fulfillment-qty no-print" type="number" min="0" max="${i.requestedQty}" step="1" inputmode="numeric" value="${esc(draft[i.lineId]??'')}" data-fulfill-order="${esc(order.id)}" data-fulfill-line="${esc(i.lineId)}" aria-label="จำนวนที่จัดจริง ${esc(i.name)}" placeholder="ระบุจำนวน"><span class="print-actual">${draft[i.lineId]===''?'—':esc(draft[i.lineId])}</span>`}</td></tr>`).join('')}</tbody></table></div><div class="warehouse-footer">${ready?`<div><strong>จัดเสร็จ ${esc(order.readyAt)}</strong><p class="small muted no-print">${esc(notificationLabel(n))}</p></div>${n?.status!=='accepted'&&n?.code!=='RETRY_WINDOW_EXPIRED'?`<button class="btn btn-small no-print" data-action="fulfillment-retry" data-id="${esc(order.id)}">ลองแจ้ง LINE อีกครั้ง</button>`:''}`:`<span class="small muted">ระบุครบทุกบรรทัด · จัดไม่ได้ให้ใส่ 0</span><div class="warehouse-actions no-print"><button class="btn btn-small" data-action="fulfillment-draft" data-id="${esc(order.id)}">บันทึกร่าง</button><button class="btn btn-primary btn-small" data-action="fulfillment-ready" data-id="${esc(order.id)}">จัดเสร็จ พร้อมรับ</button></div>`}</div></article>`;
    }).join(''):empty('ไม่มีใบเบิกตามวันที่หรือสถานะนี้','เปลี่ยนวันที่เพื่อดูใบเบิกก่อนหน้า');
  }
  function warehouseInput(id){
    const order=state.warehouse.find(o=>o.id===id);if(!order||order.fulfillmentStatus==='ready')throw new Error('กรุณาโหลดใบเบิกใหม่ก่อนจัดของ');
    const draft=state.warehouseDrafts[id]||{},items=order.items.map(i=>{const raw=draft[i.lineId],qty=Number(raw);if(raw===undefined||raw===null||String(raw).trim()===''||!Number.isSafeInteger(qty)||qty<0||qty>i.requestedQty)throw new Error('กรุณาใส่จำนวนจัดจริงทุกบรรทัด ตั้งแต่ 0 ถึงจำนวนขอเบิก');return {lineId:i.lineId,qty};});
    return {order,items};
  }
  function confirmFulfillment(id){const {order,items}=warehouseInput(id);if(!items.some(i=>i.qty>0))throw new Error('ยังไม่มีสินค้าที่จัดได้ กรุณาบันทึกร่างก่อน');state.pendingFulfillment=id;$('fulfillment-confirm-summary').textContent='ใบเบิก #'+documentLabel(order)+' · '+order.userName+' · จัดได้ '+items.filter(i=>i.qty>0).length+' จาก '+items.length+' รายการ';$('fulfillment-confirm').showModal();}
  function replaceWarehouse(order){const index=state.warehouse.findIndex(o=>o.id===order.id);if(index>=0)state.warehouse[index]=order;hydrateWarehouse(order);renderWarehouse();}
  async function saveWarehouse(id,mode){const {order,items}=warehouseInput(id);let attempt=state.fulfillmentRequests[id];if(!attempt||attempt.mode!==mode)attempt=state.fulfillmentRequests[id]={mode,requestId:key()};const result=await rpc('saveFulfillment',{token:state.user.token,requestId:attempt.requestId,orderId:id,mode,orderRevision:order.revision,fulfillmentRevision:order.fulfillmentRevision||'',items});replaceWarehouse(result.order);toast(mode==='ready'?'บันทึกจัดเสร็จแล้ว · '+notificationLabel(result.order.notification):'บันทึกจำนวนจัดจริงเป็นร่างแล้ว');state.inventory=await rpc('getInventoryData',state.user.token);updateStats();}
  async function retryWarehouseNotice(id){const result=await rpc('retryReadyNotification',{token:state.user.token,orderId:id});replaceWarehouse(result.order);toast(notificationLabel(result.order.notification),result.order.notification.status!=='accepted');}

  function renderWeekly(){
    const all=state.weekly,q=$('weekly-search').value.trim().toLowerCase(),status=$('weekly-status').value;
    if(all.some(i=>!i.periodStart||!i.periodEnd||!Array.isArray(i.dailyQty)||!['ok','unset','invalid'].includes(i.parStatus))){
      $('weekly-overview').textContent='';
      $('weekly-content').innerHTML=empty('กรุณาอัปเดต API สำหรับรายงานใหม่','แทนที่ Code.gs และ Deploy เป็น New version ก่อนเปิดวางแผนสั่งซื้อ');return;
    }
    const needsBuy=i=>Number.isFinite(i.recommendedQty)&&i.recommendedQty>0;
    const needsCheck=i=>i.stockStatus!=='ok'||i.parStatus==='invalid'||!Number.isFinite(i.recommendedQty);
    const items=all.filter(i=>[i.id,i.name].join(' ').toLowerCase().includes(q)&&(status==='all'||(status==='buy'&&needsBuy(i))||(status==='enough'&&!needsCheck(i)&&i.recommendedQty===0)||(status==='check'&&needsCheck(i))));
    const dateLabel=date=>new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
    const period=all.length?dateLabel(all[0].periodStart)+' – '+dateLabel(all[0].periodEnd):'ย้อนหลัง 7 วัน รวมวันนี้';
    $('weekly-overview').innerHTML=`<div class="reorder-summary"><span>ช่วงข้อมูล</span><strong>${esc(period)}</strong></div><div class="reorder-summary"><span>มีพาร์หรือประวัติเบิก</span><strong>${num(all.length)} <small>รายการ</small></strong></div><div class="reorder-summary reorder-summary-buy"><span>แนะนำให้สั่งซื้อ</span><strong>${num(all.filter(needsBuy).length)} <small>รายการ</small></strong></div>`;
    if(!all.length){$('weekly-content').innerHTML=empty('ยังไม่มีพาร์หรือยอดเบิกใน 7 วันล่าสุด','กำหนดพาร์ใน Inventory คอลัมน์ K หรือรอรายการเบิกเพื่อคำนวณจำนวนสั่งซื้อ');return;}
    if(!items.length){$('weekly-content').innerHTML=empty('ไม่พบรายการตามตัวกรอง','ลองเปลี่ยนคำค้นหรือประเภทที่ต้องการดู');return;}
    $('weekly-content').innerHTML=`<div class="reorder-result-count small muted">แสดง ${items.length} จาก ${all.length} รายการ</div>`+items.map(i=>{
      const check=needsCheck(i),buy=needsBuy(i),unit=i.unit||'-';
      const badge=check?'ตรวจสอบข้อมูล':buy?'แนะนำให้สั่งซื้อ':'สต็อกเพียงพอ';
      const hint=i.demandStatus==='unit_mismatch'?'หน่วยประวัติเบิก ('+(i.demandUnits||[]).join(', ')+') ไม่ตรงกับ Inventory ('+unit+') กรุณาตรวจหน่วยหรืออัตราแปลงก่อนคำนวณ':i.parStatus==='invalid'?'พาร์ใน Inventory คอลัมน์ K ไม่ถูกต้อง กรุณาระบุจำนวนเต็มตั้งแต่ 0 ขึ้นไป':i.stockStatus==='missing'?'ไม่พบรหัสนี้ใน Inventory กรุณาตรวจสอบก่อนสั่งซื้อ':i.stockStatus==='negative'?'ยอดคงเหลือติดลบ กรุณาตรวจนับก่อนคำนวณจำนวนสั่งซื้อ':check?'กรุณาตรวจสอบข้อมูลก่อนสั่งซื้อ':(i.calculationSource==='par'?'ใช้พาร์จาก Inventory คอลัมน์ K':'ยังไม่ตั้งพาร์ ใช้ยอดเบิกรวม 7 วันแทน')+' · จำนวนเป็น '+unit+' · ขนาดบรรจุ '+(i.packSize||'-');
      return `<article class="weekly-card reorder-card"><div class="weekly-top"><div><h2 class="reorder-product">${esc(i.name)}</h2><p class="table-sub">${esc(i.id)} · ${esc(unit)}</p></div><span class="chip ${check?'chip-red':buy?'reorder-chip-buy':'chip-green'}">${badge}</span></div><div class="reorder-quantities"><div><span>เบิกรวม 7 วัน</span><strong>${i.totalQty===null?'—':num(i.totalQty)} <small>${esc(unit)}</small></strong></div><div><span>คงเหลือปัจจุบัน</span><strong>${i.balance===null||i.balance===undefined?'—':num(i.balance)} <small>${esc(unit)}</small></strong></div><div><span>${i.calculationSource==='par'?'พาร์เป้าหมาย (K)':'เป้าหมายจากยอดเบิก'}</span><strong>${i.targetQty===null?'—':num(i.targetQty)} <small>${esc(unit)}</small></strong></div><div class="reorder-recommendation ${buy?'needs-buy':''}"><span>แนะนำสั่งซื้อ</span><strong>${check?'—':num(i.recommendedQty)} <small>${esc(unit)}</small></strong></div></div><p class="table-sub ${check?'reorder-check':''}">${esc(hint)}</p><details class="reorder-breakdown"><summary>ดูยอดเบิกแยกรายวัน · มีการเบิก ${num(i.daysActive)} วัน</summary><div class="reorder-days">${(i.dailyQty||[]).map(day=>`<div><span>${esc(dateLabel(day.date))}</span><strong>${day.qty===null?'—':num(day.qty)}</strong><small>${esc(unit)}</small></div>`).join('')}</div></details></article>`;
    }).join('');
  }
  function renderRestockProduct(){
    const input=$('restock-product'),id=input.value.trim(),item=stock(id),missing=Boolean(id&&!item);
    input.setCustomValidity(missing?'ไม่พบรหัสสินค้านี้ กรุณาตรวจสอบรหัสอีกครั้ง':'');
    input.setAttribute('aria-invalid',String(missing));
    $('restock-submit').disabled=!item||state.busy;
    $('restock-qty-label').textContent=item?'จำนวนรับเข้า ('+item.unit+')':'จำนวนรับเข้า (ตามหน่วยนับของสินค้า)';
    $('restock-product-info').classList.toggle('restock-product-error',missing);
    $('restock-product-info').innerHTML=item?icon('check')+`<div><strong>${esc(item.name)}</strong><br>รหัส ${esc(item.id)} · หน่วย ${esc(item.unit)} · บรรจุ ${esc(item.packSize)}<br>คงเหลือ ${num(item.balance)} ${esc(item.unit)}</div>`:icon('info')+`<span>${missing?'ไม่พบรหัสสินค้า '+esc(id)+' กรุณาตรวจสอบรหัสอีกครั้ง':'กรอกรหัสสินค้าเพื่อดูชื่อและหน่วยนับ'}</span>`;
    return item;
  }
  async function openRestock(){
    if(!isAdmin())return;
    state.inventory=await rpc('getInventoryData',state.user.token);state.restockRequest=null;
    $('restock-product').value='';$('restock-qty').value='';renderRestockProduct();
    $('restock-dialog').showModal();$('restock-product').focus();
  }
  $('line-login').addEventListener('click',()=>run(desktopMode?startDesktopQr:lineLogin));
  $('desktop-qr-refresh').addEventListener('click',()=>run(startDesktopQr));
  $('desktop-qr-cancel').addEventListener('click',()=>desktopQrFailed('ยกเลิก QR แล้ว กดตรวจสอบบัญชีอีกครั้งเพื่อเริ่มใหม่'));
  $('qr-approval-confirm').addEventListener('click',()=>run(confirmDesktopApproval));
  $('qr-approval-deny').addEventListener('click',dismissDesktopApproval);
  $('qr-approval-dialog').addEventListener('cancel',()=>{if(!state.busy)dismissDesktopApproval();});
  $('legacy-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const result=await rpc('linkLegacyOwner',{token:state.user.token,legacyName:$('legacy-name').value,employeeId:$('legacy-employee').value});
    $('legacy-dialog').close();toast('เชื่อมประวัติแล้ว '+result.orders+' ใบเบิก');await loadWorkspace();if(state.page==='history')renderHistory();
  },true);});
  $('restock-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const item=renderRestockProduct();
    if(!item){$('restock-product').reportValidity();throw new Error('กรุณาระบุรหัสสินค้าที่มีอยู่ในระบบ');}
    const qty=validQty($('restock-qty').value);
    if(!state.restockRequest)state.restockRequest=key();
    await rpc('processRestock',{token:state.user.token,requestId:state.restockRequest,id:item.id,qty});
    state.restockRequest=null;$('restock-dialog').close();toast('รับพัสดุเข้าสต็อกเรียบร้อยแล้ว');await loadWorkspace();if(state.page==='inventory')renderInventory();
  },true);});
  $('restock-product').addEventListener('input',()=>{state.restockRequest=null;renderRestockProduct();});
  $('restock-qty').addEventListener('input',()=>state.restockRequest=null);
  $('restock-product').addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;e.preventDefault();
    const item=renderRestockProduct();
    if(item){$('restock-qty').focus();$('restock-qty').select();}else $('restock-product').reportValidity();
  });
  $('product-search').addEventListener('input',()=>{state.selected=null;$('selection').classList.add('hidden');searchProducts();});$('edit-search').addEventListener('input',()=>searchProducts(true));
  ['product-search','edit-search'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();const first=findProducts($(id).value)[0];if(first){try{id==='edit-search'?addEditItem(first.id):selectProduct(first.id);}catch(error){handleError(error);}}}));
  ['history-search','history-from','history-to','history-status'].forEach(id=>$(id).addEventListener('input',renderHistory));$('inventory-search').addEventListener('input',renderInventory);$('weekly-search').addEventListener('input',renderWeekly);$('weekly-status').addEventListener('change',renderWeekly);
  document.addEventListener('input',e=>{const id=e.target.dataset.fulfillOrder,lineId=e.target.dataset.fulfillLine;if(!id||!lineId||!state.warehouseDrafts[id])return;state.warehouseDrafts[id][lineId]=e.target.value;delete state.fulfillmentRequests[id];});
  $('warehouse-date').addEventListener('change',()=>run(loadWarehouse));$('warehouse-status').addEventListener('change',renderWarehouse);
  document.addEventListener('change',e=>{if(!e.target.dataset.quantity)return;const editing=e.target.dataset.quantity==='edit',items=editing?state.editItems:state.cart,item=items[Number(e.target.dataset.index)];if(!item)return;try{const qty=validQty(e.target.value);if(qty>availableFor(item.id,editing))throw new Error('จำนวนที่ระบุเกินสต็อกที่เบิกได้');item.qty=qty;if(editing)state.editRequest=null;else state.orderRequest=null;}catch(error){e.target.value=item.qty;handleError(error);}});
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='product-qty'){e.preventDefault();try{addCart();}catch(error){handleError(error);}}});
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('cancel',e=>{if(state.busy||dialog.id==='notice-dialog')e.preventDefault();}));
  document.addEventListener('click',e=>{const el=e.target.closest('[data-action],[data-page]');if(!el||state.busy)return;const action=el.dataset.action;if(el.dataset.page){run(()=>navigate(el.dataset.page));return;}try{
    if(action==='open-nav'){$('sidebar').classList.add('is-open');$('scrim').classList.add('is-open');}
    if(action==='close-nav')closeNav();if(action==='logout')signOut();if(action==='refresh')run(async()=>{await loadWorkspace();await navigate(state.page);toast('อัปเดตข้อมูลล่าสุดแล้ว');});
    if(action==='select-product')selectProduct(el.dataset.id);if(action==='add-cart')addCart();
    if(action==='cart-remove'){state.cart.splice(Number(el.dataset.index),1);state.orderRequest=null;renderCart();}
    if(action==='submit-order')run(submitOrder,true);if(action==='open-edit')run(()=>openEdit(el.dataset.id));
    if(action==='edit-add')addEditItem(el.dataset.id);if(action==='edit-remove'){state.editItems.splice(Number(el.dataset.index),1);state.editRequest=null;renderEditor();}
    if(action==='close-edit'){$('edit-dialog').close();state.editing=null;}if(action==='save-edit')run(()=>saveEdit(),true);if(action==='print-order')printOrder();
    if(action==='cancel-order')$('confirm-dialog').showModal();if(action==='confirm-no')$('confirm-dialog').close();if(action==='confirm-yes'){$('confirm-dialog').close();state.editRequest=null;run(()=>saveEdit(true),true);}
    if(action==='fulfillment-draft')run(()=>saveWarehouse(el.dataset.id,'draft'),true);if(action==='fulfillment-ready')confirmFulfillment(el.dataset.id);if(action==='fulfillment-retry')run(()=>retryWarehouseNotice(el.dataset.id),true);if(action==='fulfillment-back')$('fulfillment-confirm').close();if(action==='fulfillment-confirm'){const id=state.pendingFulfillment;$('fulfillment-confirm').close();run(()=>saveWarehouse(id,'ready'),true);}
    if(action==='open-notice')$('notice-dialog').showModal();if(action==='acknowledge-notice'){$('notice-dialog').close();if(state.page==='requisition')$('product-search').focus();}
    if(action==='open-restock')run(openRestock);if(action==='close-restock')$('restock-dialog').close();if(action==='open-legacy')run(openLegacy);if(action==='close-legacy')$('legacy-dialog').close();if(action==='print'){if(state.page==='daily')renderWarehouse();window.print();}
  }catch(error){handleError(error);}});
  document.addEventListener('click',e=>{if(!e.target.closest('.search-box'))document.querySelectorAll('.results').forEach(el=>el.classList.add('hidden'));});
  setInterval(()=>{updateSessionClock();updateQrClock();},1000);
  window.addEventListener('afterprint',()=>{document.body.classList.remove('printing-order');$('print-order').textContent='';});
  document.addEventListener('visibilitychange',updateSessionClock);
  window.addEventListener('storage',e=>{if(e.key===VillaAPI.sessionKey&&state.user){signOut({clear:false,revoke:false});$('auth-status').textContent='เซสชันเปลี่ยนจากแท็บอื่น กรุณารีเฟรชเพื่อเข้าสู่ระบบ';}});
  run(initializeAuth);
  const now=new Date();$('today-label').textContent=new Intl.DateTimeFormat('th-TH',{dateStyle:'long',timeZone:'Asia/Bangkok'}).format(now);document.querySelectorAll('.date-short').forEach(el=>el.textContent=new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}).format(now));
})();
