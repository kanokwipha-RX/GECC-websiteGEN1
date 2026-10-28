# แผนปรับ backend ให้ตรงโฮสต์ Apache/PHP

อัปเดต: ยืนยัน PHP 8.3.36 + MariaDB 10.6.28 แล้ว มี PHP backend ใน php/,
ตัวติดตั้ง CLI/เว็บ และ SQL ที่ทดสอบกับ MariaDB รุ่นเดียวกัน
คู่มือใช้งานปัจจุบันคือ PHP-DEPLOYMENT-TH.md รายละเอียดแผนเดิมด้านล่างเก็บไว้
เพื่อเทียบข้อกำหนด การติดตั้งบนโฮสต์จริงยังต้องตรวจ staging ก่อนสลับใช้งาน

## ข้อเท็จจริงที่ยืนยันแล้ว

- ผู้ดูแลยืนยันว่าโฮสต์ใช้ Apache/PHP เท่านั้น
- PHP ที่แจ้งคือ 8.3.36
- เว็บอยู่ที่ https://www.osscsskfda.org/sskgecc/
- ยังต้องยืนยันว่าใช้ MySQL หรือ MariaDB พร้อมเวอร์ชัน และ PDO driver ที่เปิดใช้
- backend ที่มีอยู่ใน repository ตอนนี้เป็น Node.js/PostgreSQL ยังไม่ใช่ PHP
- สคริปต์ deploy/production.sh เป็นของระบบ Node/Docker จึงไม่ใช่วิธีติดตั้ง
  สำหรับโฮสต์นี้ ห้ามนำ SQL PostgreSQL เดิมไป import ใน phpMyAdmin

เอกสารนี้เป็นแผนเปลี่ยนระบบ ยังไม่ใช่การรับรองว่ามี PHP backend พร้อมติดตั้งแล้ว

## ส่วนที่คงเดิม

หน้าเว็บ HTML/CSS/JavaScript ฟอนต์ไทย อัตลักษณ์และหน้าทั้งหมดคงเดิม
คงรหัสหน่วยบริการ 000001–000028 บัญชี MENTOR รายบุคคล 24 และผู้ประสานงาน 2
คง JSON assessment เดิม สูตรคะแนน เกณฑ์ผ่าน การส่งตรวจ/ส่งกลับ/ล็อก/เปิดแก้ไข
และขอบเขตสิทธิ์เดิม ไม่ย้ายการตรวจสิทธิ์หรือการยืนยันคะแนนไปไว้ที่เบราว์เซอร์

รหัสผ่านชั่วคราวที่เตรียมไว้ใน var/private/accounts.json สามารถใช้เป็นข้อมูล
นำเข้าบัญชีได้เมื่อมีตัวติดตั้ง PHP ที่ตรวจสอบแล้ว ไฟล์นี้ยังไม่ใช่บัญชีที่ถูกสร้าง
ลงฐานข้อมูล และต้องเก็บนอกพื้นที่เว็บ/นอก Git เหมือนเดิม

## สถาปัตยกรรมเป้าหมาย

เบราว์เซอร์ -> Apache HTTPS /sskgecc/ -> PHP API -> PDO -> ฐานข้อมูลของโฮสต์
ไฟล์แนบและค่าตั้งฐานข้อมูลอยู่ในโฟลเดอร์ส่วนตัวนอก document root

คง request/response contract ใน API.md: session, password, state, summary,
workflow, files, accounts, audit, import และ admin/reset ต้องย้ายครบก่อนสลับจริง
ถ้าโฮสต์อนุญาต rewrite จะรักษา /sskgecc/api/...; หากไม่อนุญาตจะเตรียม
front controller แบบ query route โดยเปลี่ยนจุดสร้าง URL ร่วมใน client เพียงจุดเดียว
ต้องทดสอบทั้งหน้าเว็บ API และไฟล์แนบใต้ subdirectory

PHP ต้องใช้ prepared statements และ transaction ของ PDO พร้อม optimistic
revision และ row lock ของ InnoDB; schema จริงต้องตรงกับ MySQL/MariaDB ที่ยืนยัน
ก่อน ไม่แปลงชนิด JSONB และคำสั่ง PostgreSQL ไปใช้ตรง ๆ

## ข้อมูลและความปลอดภัยที่ต้องย้าย

1. app_state: JSON รูปแบบเดิม + revision ห้ามสร้างคะแนนเดโมหรืออ่านข้อมูลจาก
   browser เป็นฐานข้อมูลจริงอัตโนมัติ
