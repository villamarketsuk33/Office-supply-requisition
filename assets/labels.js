const root=()=>document.getElementById('labels-root');
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MM=72/25.4,PER_PAGE=21;
let account='',inventory=[],edits={},custom=[],selected=new Map(),editing=null,notify=()=>{},dirty=false,pdfUrl='',pdfPromise,fontPromise,session=0,outputGeneration=0,pdfGenerating=false,fontsLoaded=false;
const asset=name=>new URL(name,import.meta.url).href;
const storageKey=()=>`villa-supplies:labels:v1:${account}`;
function loadFonts(){
  if(fontPromise)return fontPromise;
  if(!$('label-fonts')){fontPromise=new Promise((resolve,reject)=>{const link=document.createElement('link');link.id='label-fonts';link.rel='stylesheet';link.href=asset('label-fonts.css');link.onload=resolve;link.onerror=()=>{link.remove();fontPromise=null;reject(new Error('โหลดฟอนต์ป้ายไม่สำเร็จ กรุณาลองใหม่'));};document.head.append(link);});return fontPromise;}
  return Promise.resolve();
}
const fontsReady=()=>loadFonts().then(()=>document.fonts.load('700 16px Sarabun')).then(()=>document.fonts.ready);
function products(){return inventory.map(i=>({key:i.id,code:i.id,name:i.name,...edits[i.id]})).concat(custom);}
function filtered(){const q=($('label-search')?.value||'').trim().toLocaleLowerCase('th');return products().filter(p=>`${p.code} ${p.name}`.toLocaleLowerCase('th').includes(q));}
function persist(){
  try{localStorage.setItem(storageKey(),JSON.stringify({edits,custom}));return true;}
  catch{notify('เบราว์เซอร์บันทึกรายการป้ายไม่ได้ กรุณาดาวน์โหลดสำรองก่อนปิดหน้า',true);return false;}
}
function revokePdf(){if(pdfUrl)URL.revokeObjectURL(pdfUrl);pdfUrl='';const a=$('label-pdf-link');if(a){a.hidden=true;a.removeAttribute('href');}}
function invalidatePrint(){outputGeneration++;revokePdf();$('labels-print').replaceChildren();document.body.classList.remove('printing-labels');if($('label-output-status'))$('label-output-status').textContent='กระดาษ A4 · ขนาดจริง 100% · 21 ป้ายต่อหน้า';}
function renderList(){
  const rows=filtered();
  $('label-list-count').textContent=`${rows.length} รายการ`;
  $('label-list').innerHTML=rows.length?rows.map(p=>`<div class="label-row"><label class="label-choice"><input type="checkbox" data-label-select="${esc(p.key)}" ${selected.has(p.key)?'checked':''}><span><strong>${esc(p.name)}</strong><small>${esc(p.code)}${p.key.startsWith('custom:')?' · เพิ่มเอง':''}</small></span></label><button type="button" class="btn btn-small" data-label-edit="${esc(p.key)}" aria-label="แก้ไขป้าย ${esc(p.name)}">แก้ไข</button><input class="control label-copies" type="number" min="1" max="99" step="1" value="${selected.get(p.key)||1}" data-label-copies="${esc(p.key)}" aria-label="จำนวนป้าย ${esc(p.name)}"></div>`).join(''):'<div class="empty"><strong>ไม่พบสินค้า</strong><p>ลองค้นหาด้วยชื่อหรือรหัสอื่น</p></div>';
  updateCount();
}
function batches(){
  const list=[];for(const p of products()){const copies=selected.get(p.key)||0;for(let n=0;n<copies;n++)list.push(p);}
  const pages=[];for(let n=0;n<list.length;n+=PER_PAGE)pages.push(list.slice(n,n+PER_PAGE));return pages;
}
function updateCount(){const count=[...selected.values()].reduce((n,q)=>n+q,0);$('label-selection-count').textContent=`เลือก ${selected.size} รายการ · ${count} ป้าย`;$('label-print').disabled=!count||!fontsLoaded;$('label-pdf').disabled=!count||pdfGenerating;$('label-clear').disabled=!count;}
function splitLines(ctx,text,width){
  const tokens=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('th',{granularity:'word'}).segment(text)].map(x=>x.segment):Array.from(text);
  const lines=[];let line='';
  for(const token of tokens){
    if(ctx.measureText(line+token).width<=width){line+=token;continue;}
    if(line.trim())lines.push(line.trim());line='';
    if(ctx.measureText(token).width<=width){line=token.trimStart();continue;}
    const chars=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(token)].map(x=>x.segment):Array.from(token);
    for(const ch of chars){if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line='';}line+=ch;}
  }
  if(line.trim())lines.push(line.trim());return lines;
}
function drawLabel(product){
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=840;
  const c=canvas.getContext('2d');c.scale(24,24); // All layout values below are millimeters.
  c.fillStyle='#fff';c.fillRect(0,0,50,35);
  c.strokeStyle='#c7ced7';c.lineWidth=.12;c.strokeRect(.1,.1,49.8,34.8);
  c.fillStyle='#173b66';c.fillRect(0,0,50,1.1);c.fillRect(0,1.1,1.1,32.8);
  c.fillStyle='#d92735';c.fillRect(39,0,11,1.1);c.fillRect(0,33.9,50,1.1);
  c.textBaseline='middle';c.fillStyle='#173b66';c.font='700 2.05px Sarabun';c.fillText('VILLA MARKET',3.4,4.1);
  c.textAlign='right';c.font='500 1.6px Sarabun';c.fillStyle='#8893a3';c.fillText('SUKHUMVIT 33',46.8,4.1);
  c.strokeStyle='#dce3ed';c.lineWidth=.14;c.beginPath();c.moveTo(3.4,6.4);c.lineTo(46.8,6.4);c.stroke();
  let size=4.6,lines=[];
  do{c.font=`700 ${size}px Sarabun`;lines=splitLines(c,product.name,43);if(lines.length*size*1.25<=20)break;size-=.1;}while(size>1.65);
  c.fillStyle='#173b66';c.textAlign='center';
  const height=lines.length*size*1.25,top=17-height/2+size*.625;
  lines.forEach((line,n)=>c.fillText(line,25,top+n*size*1.25));
  c.textAlign='left';c.fillStyle='#8591a2';c.font='500 1.9px Sarabun';c.fillText('รหัสสินค้า',3.4,30.5);
  c.fillStyle='#173b66';c.textAlign='right';let codeSize=3;
  do{c.font=`700 ${codeSize}px Sarabun`;if(c.measureText(product.code).width<=30)break;codeSize-=.1;}while(codeSize>1.2);
  c.fillText(product.code,46.8,30.5);return canvas;
}
function preview(){
  const draft={name:$('label-name').value.trim()||'ชื่อสินค้า',code:$('label-code').value.trim()||'0000000'};
  $('label-preview').replaceChildren(drawLabel(draft));
}
function openEditor(p=null){
  if(dirty&&!confirm('มีข้อความบนป้ายที่ยังไม่บันทึก ต้องการเปลี่ยนรายการหรือไม่?'))return;
  editing=p?.key||null;dirty=false;
  $('label-name').value=p?.name||'';$('label-code').value=p?.code||'';
  $('label-editor-title').textContent=p?'แก้ไขข้อความบนป้าย':'เพิ่มป้ายสินค้า';$('label-save-status').textContent='';preview();
}
function saveEditor(e){
  e.preventDefault();const name=$('label-name').value.trim(),code=$('label-code').value.trim();
  if(!name||!code)return;
  if(products().some(p=>p.key!==editing&&p.code===code)){notify('รหัสป้ายนี้มีแล้ว กรุณาใช้รหัสอื่น',true);return;}
  if(!editing){editing='custom:'+crypto.randomUUID();custom.push({key:editing,name,code});}
  else if(editing.startsWith('custom:')){const item=custom.find(p=>p.key===editing);Object.assign(item,{name,code});}
  else edits[editing]={name,code};
  const saved=persist();dirty=!saved;invalidatePrint();renderList();$('label-save-status').textContent=saved?'บันทึกป้ายในอุปกรณ์นี้แล้ว':'ยังบันทึกในอุปกรณ์นี้ไม่ได้';
}
function buildPrint(){
  const pages=batches();if(!pages.length)throw new Error('กรุณาเลือกรายการป้ายก่อน');
  if(pages.length>100)throw new Error('เลือกได้ไม่เกิน 2,100 ป้ายต่อครั้ง กรุณาแบ่งพิมพ์');
  const target=$('labels-print');target.replaceChildren();
  const images=new Map();
  pages.forEach((items,n)=>{
    const page=document.createElement('section');page.className='label-print-page';
    const heading=document.createElement('div');heading.className='label-print-heading';heading.textContent='VILLA MARKET · ป้ายชั้นวางสินค้า 5 × 3.5 ซม.';
    const grid=document.createElement('div');grid.className='label-print-grid';
    items.forEach(p=>{if(!images.has(p.key))images.set(p.key,drawLabel(p).toDataURL('image/png'));const img=document.createElement('img');img.src=images.get(p.key);img.width=1200;img.height=840;img.alt=`${p.name} · ${p.code}`;grid.append(img);});
    const footer=document.createElement('div');footer.className='label-print-footer';footer.textContent=`ขนาดจริง 100% · ปิดหัว/ท้ายกระดาษ · ${n+1}/${pages.length}`;
    page.append(heading,grid,footer);target.append(page);
  });return pages;
}
function loadPdf(){
  if(window.PDFLib)return Promise.resolve(window.PDFLib);
  if(!pdfPromise)pdfPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=asset('vendor/pdf-lib.min.js');script.onload=()=>resolve(window.PDFLib);script.onerror=()=>{script.remove();pdfPromise=null;reject(new Error('โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่'));};document.head.append(script);});
  return pdfPromise;
}
async function preparePdf(){
  if(pdfGenerating)return;
  const version=session,generation=outputGeneration,button=$('label-pdf');pdfGenerating=true;button.disabled=true;$('label-output-status').textContent='กำลังสร้าง PDF…';revokePdf();
  try{
    await fontsReady();const {PDFDocument,rgb}=await loadPdf();const pages=batches();
    if(!pages.length||pages.length>100)throw new Error('กรุณาเลือกตั้งแต่ 1 ถึง 2,100 ป้าย');
    const doc=await PDFDocument.create(),images=new Map();doc.setTitle('Villa Market S33 Shelf Labels');
    for(let n=0;n<pages.length;n++){
      if(version!==session||generation!==outputGeneration)return;
      const page=doc.addPage([210*MM,297*MM]);
      for(let i=0;i<pages[n].length;i++){
        const p=pages[n][i];if(!images.has(p.key))images.set(p.key,await doc.embedPng(drawLabel(p).toDataURL('image/png')));
        page.drawImage(images.get(p.key),{x:(27+i%3*53)*MM,y:(297-15-Math.floor(i/3)*38-35)*MM,width:50*MM,height:35*MM});
      }
      page.drawText(`Villa Market | 50 x 35 mm | 100% | ${n+1}/${pages.length}`,{x:27*MM,y:7*MM,size:8,color:rgb(.35,.42,.5)});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    const bytes=await doc.save();if(version!==session||generation!==outputGeneration)return;
    pdfUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const link=$('label-pdf-link');link.href=pdfUrl;link.hidden=false;
    $('label-output-status').textContent='PDF พร้อมแล้ว กด “ดาวน์โหลด PDF” เพื่อบันทึกไฟล์';
  }catch(error){if(version===session){notify(error.message,true);$('label-output-status').textContent='สร้าง PDF ไม่สำเร็จ ลองใหม่ได้';}}
  finally{pdfGenerating=false;if(account&&$('label-selection-count'))updateCount();}
}
function exportData(){
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({version:1,products:products().map(({code,name})=>({code,name}))},null,2)],{type:'application/json'}));a.href=url;a.download='S33-labels-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function importData(file){
  if(!file)return;
  try{
    if(file.size>2e6)throw new Error('ไฟล์มีขนาดเกิน 2 MB');
    const value=JSON.parse(await file.text()),rows=Array.isArray(value)?value:value.products;
    if(!Array.isArray(rows)||rows.length>5000)throw new Error('ไฟล์ต้องมีรายการ products ไม่เกิน 5,000 รายการ');
    const incoming=new Map();for(const row of rows){const code=String(row.code??row.id??row[0]??'').trim(),name=String(row.name??row[1]??'').trim();if(!code||!name||code.length>24||name.length>240)throw new Error('ชื่อหรือรหัสสินค้าไม่ถูกต้อง');incoming.set(code,{code,name});}
    if(dirty&&!confirm('มีข้อความที่ยังไม่บันทึก ต้องการนำเข้าไฟล์ต่อหรือไม่?'))return;
    const all=products();for(const [code,row] of incoming){const item=all.find(p=>p.code===code);if(item){if(item.key.startsWith('custom:'))Object.assign(custom.find(p=>p.key===item.key),row);else edits[item.key]=row;}else custom.push({key:'custom:'+crypto.randomUUID(),...row});}
    persist();invalidatePrint();renderList();dirty=false;openEditor(products().find(p=>p.key===editing)||products()[0]||null);notify(`นำเข้าป้าย ${incoming.size} รายการแล้ว`);
  }catch(error){notify(error.message,true);}finally{$('label-import').value='';}
}
export async function mountLabels({user,inventory:items,toast}){
  notify=toast;const id=String(user.employeeId||user.token);
  if(account===id){inventory=items;const keys=new Set(products().map(p=>p.key));for(const key of selected.keys())if(!keys.has(key))selected.delete(key);invalidatePrint();renderList();if(!fontsLoaded){await fontsReady();fontsLoaded=true;preview();updateCount();}return;}
  clear();account=id;inventory=items;
  try{const data=JSON.parse(localStorage.getItem(storageKey())||'{}');edits=data.edits||{};custom=Array.isArray(data.custom)?data.custom:[];}catch{edits={};custom=[];}
  root().innerHTML=`<div class="notice label-note"><svg><use href="#i-info"/></svg><div>ใช้สินค้าในสต๊อคเดิม · แก้ข้อความป้ายได้โดยไม่เปลี่ยนข้อมูลสต๊อค<br><span class="small">ข้อความที่แก้บันทึกตามบัญชีในอุปกรณ์นี้ ย้ายเครื่องได้ด้วยสำรอง / นำเข้า</span></div></div>
  <div class="label-workspace"><div class="card label-catalog"><div class="card-head"><h2>เลือกรายการสินค้า</h2><span id="label-list-count" class="small muted"></span></div><div class="label-tools"><input id="label-search" class="control" placeholder="ค้นหาชื่อ หรือสแกนรหัสสินค้า" aria-label="ค้นหาป้ายสินค้า"><div class="label-tool-row"><button id="label-all" class="btn btn-small" type="button">เลือกที่ค้นพบ</button><button id="label-clear" class="btn btn-small" type="button">ล้างที่เลือก</button><button id="label-new" class="btn btn-small" type="button">+ เพิ่มป้าย</button></div><div class="small muted">ช่องตัวเลขด้านขวา = จำนวนป้าย</div></div><div id="label-list"></div></div>
  <div class="label-side"><div class="card label-editor"><div class="card-head"><h2 id="label-editor-title">แก้ไขข้อความบนป้าย</h2><span class="chip">5 × 3.5 ซม.</span></div><div class="label-preview-stage"><div id="label-preview"></div><p>ตัวอย่างป้าย · ชื่ออยู่กลาง รหัสอยู่ล่างขวา</p></div><form id="label-form" class="label-form"><div class="field"><label for="label-name">ชื่อสินค้า</label><textarea class="control" id="label-name" rows="3" maxlength="240" required></textarea></div><div class="field"><label for="label-code">รหัสสินค้า</label><input class="control" id="label-code" maxlength="24" required></div><button class="btn btn-primary" type="submit">บันทึกข้อความป้าย</button><p id="label-save-status" class="small muted" role="status"></p></form></div>
  <div class="card label-output"><h2>พิมพ์ป้ายที่เลือก</h2><p id="label-selection-count" class="small muted"></p><button id="label-print" class="btn btn-primary" type="button">พิมพ์ป้าย</button><button id="label-pdf" class="btn" type="button">สร้างไฟล์ PDF</button><a id="label-pdf-link" class="btn btn-primary" download="S33-shelf-labels.pdf" hidden>ดาวน์โหลด PDF</a><p id="label-output-status" class="small muted" role="status">กระดาษ A4 · ขนาดจริง 100% · 21 ป้ายต่อหน้า</p><details><summary>พิมพ์หรือดาวน์โหลดไม่ได้?</summary><p class="small">เปิดเว็บนี้ด้วย Chrome หรือ Safari โดยตรง หากอยู่ใน LINE ให้เลือกเปิดในเบราว์เซอร์ จากนั้นสร้าง PDF และกดดาวน์โหลดอีกครั้ง</p></details><div class="label-tool-row"><button id="label-export" class="btn btn-small" type="button">สำรองรายการ</button><label class="btn btn-small" for="label-import">นำเข้า JSON</label><input id="label-import" type="file" accept="application/json,.json" hidden></div></div></div></div>`;
  $('label-search').oninput=renderList;
  $('label-list').onchange=e=>{
    const id=e.target.dataset.labelSelect||e.target.dataset.labelCopies;if(!id)return;
    if(e.target.dataset.labelSelect){if(e.target.checked)selected.set(id,1);else selected.delete(id);}
    else{const n=Number(e.target.value);if(!Number.isInteger(n)||n<1||n>99){e.target.value=selected.get(id)||1;notify('จำนวนป้ายต้องอยู่ระหว่าง 1–99',true);return;}selected.set(id,n);}
    invalidatePrint();renderList();
  };
  $('label-list').onclick=e=>{const b=e.target.closest('[data-label-edit]');if(b)openEditor(products().find(p=>p.key===b.dataset.labelEdit));};
  $('label-all').onclick=()=>{filtered().forEach(p=>{if(!selected.has(p.key))selected.set(p.key,1);});invalidatePrint();renderList();};
  $('label-clear').onclick=()=>{selected.clear();invalidatePrint();renderList();};
  $('label-new').onclick=()=>openEditor();$('label-form').onsubmit=saveEditor;
  ['label-name','label-code'].forEach(id=>$(id).oninput=()=>{dirty=true;$('label-save-status').textContent='ยังไม่บันทึก';preview();});
  $('label-print').onclick=()=>{try{buildPrint();document.body.classList.add('printing-labels');window.print();$('label-output-status').textContent='หากหน้าพิมพ์ไม่เปิด ให้เปิดเว็บใน Chrome / Safari หรือสร้าง PDF';}catch(e){notify(e.message,true);}};
  $('label-pdf').onclick=preparePdf;$('label-export').onclick=exportData;$('label-import').onchange=e=>importData(e.target.files[0]);
  renderList();openEditor(products()[0]||null);await fontsReady();if(account===id){fontsLoaded=true;preview();updateCount();}
}
export function clear(){session++;account='';inventory=[];edits={};custom=[];selected.clear();editing=null;dirty=false;fontsLoaded=false;invalidatePrint();root()?.replaceChildren();}
window.VillaLabels={clear};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('afterprint',()=>document.body.classList.remove('printing-labels'));
window.addEventListener('beforeprint',()=>{if(account&&!$('page-labels').classList.contains('hidden')&&!document.body.classList.contains('printing-order')&&selected.size){if(!$('labels-print').children.length)buildPrint();document.body.classList.add('printing-labels');}});
