# Villa Market — ระบบเบิกพัสดุ v3

หน้าเว็บทั้งหมดอยู่บน **GitHub Pages** ใช้ **LINE Login ผ่าน LIFF** และเรียก **Google Apps Script JSON API** โดยตรง ไม่มี iframe, `google.script.run` หรือไฟล์ HTML ใน Apps Script

## ไฟล์สำหรับติดตั้ง

```text
index.html                 หน้าเว็บ GitHub Pages
config.js                  URL API และ LIFF ID (ตั้งค่าสองค่า)
assets/app.css             รูปแบบหน้าเว็บ
assets/app.js              การเบิก ประวัติ แก้ไข รายงาน และพิมพ์
assets/api.js              เรียก API, LINE Login และจำเซสชัน
apps-script/Code.gs         JSON API ฝั่งเซิร์ฟเวอร์
apps-script/appsscript.json การตั้งค่า Apps Script
.nojekyll                  เปิดใช้งานไฟล์ static บน GitHub Pages
```

## 1. เตรียมข้อมูลพนักงาน

ใช้ไฟล์ Customer Interaction S33 เดิม:

`1aov9pN2ErlXtVGLm1717z3RJZdwnkGrzRs_BCaoqEvQ`

อ่านแผ่น `Employee_Master` ตามคอลัมน์ต่อไปนี้ โดยไม่ต้องใช้ `Users` ในไฟล์พัสดุอีก สามารถเก็บชีท Users ไว้เป็นข้อมูลเก่าได้

| คอลัมน์ | ข้อมูล | การใช้งาน |
|---|---|---|
| A | รหัสพนักงาน | ระบุตัวเจ้าของใบเบิก ควรใช้รหัสถาวรและห้ามซ้ำ |
| B / C | ชื่อ / นามสกุล | ชื่อผู้เบิกที่แสดงในเอกสาร |
| D | แผนก | แผนกผู้เบิก |
| F | สถานะ | ปฏิเสธบัญชีที่ระบุ Inactive, Disabled, Resigned, Terminated, Suspended, ลาออก, พ้นสภาพ, ระงับ หรือ ไม่ใช้งาน; ช่องว่างยังใช้ได้ตามข้อมูลเดิม |
| G | LINE User ID | จับคู่กับตัวตนที่ LINE ยืนยัน ต้องไม่ซ้ำ |
| K | สิทธิ์ของแอพเดิม | ระบบนี้ไม่ใช้กำหนดสิทธิ์ |
| M | สิทธิ์เบิกพัสดุ | ใช้ Admin / Staff / Warehouse เท่านั้น |

คอลัมน์ M ต้องมีหัวข้อ `สิทธิ์เบิกพัสดุ` ถ้าไม่ได้กำหนดสิทธิ์ ระบบจะไม่ให้เข้าใช้งาน ไม่มีการให้สิทธิ์ Admin หรือสมัครพนักงานใหม่อัตโนมัติ

| Role ใน M | เมนู |
|---|---|
| Staff | เบิก ดูประวัติ แก้ไข ยกเลิก คืนใบเบิก และพิมพ์รายการของตัวเอง |
| Warehouse | สิทธิ์ Staff และใบจัดของประจำวันแยกแผนก |
| Admin | ทุกเมนู รวมสต็อก รับเข้า รายงาน 7 วัน และเชื่อมประวัติเดิม |

## 2. ติดตั้ง Apps Script API