2. accounts: username เฉพาะ, password hash, role, unit/group scope, active,
   must_change พร้อมการปิดบัญชีและตั้งรหัสผ่านใหม่ที่เพิกถอน session เดิม
3. sessions: เก็บ token hash, CSRF token และอายุ session; cookie Secure,
   HttpOnly, SameSite และ Path ของ /sskgecc/ ตรวจ Origin/CSRF ฝั่ง PHP
4. files: metadata, เจ้าของ, หน่วยบริการ, SHA-256 และขนาด; binary อยู่ข้างนอกเว็บ
   ดาวน์โหลดผ่านการตรวจสิทธิ์ทุกครั้ง ไม่ใช้ URL ตรงไปยังไฟล์
5. audit: ผู้กระทำ เหตุการณ์ ทรัพยากร revision และเวลาที่เซิร์ฟเวอร์สร้าง
6. login_attempts: จำกัดการลองรหัสผ่านแบบเก็บกลาง เพราะ PHP แต่ละ request
   ไม่ใช้ตัวแปรหน่วยความจำร่วมกันแบบ Node process เดิม

ต้องเลือกรูปแบบ password hash จากความสามารถจริงของ PHP เพื่อไม่ให้เกิดปัญหา
รหัสผ่านยาวถูกตัด และทดสอบนโยบายรหัสผ่านเดิมก่อนรับรอง ไม่ย้าย scrypt hash
ของ Node ไปใช้ password_verify โดยตรง ไม่ส่ง password/hash กลับใน API

## ลำดับพัฒนาและเงื่อนไขผ่าน

1. ยืนยันชนิด/เวอร์ชัน DB, PDO driver, สิทธิ์สร้างตาราง, private storage,
   rewrite และการเข้าถึง PHP CLI/SSH หรือมีเพียงหน้า control panel/FTP
2. เตรียม SQL และตัวติดตั้งเฉพาะ PHP พร้อมตัวตรวจความพร้อมที่ไม่แสดง secrets
   หากต้องมีขั้นตอนติดตั้งผ่านเว็บ ต้องป้องกันด้วย token ครั้งเดียวและปิดหลังใช้
   ไม่เปิด endpoint สร้างผู้ดูแล/เปลี่ยน schema ให้บุคคลทั่วไปเรียกได้
3. ย้ายสูตรคะแนนและการสรุปผลไป PHP แล้วเทียบผลกับ shared/criteria.js
   อย่างน้อย 300 ชุด รวมขอบเขต 240/260/280 และเกณฑ์กายภาพ
4. ย้าย authorization/validation/workflow ให้ครบทุก endpoint แล้วทดสอบ
   anonymous, wrong role, wrong unit/group, CSRF, stale revision, locked results,
   session expiry, disabled account, first-login และ repeated login attempts
5. ทดสอบการสร้างบัญชีครบ 54 บัญชีแบบ dry-run/apply; รันซ้ำต้องไม่ทับรหัสผ่าน
   หรือข้อมูลจริง ทดสอบ rollback เมื่อสร้างบัญชีล้มเหลวกลาง transaction
6. ทดสอบแนบ/ดาวน์โหลดไฟล์, import/backup พร้อมตรวจ hash, บันทึก/โหลดใหม่,
   การตัดการเชื่อมต่อ, หน้าจอมือถือ/เดสก์ท็อป, คีย์บอร์ด และ accessibility
7. สร้างแพ็กเกจที่แยก public assets/PHP entry point ออกจาก private config,
   SQL, credentials, test data และไฟล์แนบ พร้อมคู่มือ Git -> upload -> initialize
8. ทดสอบบน staging ของ Apache/PHP และฐานข้อมูลรุ่นเดียวกับโฮสต์ก่อนสลับจริง
   สำรองข้อมูลเดิมและทดสอบกู้คืน ห้ามอ้างผลทดสอบ Node ว่าเป็นผลทดสอบ PHP

## ข้อจำกัดปัจจุบัน

ยังไม่ทราบชนิด/เวอร์ชัน DB และข้อจำกัด control panel จึงยังออก SQL และคำสั่ง
ติดตั้งฉบับสุดท้ายไม่ได้ ผลทดสอบ 31+ ของ backend และ browser ที่ทำไว้ก่อนหน้า
เป็นฐานเทียบพฤติกรรมของ Node ไม่ใช่ผลรับรอง PHP backend
ไม่มีการติดตั้ง เปลี่ยน schema หรือนำเข้าบัญชี/ข้อมูลลงโฮสต์จริงในขั้นตอนนี้
