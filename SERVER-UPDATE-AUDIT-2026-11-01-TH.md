# อัปเดตระบบหลังตรวจ Production วันที่ 1 พฤศจิกายน 2569

การ push GitHub ไม่ได้อัปเดตเว็บไซต์ PHP โดยอัตโนมัติ ชุดนี้แก้โค้ดและเตรียมเครื่องมือซ่อมบัญชี ต้องอัปโหลดและตรวจบัญชีตามขั้นตอนด้านล่าง ไม่ติดตั้งใหม่หรือ import seed ทับข้อมูลจริง

## สิ่งที่แก้และสิ่งที่ยังต้องทำ

| ประเด็น audit | โค้ดที่แก้หรือเตรียม | งานบนเซิร์ฟเวอร์ |
|---|---|---|
| F01 หน่วยใหม่ไม่มีบัญชี | CLI สร้างเฉพาะบัญชีหน่วยที่ขาด รันซ้ำไม่เปลี่ยนรหัสเดิม | สร้าง 000029–000032 ถ้ายังขาด |
| F02 ชื่อและกลุ่ม MENTOR ไม่ตรง | CLI ตรวจ/ปรับชื่อและกลุ่มโดยยืนยันตัวบุคคล คง ID รหัสผ่าน และประวัติ | ตรวจครบ 24 คนก่อนปรับสิทธิ์ |
| F03 ที่ปรึกษาขาดบัญชีแยก | ใช้ advisor-accounts.php พร้อมตัวอย่าง grants และรายงาน readiness | ยืนยันสิทธิ์และเปิดบัญชีแยก 6 คน |
| F04 ตัวติดตั้งล้มเหลว | ไม่ตัด SQL ตามอัฒภาคใน comment และแก้ fixture 32 หน่วย/58 บัญชี | ระบบติดตั้งแล้วไม่ต้องเปิด setup ซ้ำ |
| F05 ข้อความผ่านทั้งหมดเมื่อยังไม่ตรวจ | แยกสถานะรอผล/บางส่วน/ผ่านครบ รวมรายข้อ | อัปโหลด frontend |
| F06 หัวข้อและปุ่มมือถือ | ชื่อหน่วยเต็มแถว ปุ่มไอคอนมีชื่อสำหรับโปรแกรมอ่านหน้าจอ | ตรวจ 360/390/768px หลังอัปโหลด |
| F07 คู่สีอ่านยาก | หัวการ์ดใช้ surface/text tokens ตามธีม | ตรวจธีมสว่าง/มืด |
| F08 Escape ข้ามหน้าตั้งรหัส | บังคับ modal แต่มีปุ่มออกจากระบบ | เจ้าของบัญชีตั้งรหัสเองก่อนกรอกงาน |
| F09 HTML แทน JSON | ข้อความไทย เก็บร่าง บล็อก save ที่ไม่ทราบผล ไม่ replay write | ตรวจ bot protection กับโฮสต์โดยไม่ปิดการป้องกัน |
| F10 ยังไม่มีแบบสำรวจ | ช่องตั้ง HTTPS URL ในตัวแก้เนื้อหา | ใส่ลิงก์จริงที่ยืนยันแล้ว |

## 1 สำรองและสร้างแพ็กเกจ

สำรอง MariaDB, files/, เว็บเดิม, config.local.php, accounts.json, installed.lock และ private account bundles เป็นชุดเดียวกัน อย่าแสดงรหัสผ่านลง log

```powershell
node deploy/build-php.mjs var/releases/gecc-audit-update-2026-11-01 --update --zip
```

ใช้ชื่อโฟลเดอร์ใหม่หากมีแพ็กเกจชื่อเดิม เครื่องมือไม่เขียนทับ release เดิม

## 2 อัปโหลด

- เนื้อหาภายใน public/ → public_html/sskgecc/ รวม index.html, assets/, shared/ และ routing แพ็กเกจทำ SHA-256 cache version แล้ว
- เนื้อหาภายใน gecc-private/ → private directory ที่ API ใช้อยู่จริง **นอก public_html** รวม PHP และ account-maintenance.php ใหม่
- คง config.local.php, accounts.json, installed.lock, files/ และ backups/ ของจริง ไม่เขียนทับด้วยของเครื่องพัฒนา
- ไม่อัปโหลด ZIP คู่มือ หรือ examples ไว้ใน public_html ตัวอย่างบัญชีต้องเก็บใน private directory
- ชุด --update ไม่รวม installer/schema/manage สำหรับติดตั้งใหม่ การแก้ installer อยู่ใน source และชุดติดตั้งเต็ม ระบบที่ล็อกติดตั้งแล้วไม่ต้องใช้
- ยืนยันว่า assets/library/sources.json ยังไม่เปิดเผย และไม่เปิด allow_web_setup รอบนี้

## 3 ตรวจบัญชีจริง

แทน gecc-private ด้วย path ที่ API ใช้อยู่ รันผ่าน PHP CLI/terminal ของ control panel หากไม่มี SSH ให้ผู้ดูแลโฮสต์ช่วยรัน CLI ไม่เปิดเครื่องมือเป็น web endpoint

```sh
php gecc-private/account-maintenance.php check
```

ได้ revision, unitsWithoutLogin, mentorsWithoutLogin, advisorsWithoutLogin และ reviewerAccounts โดยไม่มีรหัสผ่าน การอัปโหลดรูปและปรับ content ไม่ได้สร้างบัญชี

## 4 สร้างเฉพาะบัญชีหน่วยที่ขาด