1. เปิดโปรเจกต์ Apps Script ของระบบพัสดุเดิม แล้วแทนที่ Code.gs ด้วย `apps-script/Code.gs` ในชุดนี้
2. ไม่ต้องสร้างไฟล์ index.html ใน Apps Script อีก `doGet()` จะตอบสถานะ API เป็น JSON
3. ตั้ง timezone เป็น `Asia/Bangkok` หรือใช้ `apps-script/appsscript.json` ที่ให้มา
4. ไป Project Settings → Script Properties เพิ่ม `LINE_LOGIN_CHANNEL_ID` เป็น Channel ID ของ LINE Login ที่ LIFF ระบบนี้ใช้อยู่ (เลขหน้าขีดของ LIFF ID)
5. บัญชี Google ที่ Deploy ต้องมีสิทธิ์อ่านไฟล์พนักงาน และอ่าน/เขียนไฟล์พัสดุ อนุญาตสิทธิ์ Google ของโปรเจกต์นี้ให้ครบ
6. Deploy → New deployment → Web app → Execute as **Me** → Who has access **Anyone** คัดลอก URL `/exec` (อย่าใช้ `/dev`)
7. เปิด URL `/exec` ควรเห็น `{"ok":true,"service":"Villa Market Supplies API",...}`

หากต้องเปลี่ยนไฟล์ข้อมูลภายหลัง สามารถตั้ง Script Properties เพิ่ม:

| Property | ค่าเริ่มต้นเมื่อไม่ตั้ง |
|---|---|
| SPREADSHEET_ID | `1artv-NpWPmAEpv9Qs2MmCnyYnSkcI2GZrwfq--4s8Do` |
| EMPLOYEE_SPREADSHEET_ID | `1aov9pN2ErlXtVGLm1717z3RJZdwnkGrzRs_BCaoqEvQ` |

เมื่อเปลี่ยน Code.gs ให้ Manage deployments → Edit → New version → Deploy เพื่อคง URL `/exec` เดิม

## 3. อัปโหลดขึ้น GitHub Pages

1. แตก ZIP และนำ **ไฟล์ด้านในโฟลเดอร์ villa-supplies** ขึ้น repository โดยให้ index.html อยู่ที่ root ของ repository
2. Settings → Pages → Deploy from a branch → เลือก branch `main` และโฟลเดอร์ `/(root)` → Save
3. รอให้ GitHub แสดง URL ของ Pages แล้วนำ URL นี้ไปตั้ง LIFF ในขั้นตอนถัดไป
4. อัปโหลดไฟล์ assets ทั้งโฟลเดอร์และ config.js ด้วย ไม่ใช่เฉพาะ index.html ไม่ต้องติดตั้ง npm หรือ build

Code.gs เปิดเผยเป็น source ได้ แต่ห้ามใส่ Channel secret, Channel access token หรือข้อมูลเซสชันใน repository

## 4. ตั้ง LINE / LIFF

ใช้ LINE Login channel เดิมที่อยู่ใน Provider ของแอพบันทึกพูดคุยลูกค้า เพื่อให้ LINE User ID ตรงกับข้อมูลพนักงานที่ผูกไว้

เพิ่ม **LIFF สำหรับหน้าเบิกพัสดุ** ใน channel เดิม ไม่ต้องสร้างไฟล์พนักงานใหม่ และอย่าเปลี่ยน Endpoint ของ LIFF แอพบันทึกพูดคุยลูกค้าที่ใช้อยู่

- Size: Full
- Endpoint URL: URL GitHub Pages ของระบบนี้ พร้อม path ของ repository และ `/` ท้าย URL ให้ตรงกับ URL ที่เปิดจริง
- Scope: `openid` และ `profile`
- Channel ต้องอนุญาตให้พนักงานใช้งานได้ หากอยู่ในสถานะ Developing ผู้ใช้ต้องอยู่ในรายชื่อผู้ทดสอบ หรือ Publish channel ตามการใช้งานจริง

จากนั้นแก้ config.js:

```javascript
window.VILLA_CONFIG = {
  webAppUrl: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
  liffId: "CHANNEL_ID-LIFF_SUFFIX"
};
```

สองค่านี้ไม่ใช่ secret และต้องแทนที่ด้วยค่าจริง โดยเลข CHANNEL_ID ต้องตรงกับ `LINE_LOGIN_CHANNEL_ID` ฝั่ง Apps Script

