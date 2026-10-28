# ติดตั้ง GECC บน Apache / PHP 8.3 / MariaDB 10.6

คู่มือนี้ตรงกับโฮสต์ที่ยืนยันแล้ว ไม่ต้องมี Node.js, Docker หรือ PostgreSQL บนโฮสต์
Node ใช้เฉพาะเครื่องพัฒนาที่จัดชุดไฟล์ก่อนอัปโหลดเท่านั้น

## 1. Commit / push แล้วจัดชุดไฟล์บนอีกเครื่อง

commit โค้ดใน assets, php, php-public, deploy, tests และเอกสารให้ครบ
แยก Conventional Commits เช่น feat(php), test(php), docs(deploy)
ตรวจ git status และ git diff --cached --stat ก่อน push สาขางานปัจจุบันคือ
codex/production-readiness ไม่เพิ่ม var/, .env, config.local.php หรือไฟล์บัญชี

บนอีกเครื่อง:

    git clone --branch codex/production-readiness https://github.com/kanokwipha-RX/GECC-websiteGEN1.git
    cd GECC-websiteGEN1
    node deploy/build-php.mjs --zip

ถ้า clone แล้ว ให้ตรวจงานค้าง จากนั้น switch สาขาเดียวกันและ git pull --ff-only
ถ้ารวมเข้า main แล้ว ใช้ main ทั้งสองเครื่อง Windows ใช้ tar ที่มากับระบบ
Linux ต้องมีคำสั่ง zip สคริปต์จะแสดงตำแหน่ง ZIP และโฟลเดอร์ใน var/releases/
ไม่ทับ release เดิม และไม่รวมข้อมูลจริงหรือไฟล์บัญชีเดิมจากเครื่องพัฒนา

ZIP มีรหัสติดตั้งในส่วน private จึงเป็นไฟล์สำหรับผู้ดูแล ห้ามนำขึ้น GitHub
หรือวาง ZIP ทั้งก้อนใน public_html

## 2. แยกโฟลเดอร์ public และ private

ใช้ File Manager/SFTP ของโฮสต์วางตามนี้:

    /home/ACCOUNT/public_html/sskgecc/   <- เนื้อหาข้างใน public/
    /home/ACCOUNT/gecc-private/         <- โฟลเดอร์ gecc-private/

ไม่อัปโหลด repository ทั้งชุดเป็นเว็บไซต์ ไม่วาง gecc-private ภายใน public_html
ถ้าโครงสร้างต่างจากตัวอย่าง แก้ public/api/private-path.php ให้คืน absolute path
ของ gecc-private ไฟล์นี้เก็บเฉพาะเส้นทาง ไม่เก็บรหัสผ่าน
ส่วน private มี .htaccess ปฏิเสธการเข้าถึงเพิ่ม แต่ไม่ใช้แทนการแยกโฟลเดอร์จริง

ให้ PHP อ่าน code/config และเขียนใน gecc-private เพื่อสร้าง accounts.json,
installed.lock และ files/ ได้ โฟลเดอร์ส่วนตัวควรเป็น 700 และไฟล์ลับ 600
โดยเจ้าของต้องเป็นผู้ใช้ที่รัน PHP ห้ามแก้เป็น 777 เพื่อข้ามปัญหาสิทธิ์
หากไม่มีพื้นที่ส่วนตัวนอกเว็บ ให้ทีมโฮสต์จัดให้ก่อน

## 3. ตั้งฐานข้อมูล MariaDB

แนะนำฐานข้อมูล GECC แยกจากเว็บอื่น สำรองข้อมูลเดิมก่อน ไม่ต้องเปลี่ยน charset
ทั้งฐานข้อมูลเดิมจาก utf8mb3 ตาราง GECC ใหม่ระบุ utf8mb4 เองทุกตาราง

คัดลอก gecc-private/config.example.php เป็น config.local.php ในโฟลเดอร์เดียวกัน
แล้วกรอกค่าจากโฮสต์ เฉพาะในไฟล์ส่วนตัว:

    'dsn' => 'mysql:host=localhost;dbname=ชื่อฐานข้อมูล;charset=utf8mb4',
    'db_user' => 'ผู้ใช้ฐานข้อมูลของแอป',
    'db_password' => 'กรอกในไฟล์ส่วนตัวเท่านั้น',
    'origin' => 'https://www.osscsskfda.org',
    'base_path' => '/sskgecc',
    'secure_cookie' => true,

ต้องมี PDO MySQL, mbstring และ Argon2id ใน PHP 8.3 ไม่มี secrets ใน JavaScript/Git
Origin ใช้เฉพาะโดเมน ส่วน /sskgecc อยู่ใน base_path

SQL สำหรับ phpMyAdmin อยู่ที่ gecc-private/schema.sql มี 7 ตาราง:

| ตาราง | จัดเก็บ |
|---|---|
| gecc_app_state | ข้อมูลประเมินรูปแบบเดิมและ revision |
| gecc_accounts | บัญชี password hash และสิทธิ์ |
| gecc_sessions | token hash, CSRF และวันหมดอายุ |
| gecc_files | metadata/เจ้าของ/ขนาด/SHA-256 ของไฟล์แนบ |
| gecc_audit | ประวัติเหตุการณ์จากผู้ใช้ที่ยืนยันตัวตน |
| gecc_login_attempts | จำกัดการลองรหัสผ่านระหว่าง PHP requests |
| gecc_schema_version | รุ่นโครงสร้างฐานข้อมูล |

เลือกได้สองทาง:

- ให้ตัวติดตั้งสร้างตาราง: ใช้ schema_preinstalled => false และผู้ใช้ DB ต้องมี CREATE
- import schema.sql ผ่าน phpMyAdmin ก่อน: ตั้ง schema_preinstalled => true
  ตัวติดตั้งจะตรวจตารางและสร้างข้อมูล/บัญชีโดยไม่รัน CREATE TABLE

