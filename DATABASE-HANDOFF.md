# เอกสารส่งต่องานฐานข้อมูล GECC Sisaket 2570

เป้าหมายที่ผู้ดูแลยืนยัน: PHP 8.3.36 + MariaDB 10.6.28
ใช้ php/schema.sql ผ่าน phpMyAdmin หรือตัวติดตั้ง PHP ตาม PHP-DEPLOYMENT-TH.md
ผลทดสอบในเครื่องแยกไม่ใช่การยืนยันว่าฐานข้อมูลบนโฮสต์จริงถูกสร้างแล้ว

## ตารางจริงของ PHP backend

มี 7 ตาราง 37 คอลัมน์ ใช้ InnoDB และ utf8mb4 โดยไม่ ALTER charset ฐานข้อมูลเดิม

| ตาราง | คอลัมน์ | หน้าที่ |
|---|---|---|
| gecc_app_state | id, revision, document, updated_at | JSON ข้อมูลธุรกิจเดิมและรุ่นการแก้ไข |
| gecc_accounts | id, username, name, password_hash, role, unit_id, team, active, must_change, created_at | บัญชีและสิทธิ์ |
| gecc_sessions | token_hash, account_id, csrf, expires_at | session ที่เพิกถอนได้และ CSRF |
| gecc_files | id, unit_id, account_id, name, mime, size, digest, created_at | metadata ของไฟล์ส่วนตัว |
| gecc_audit | id, account_id, action, resource, revision, created_at | ประวัติเหตุการณ์ที่เซิร์ฟเวอร์สร้าง |
| gecc_login_attempts | key_hash, attempts, reset_at | จำกัดการลองรหัสผ่านข้าม PHP requests |
| gecc_schema_version | version, applied_at | schema รุ่นเริ่มต้น |

SQL มี primary key, unique username, foreign key ของ account_id, CHECK ของ JSON,
scope บัญชีและขนาดไฟล์ รวม index สำหรับหน่วยบริการ/เวลา/session หมดอายุ
username ใช้ utf8mb4_bin เพื่อคงการแยกตัวพิมพ์เล็กใหญ่ รหัส ID/hash ใช้ ASCII

document ใช้ LONGTEXT พร้อม JSON_VALID ไม่ใช้ JSONB ของ PostgreSQL
เป็นโครงสร้าง JSON เดิมเพื่อรักษากฎการประเมิน ไม่ใช่การแยกทุก field เป็นตารางใหม่
unit_id และ team อ้างอิงหน่วย/กลุ่มใน JSON จึงตรวจความสัมพันธ์ที่ PHP API
ไม่ใช่ foreign key ไปตาราง units/teams และไม่มีฐานข้อมูล RLS

## ภายใน document

เก็บ units[], teams[], mentorCoordinators[], fy, cal, publicContent,
nextUnitCode, retiredUnitIds, assess[unitId] และ defects[]
ผลประเมินเดิมมี phys, qc, narr, out, ready, survey, ev, rev, adv, quick, wf
รวมผู้ตรวจ ข้อมูลผู้ส่งและประวัติการส่ง/ตรวจตามรูปแบบเดิม
ไฟล์ binary ไม่อยู่ใน document หรือฐานข้อมูล เก็บใน gecc-private/files/
ดาวน์โหลดผ่าน PHP ที่ตรวจสิทธิ์ตามหน่วย/กลุ่มเท่านั้น

อัปเดตข้อมูลด้วย transaction + SELECT FOR UPDATE และตรวจ revision
หากมีผู้ใช้อื่นบันทึกก่อน จะคืน 409 และไม่ทับข้อมูลใหม่ การแก้ไขพร้อมกันต่างหน่วย
อาจต้องโหลดใหม่เพราะใช้ revision กลางเดียวกันตามสถาปัตยกรรมเดิม

## การเริ่มต้นและบัญชี

ตัวติดตั้งสร้างเฉพาะข้อมูลที่ยังขาด: หน่วยบริการ 28 แห่ง 6 กลุ่ม ไม่มีคะแนนเดโม
รหัสหน่วยบริการ 000001–000028 เป็น string ห้ามแปลงเป็นตัวเลขเพื่อตัดศูนย์นำหน้า
สร้าง MENTOR รายบุคคล 24 และผู้ประสานงาน 2 ตามรายชื่อเดิม รวม 54 บัญชี

รหัสผ่านสุ่ม 24 ตัวอักษรแยกกัน มีอยู่ใน accounts.json ส่วนตัวเพื่อแจกครั้งแรก
DB เก็บ Argon2id hash และ must_change=true ทุกบัญชีใหม่ ไม่มีรหัสผ่านเริ่มต้นร่วมกัน
ไม่ใช้ PIN เดโม ไม่ import scrypt hash จาก Node เป็น PHP hash โดยตรง
การปิดบัญชี/ตั้งรหัสใหม่ยกเลิก session เดิม บัญชีที่รันซ้ำแล้ว skipped คงรหัสเดิม

ถ้า import SQL ผ่าน phpMyAdmin แล้วและผู้ใช้แอปไม่มี CREATE ให้ตั้ง
schema_preinstalled=true ตัวติดตั้งตรวจตารางและสร้างข้อมูล/บัญชีด้วย DML
SQL รุ่นนี้เป็น additive initialization v1 ไม่ ALTER ตารางเดิมที่โครงสร้างต่างกัน
การทำ DDL ของ MariaDB ไม่ rollback ทั้งหมด การสร้างบัญชีเป็น transaction แยก
ไม่มีคำสั่ง DROP TABLE, ล้างข้อมูล หรือ merge ฐานข้อมูลที่มีผลประเมินแล้วโดยอัตโนมัติ

## เวลา สำรอง และการย้ายข้อมูล

connection ใช้ utf8mb4 และ timezone UTC เฉพาะ session ของแอป
audit/workflow ที่ออก API ใช้ ISO 8601 ลงท้าย Z หน้าเว็บแสดงเวลาประเทศไทย
ไม่เปลี่ยน timezone หรือ charset global ของเซิร์ฟเวอร์/แอปอื่น

สำรอง MariaDB และ files/ ให้เป็นชุดที่สอดคล้องกัน เก็บนอกโฮสต์อย่างเป็นส่วนตัว
bundle ที่ส่งออกจากหน้าเว็บรวมผลประเมิน/ไฟล์แนบและ SHA-256 แต่ไม่รวมบัญชี,
password hashes และ sessions จึงไม่ทดแทน DB backup
การ import ต้อง target ว่าง ไฟล์ครบ หน่วยตรงกัน และจำแนกข้อมูลสาธิตก่อน
ต้องทดสอบ restore แยกจริงก่อนรับรองขั้นตอนสำรอง

audit เป็น append-only ตามเส้นทางของแอป ไม่ได้ป้องกัน DBA เปลี่ยนข้อมูล
ยังไม่ purge orphan files หรือกำหนด retention อัตโนมัติ รอข้อกำหนดหน่วยงาน
ต้องยืนยัน PHP extensions, สิทธิ์โฟลเดอร์, Apache/HTTPS, ข้อจำกัด LVE/request
และ backup/restore บนโฮสต์จริงก่อนเปิดใช้งาน