เปิดใช้งานจาก GitHub Pages หรือ LIFF URL ใหม่ของระบบเบิกพัสดุ กด “เข้าสู่ระบบด้วย LINE” หน้าเว็บส่งเฉพาะ ID token ไปให้เซิร์ฟเวอร์ตรวจสอบกับ LINE แล้วใช้ `sub` ที่ตรวจสอบแล้วจับคู่คอลัมน์ G ไม่รับชื่อหรือ role จากหน้าเว็บมาใช้เป็นสิทธิ์

## เซสชัน 1 ชั่วโมง

- อายุคงที่ 3,600 วินาทีนับจากล็อกอินสำเร็จ การรีเฟรชหรือทำรายการไม่ต่ออายุ
- จำเฉพาะ token ของระบบเบิกพัสดุและเวลาหมดอายุใน localStorage จึงเปิดกลับมาได้ภายในชั่วโมงเดิมเมื่อเบราว์เซอร์อนุญาตการจัดเก็บ
- ฝั่งเซิร์ฟเวอร์เก็บค่า hash ของ token เป็น key และตรวจวันหมดอายุเอง ใช้ Script Properties จึงไม่ขึ้นกับการถูกไล่ออกจาก CacheService
- หน้าเว็บตรวจหมดอายุทุกวินาทีและเมื่อกลับมาเปิดแท็บ พร้อมออกจากระบบและล้างข้อมูลที่แสดง ส่วน API ตรวจเซสชันก่อนอ่าน/เขียนข้อมูลทุกครั้ง
- กดออกจากระบบจะลบเซสชันที่เซิร์ฟเวอร์ด้วย เมื่อหมดอายุต้องกดเข้าสู่ระบบ LINE ใหม่
- อ่าน role และสถานะจาก Employee_Master ใหม่ทุกคำขอ การเปลี่ยนสิทธิ์/ระงับบัญชีจึงมีผลที่ API ทันที

## เลขที่เอกสาร

ใบเบิกใหม่มีเลข `YYYYMMDDNNNN` เช่น `202610230001`, `202610230002` โดยใช้ timezone ของไฟล์พัสดุ (`Asia/Bangkok`)

- เริ่ม `0001` ใหม่ทุกวัน และเพิ่มหนึ่งครั้งต่อใบเบิก ไม่ใช่ต่อสินค้า
- แก้ไข ยกเลิก คืนใบเบิก และส่งคำขอเดิมซ้ำ ใช้เลขเดิม
- ใช้ ScriptLock จองเลขร่วมกันทุกผู้ใช้ พร้อมเก็บตัวนับถาวร และตรวจเลขสูงสุดในประวัติ
- เลขที่จองไปแล้วจะไม่ถูกนำกลับมาใช้ แม้บันทึกไม่สำเร็จ จึงอาจมีเลขข้ามได้
- รองรับสูงสุด 9,999 ใบต่อวัน เมื่อครบจะหยุดก่อนตัดสต็อก
- UUID เดิมใน OrderId ยังเป็นรหัสภายใน เลขที่เอกสารอยู่คอลัมน์ P และแสดงเต็มในประวัติ หน้ารายละเอียด และใบพิมพ์
- ใบเบิกเก่าที่มีวันที่ถูกต้องจะได้รับเลขเอกสารตามวันที่เดิม โดยไม่เปลี่ยน UUID

## ประวัติเดิมและโครงสร้างชีทพัสดุ

Inventory ใช้โครงสร้างเดิม B=ID, C=ชื่อสินค้า, D=หน่วย, E=ขนาดบรรจุ, F=ยอดยกมา, G=รับเข้า, H=เบิก, I=คงเหลือ สูตร I เดิมจะถูกเก็บไว้ ยอดที่ใช้ตรวจสต็อกคำนวณจาก F+G-H ตามที่ตกลงกัน หาก I ไม่ใช่สูตร ระบบเขียนยอดจาก F+G-H ให้สอดคล้อง