ผู้ใช้แอปต้องมี SELECT/INSERT/UPDATE/DELETE สำหรับตาราง GECC
SQL รุ่นแรกสร้างเฉพาะตารางที่ยังไม่มี ไม่ ALTER ตารางเดิมที่โครงสร้างต่างกัน
ไม่ใช่เครื่องมือแปลง PostgreSQL หรือรวมฐานข้อมูลหลายระบบอัตโนมัติ

## 4. ติดตั้งอัตโนมัติ — มีหรือไม่มี SSH ก็ได้

ถ้ามี SSH/PHP CLI:

    php /home/ACCOUNT/gecc-private/manage.php check
    php /home/ACCOUNT/gecc-private/manage.php install --apply

หากไม่มี SSH ใช้หน้าเว็บ:

1. ตั้ง allow_web_setup => true ใน config.local.php ชั่วคราว คง setup_token_hash
   ที่ build ใส่มาให้ ไม่ใช้ค่า BUILD_INSERTS_TOKEN_HASH แทนรหัสจริง
2. เปิด https://www.osscsskfda.org/sskgecc/setup.html ผ่าน HTTPS
3. ใส่รหัสจากไฟล์ส่วนตัว setup-token.txt แล้วกดเตรียมระบบ ไม่ใช่รหัสผ่านฐานข้อมูล
   ไม่ส่งรหัสนี้ใน URL หรือแชต
4. รอสำเร็จ ระบบสร้าง installed.lock เพื่อปิดการติดตั้งผ่านเว็บ
5. ตั้ง allow_web_setup => false และลบ public/setup.html หลังใช้

ตัวติดตั้งใช้ named lock ป้องกันการรันซ้อน การสร้างบัญชีเป็น transaction
รันซ้ำไม่ทับบัญชี/รหัสผ่านเดิม แต่ DDL ของ MariaDB ไม่ rollback ตาม transaction
หากหยุดกลางทางอาจมีตารางที่สร้างแล้ว ให้แก้สาเหตุแล้วลองใหม่ ไม่ลบตารางเพื่อเริ่มใหม่
หาก host timeout ให้ทีมตรวจ log ส่วนตัวและ max_execution_time ก่อนกดซ้ำ
ถ้ามี HTTPS proxy ให้ทีมส่งสถานะ HTTPS เข้า PHP อย่างถูกต้อง ไม่ปิด secure_cookie

## 5. รับและแจกบัญชี 54 บัญชี

รหัสผ่านจะอยู่ใน gecc-private/accounts.json เท่านั้น: หน่วยบริการ 000001–000028,
MENTOR 24 คน และผู้ประสานงาน coord-01/coord-02 ทุกบัญชีต้องเปลี่ยนรหัสผ่านครั้งแรก
ฐานข้อมูลเก็บ Argon2id hash ไม่เก็บรหัสผ่านเป็นข้อความ
แจกเฉพาะบัญชีของผู้รับแต่ละรายผ่านช่องทางส่วนตัว ไม่เผยแพร่ไฟล์รวม

ถ้าต้องการรหัสชุดเดิมจากเครื่องพัฒนา ให้ย้าย var/private/accounts.json ไปเป็น
gecc-private/accounts.json ก่อนติดตั้ง ผ่านช่องทางส่วนตัว ตัวติดตั้งจะตรวจชื่อ/สิทธิ์
บัญชีที่มีอยู่แล้วรายงาน skipped และคงรหัสเดิม ไม่ใช้รหัสในไฟล์ชุดใหม่

## 6. ตรวจ staging ก่อนสลับเว็บจริง

API ที่ /sskgecc/api/index.php?route=health ต้องได้ {"ok":true}
PHP ใช้ query route จึงไม่ต้องตั้ง Node reverse proxy หรือ mod_rewrite

- ทดสอบล็อกอินสามบทบาท เปลี่ยนรหัสผ่าน ปิดบัญชีแล้ว session เดิมใช้ไม่ได้
- บันทึก/โหลดใหม่ สูตรคะแนน ประวัติและเวลาประเทศไทย
- เข้าถึงข้ามหน่วย/กลุ่มไม่ได้ และไฟล์แนบต้องตรวจสิทธิ์
- SQL/config/ไฟล์ส่วนตัวต้องดาวน์โหลดผ่านเว็บไม่ได้
- ทดสอบ POST/PUT/PATCH/DELETE ถ้า host บล็อกให้ทีมปรับเฉพาะเส้นทาง API
- ตรวจมือถือ/เดสก์ท็อป คีย์บอร์ด โหมดสว่าง/มืด และการเชื่อมต่อขัดข้อง
- สำรอง MariaDB พร้อม files/ อย่างสอดคล้องกัน และทดสอบกู้คืนในระบบแยก

ข้อมูลจริงในเบราว์เซอร์เดิมต้องส่งออกพร้อมไฟล์แนบและตรวจแยกข้อมูลสาธิตก่อนนำเข้า
ระบบปฏิเสธการแทนที่ผลประเมินที่มีอยู่แล้ว ไม่ย้าย Node password hash ไปใช้ตรง ๆ

## ขอบเขตการรับรอง

ทดสอบ PHP 8.3.36 และ MariaDB 10.6.28 แยกในเครื่องพัฒนา ยังต้องตรวจ Apache/LVE,
TLS/HTTPS flag, filesystem owner, request/time limits และ backup/restore บนโฮสต์จริง
ไม่มีการอัปโหลดไฟล์หรือเปลี่ยนฐานข้อมูลจริงจากงานพัฒนานี้