```sh
php gecc-private/account-maintenance.php prepare-units unit-accounts-2570.json
php gecc-private/account-maintenance.php check-units unit-accounts-2570.json
php gecc-private/account-maintenance.php apply-units unit-accounts-2570.json REVISION
```

ใช้ REVISION จาก check ล่าสุด รหัสสุ่มเก็บเฉพาะใน private directory และไม่พิมพ์ออกมา ถ้าไฟล์มีอยู่ให้ตรวจไฟล์เดิม ไม่ลบเพื่อสร้างรหัสใหม่ apply ซ้ำจะข้ามบัญชีที่มีแล้ว

รายการที่ขาดตอน audit: 000029 ปกครองอำเภอเมืองศรีสะเกษ, 000030 ท้องถิ่นจังหวัด, 000031 ปกครองโพธิ์ศรีสุวรรณ, 000032 แรงงานจังหวัดศรีสะเกษ ให้ยึดผล check ปัจจุบัน ส่งรหัสให้เจ้าของผ่านช่องทางส่วนตัว แล้วตรวจว่าเห็นเฉพาะหน่วยตน

## 5 ตรวจและปรับบัญชี MENTOR

คัดลอก examples/reviewer-reconciliation-example.json เป็น reviewer-reconciliation-2570.json ใน private directory ตัวอย่างมีเพียงสองคู่ที่ต้องตรวจ ไม่ใช่รายการแก้ครบ 24 คน และ identityConfirmed เริ่มเป็น false

ตรวจผู้ถือบัญชีจริงและการมอบหมายล่าสุด เติม username, expectedName, expectedTeam, name, team ก่อนตั้ง identityConfirmed=true เฉพาะคู่ที่ยืนยันแล้ว กรณีชื่อใหม่หรือคนแทนห้ามนำบัญชีคนเดิมไปให้คนใหม่หรือจับคู่ตามลำดับภาพ

```sh
php gecc-private/account-maintenance.php check-reviewers reviewer-reconciliation-2570.json
php gecc-private/account-maintenance.php apply-reviewers reviewer-reconciliation-2570.json REVISION
```

ปฏิเสธข้อมูลเดิมไม่ตรง ชื่อไม่อยู่ในกลุ่มปัจจุบัน บัญชีที่ไม่ใช่ mentor และชื่อซ้ำ ไม่เปลี่ยน role เป็น coord ไม่ reset รหัส/ID/ผลตรวจ และยกเลิก session ของบัญชีที่ปรับ ให้เข้าสู่ระบบใหม่และตรวจครบ 24 คน

## 6 เปิดบัญชีที่ปรึกษาแยก

ใช้ examples/advisor-grants-example.json ใน private directory ตรวจชื่อ สิทธิ์ team และ grantConfirmed ตาม RELEASE-ROSTER-2570-TH.md ไม่ใส่รหัสผ่านใน Git

```sh
php gecc-private/advisor-accounts.php prepare /PRIVATE/advisor-grants.json /PRIVATE/advisor-accounts.json
php gecc-private/advisor-accounts.php check /PRIVATE/advisor-accounts.json
php gecc-private/advisor-accounts.php apply /PRIVATE/advisor-accounts.json REVISION
```

ตามการมอบหมายที่บันทึกในคู่มือ มัลลิกา/กนกวิภาเป็น coord ที่ปรึกษาอีกสี่คนเป็น mentor team=0 ตรวจทุกกลุ่ม ผู้ดูแลต้องตรวจรับการมอบหมายก่อนยืนยัน grants ไม่เปลี่ยนสิทธิ์บัญชี MENTOR กลุ่ม 1–6 เดิมอัตโนมัติ

## 7 ตั้งแบบสำรวจและตรวจรับ

ผู้ประสานงานเข้า จัดการข้อมูล → จัดการ Gallery และเนื้อหาเผยแพร่ → ลิงก์แบบสำรวจความพึงพอใจผู้รับบริการ ใส่ HTTPS URL จริงแล้วบันทึก หากยังไม่ใส่ ปุ่มสาธารณะยังขึ้นรอยืนยันตามจริง

ทดสอบหน้าแรก Library Gallery รูป/วิดีโอ และล็อกอินบัญชีใหม่ทุกกลุ่ม ใน staging ให้ครบ ส่งข้อมูล → ตรวจ → ส่งกลับ → แก้ → ตรวจซ้ำ → ยืนยันล็อก → เปิดใหม่พร้อมเหตุผล รวม save/reload, รูป/PDF, สองผู้ใช้พร้อมกัน และ backup/restore

รัน account-maintenance.php check ซ้ำ รายการที่ขาดต้องว่างตามขอบเขตที่อนุมัติ เครื่องพัฒนาใช้ npm run check:production ตรวจ smoke ได้ หากโฮสต์ส่ง HTML challenge ให้ถือว่ายังตรวจไม่ได้ ไม่ถือ HTTP 200 อย่างเดียวว่าผ่าน

## ย้อนกลับ

คืนชุดเว็บ/PHP จาก backup เดียวกันโดยรักษาข้อมูล/ไฟล์จริง ไม่ import seed เครื่องมือบัญชีไม่ reset รหัสเดิมและบันทึก audit การย้อนกลุ่มใช้ manifest ใหม่ที่ระบุ expectedName/expectedTeam ปัจจุบันแล้วตรวจยืนยันอีกครั้ง ไม่กู้ DB เก่าทับงานใหม่โดยไม่ตรวจข้อมูลหลัง backup

รอบนี้ยังไม่ deploy หรือเปลี่ยนบัญชี Production ผลทดสอบและข้อจำกัดอยู่ใน docs/audit-remediation-2026-11-01.md ไม่ใช่การรับรองว่าไม่มีบัก 100%