TransactionLogs A:I คงรูปแบบเดิม ส่วน J:P:

| คอลัมน์ | ข้อมูล |
|---|---|
| J | OrderId (UUID) |
| K | LineId |
| L | Status |
| M | UpdatedAt |
| N | RequestKey |
| O | EmployeeId เจ้าของใบเบิก |
| P | DocumentNo เลขที่เอกสาร |

ตรวจให้แน่ใจว่า O:P ว่างหรือเป็นคอลัมน์ของระบบตามหัวข้อนี้ หากมีข้อมูลอื่นอยู่ ระบบจะแจ้งข้อผิดพลาดเพื่อไม่เขียนทับ

ประวัติที่สร้างสมัยล็อกอินด้วยชื่อจะยังไม่มี EmployeeId ระบบจึงไม่จับคู่จากชื่ออัตโนมัติ ให้ Admin เปิดเมนู **เชื่อมประวัติเดิม** เลือกชื่อผู้เบิกเดิมและรหัสพนักงานที่ถูกต้อง แล้วยืนยัน หลังเชื่อมพนักงานจะดู/แก้ไขรายการเดิมผ่าน LINE ได้ การเชื่อมไม่ตัดหรือคืนสต็อก

WithdrawalEdits เก็บประวัติการเพิ่ม แก้ไข ยกเลิก รับเข้า และเชื่อมเจ้าของเดิม ฟิลด์ User ของรายการใหม่ใช้ `employee:รหัสพนักงาน`

## ตรวจสอบหลังติดตั้ง

1. เปิด GitHub Pages บนคอมและมือถือ ตรวจการเข้าสู่ระบบ LINE และชื่อ/แผนก/role
2. ลอง Staff, Warehouse และ Admin คนละบัญชี ตรวจเมนูและสิทธิ์ API
3. เบิกสินค้าทดสอบ ตรวจ H/I ประวัติ และเลขเอกสาร จากนั้นลดจำนวน/ยกเลิกให้คืนสต็อก
4. รีเฟรชภายใน 1 ชั่วโมง ต้องเข้าเซสชันเดิม เมื่อครบชั่วโมงต้องเข้าสู่ระบบอีกครั้ง
5. ตรวจการพิมพ์ใบเบิก เลขเอกสาร และใบจัดของรายวัน

ทดสอบตรรกะจำลองได้ด้วย `npm test` (ใช้ Node.js โดยไม่ต้องติดตั้ง dependency) การทดสอบนี้ไม่แทนการตรวจ LINE, Google permissions, CORS และหน้าจอจริงหลัง Deploy

หากขึ้น Failed to fetch ให้ตรวจ URL `/exec`, สิทธิ์ Anyone, เวอร์ชัน Deploy และการอนุญาต Google ของบัญชีผู้ Deploy หน้าเว็บใช้ POST แบบ text/plain และตาม redirect ของ ContentService ไม่ใช้ `no-cors` ซึ่งอ่านคำตอบไม่ได้

Modal กติกา 07.30 / จัดของไม่เกิน 08.00 / เบิกหนึ่งรอบต่อวันยังเป็นข้อความแจ้งเตือนตามงานก่อนหน้า ยังไม่ได้เพิ่มการบล็อกเวลาหรือจำนวนรอบต่อวัน

ใช้ ScriptLock และคืน snapshot เมื่อเขียนล้มเหลว แต่ Google Sheets ไม่ใช่ฐานข้อมูล transaction และไม่ป้องกันการแก้ชีทด้วยมือหรือสคริปต์จากโปรเจกต์อื่นขณะบันทึก

อ้างอิง: [LINE: ตรวจข้อมูลผู้ใช้ฝั่งเซิร์ฟเวอร์](https://developers.line.biz/en/docs/liff/using-user-profile/), [LINE: LIFF](https://developers.line.biz/en/docs/liff/developing-liff-apps/), [Google: ContentService](https://developers.google.com/apps-script/guides/content)
