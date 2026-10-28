# สรุปข้อมูลการแก้ไขและการ Deploy ระบบ GECC Sisaket 2570 ขึ้นโปรดักชัน

เอกสารฉบับนี้สรุปรายการแก้ไข การตั้งค่า และรูปแบบสถาปัตยกรรมการนำระบบ **SISAKET GECC PROJECT 2570** ขึ้นสู่เซิร์ฟเวอร์โปรดักชันจริง

---

## 1. ข้อมูลระบบและสถานะการ Deploy จริง

* **เว็บไซต์ใช้งานจริง (Production URL):** [https://www.osscsskfda.org/sskgecc/](https://www.osscsskfda.org/sskgecc/)
* **เซิร์ฟเวอร์โฮสติ้ง:** Linux / Apache Web Server (DirectAdmin)
* **เวอร์ชัน PHP:** PHP 8.3.36 (พร้อมโมดูล `pdo_mysql`, `mbstring`, และ `argon2id`)
* **ฐานข้อมูล:** MariaDB 10.6.28 (`osscsskf_gpp_audit`)
* **สิทธิ์การเข้าถึง API:** HTTPS Only, Same-Origin Protection (รองรับทั้ง `osscsskfda.org` และ `www.osscsskfda.org`)

---

## 2. รายการแก้ไขและพัฒนาทั้งหมด (Changelog)

### ก. การพัฒนา Native PHP 8.3 Backend & MariaDB
1. **ย้ายจาก Node.js/PostgreSQL มาเป็น PHP/MariaDB:**
   * พัฒนาระบบ API ด้วย PHP 8.3 เพื่อให้สามารถรันบน Shared Web Hosting ของหน่วยงานได้โดยตรง โดยไม่ต้องพึ่งพา Docker Engine หรือ Node.js daemon
   * ออกแบบตารางใน MariaDB ทั้ง 7 ตารางพร้อมใส่ prefix `gecc_` เพื่อให้สามารถใช้งานร่วมกับฐานข้อมูลเดิมของหน่วยงานได้โดยไม่ทับซ้อนกับระบบอื่น
2. **โครงสร้างตารางทั้ง 7 ตาราง:**
   * `gecc_app_state`: ข้อมูลการประเมิน, 28 หน่วยบริการ, 6 กลุ่ม Mentor, และเนื้อหาสาธารณะ (JSON UTF-8)
   * `gecc_accounts`: ทะเบียนบัญชีผู้ใช้ (Hash ด้วย Argon2id)
   * `gecc_sessions`: จัดการเซสชันและระบบป้องกัน CSRF Token
   * `gecc_files`: ทะเบียนเมทาดาตาไฟล์แนบ
   * `gecc_audit`: ประวัติการทำรายการแบบ Append-only
   * `gecc_login_attempts`: ระบบ Rate-limiting ป้องกัน Brute-force Login
   * `gecc_schema_version`: หมายเลขรุ่นโครงสร้างฐานข้อมูล

### ข. การแก้ปัญหา Encoding และภาษาไทย (Data Integrity)
1. **แก้ไข Encoding ภาษาไทย:**
   * ตรวจพบไฟล์ข้อมูลตั้งต้นเดิม (`sisaket-gecc-2570-units-28.json`, `php/data/seed.json`, `php/data/criteria.json`) มีการเข้ารหัสแบบ Windows-874 / TIS-620
   * แปลงและทำความสะอาดเป็น **UTF-8 (No BOM)** ทำให้ชื่อหน่วยบริการ 28 แห่ง, รายนามคณะทำงาน, และเกณฑ์ประเมิน แสดงผลถูกต้อง 100% ไม่เป็นภาษาต่างดาว
2. **แก้ไขปัญหา UTF-8 BOM ใน PHP:**
   * แก้ไขไฟล์คอนฟิก `config.local.php` และ `private-path.php` ให้ไม่มี UTF-8 BOM ป้องกันข้อผิดพลาด `Fatal error: strict_types declaration must be the very first statement`

### ค. การปรับปรุง Frontend & UI
1. **นำข้อความแจ้งเตือนโหมดออฟไลน์ออก:**
   * นำข้อความแจ้งเตือน *"โหมดในเครื่อง · ข้อมูลและไฟล์แนบเก็บในเบราว์เซอร์นี้เท่านั้น"* และ *"โหมดสาธิตในเครื่อง"* ออกจาก `assets/server-client.js`
2. **ตั้งค่า Production Runtime เป็นค่าเริ่มต้น:**
   * กำหนดใน `assets/runtime.js` ให้ `window.GECC_SERVER = true;` และ `window.GECC_API_STYLE = "php";` เพื่อเชื่อมต่อไปยัง backend API โดยอัตโนมัติ

### ง. การรักษาความปลอดภัยและการรองรับโดเมน (Security & Routing)
1. **รองรับ Apex Domain และ WWW Subdomain:**
   * ปรับปรุงการตรวจสอบ Header `Origin` ใน `php/api.php` ให้ยอมรับทั้ง `https://osscsskfda.org` และ `https://www.osscsskfda.org` เพื่อรองรับ 301 Canonical Redirect ของ Apache
2. **ระบบค้นหาเส้นทาง Private Path แบบ Dynamic:**
   * ปรับปรุง `php-public/api/private-path.php` ให้ค้นหาโฟลเดอร์ส่วนตัวได้ทั้งใน DirectAdmin (`/domains/osscsskfda.org/`) และโครงสร้างพาธ cPanel ปกติ

---

## 3. รูปแบบสถาปัตยกรรมการ Deploy บนเซิร์ฟเวอร์จริง

```
/home/osscsskf/
│
├── gecc-private/                      <-- [พื้นที่ปลอดภัยภายนอก Web Root]
│   ├── config.local.php               <-- รหัสผ่านฐานข้อมูล (สิทธิ์ 600)
│   ├── bootstrap.php                  <-- Initializer และ Error Handler
│   ├── api.php                        <-- REST API Routing & Handlers
│   ├── policy.php                     <-- Domain Authorization & Scoring
│   ├── install.php                    <-- Database Schema & Provisioning
│   ├── schema.sql                     <-- MariaDB DDL
│   ├── data/                          <-- seed.json & criteria.json (UTF-8)
│   ├── files/                         <-- ไฟล์แนบของหน่วยบริการ (เข้าถึงตรงจากเว็บไม่ได้)
│   ├── accounts.json                  <-- บัญชีและรหัสผ่านเริ่มต้น (เก็บเป็นความลับ)
│   └── installed.lock                 <-- ล็อกปิดการติดตั้งซ้ำ
│
└── public_html/                       <-- [พื้นที่เปิดเผยสาธารณะผ่าน Apache]
    └── sskgecc/
        ├── index.html                 <-- หน้าเว็บหลัก SPA
        ├── assets/                    <-- CSS, JS, Runtime, รูปภาพ
        ├── shared/                    <-- โมดูล Shared
        ├── api/
        │   ├── index.php              <-- API Router เดียว (เชื่อมต่อไป gecc-private)
        │   └── private-path.php       <-- ตัวชี้ตำแหน่งโฟลเดอร์ gecc-private
        └── .htaccess                  <-- กำหนด Header ความปลอดภัย
```

### จุดเด่นด้านความปลอดภัยของสถาปัตยกรรมนี้:
* **Zero Secret in Web Root:** ไม่มีรหัสผ่านฐานข้อมูล, ไม่มีไฟล์บัญชี, และไม่มีไฟล์แนบเอกสาร อยู่ในพื้นที่ที่สามารถดาวน์โหลดได้จากเว็บโดยตรง
* **Scoped Access Control:**
  * **Guest:** ดูได้เฉพาะหน้าหลัก, สรุปคะแนนภาพรวม, คณะทำงาน และเอกสาร Library
  * **Mentee:** เข้าถึงเฉพาะข้อมูลและแบบประเมินของหน่วยบริการตนเอง (1 หน่วย)
  * **Mentor:** เข้าถึงเฉพาะกลุ่มหน่วยบริการที่ได้รับมอบหมาย (4–5 หน่วย)
  * **Coordinator:** เข้าถึงข้อมูลได้ทุกกลุ่มและมีสิทธิ์เปิด/ล็อกผลการประเมิน
* **Post-Installation Hardening:** ปิดสิทธิ์ `allow_web_setup = false` และลบสคริปต์ติดตั้งหน้าเว็บทิ้งทั้งหมดหลังเสร็จสิ้นกระบวนการ

---

## 4. บัญชีผู้ใช้งานระบบ (Accounts Summary)

ระบบได้ทำการสร้างบัญชีผู้ใช้งานทั้งสิ้น **54 บัญชี** โดยรหัสผ่านเริ่มต้นถูกจัดเก็บไว้อย่างปลอดภัยในเครื่องของผู้ดูแลที่ `accounts.json` (และถูกระบุใน `.gitignore` ไม่ถูกนำขึ้น GitHub):

* **Coordinator (ผู้ประสานงานจังหวัด 2 บัญชี):** `coord-01` (ภญ.มัลลิกา สุพล), `coord-02` (ภญ.กนกวิภา ประกอบศรี)
* **Mentor Leads (หัวหน้ากลุ่ม MENTOR 6 บัญชี):** `mentor-01-01` ถึง `mentor-06-01`
* **Mentor Members (ผู้ตรวจประเมิน 18 บัญชี):** สมาชิกในแต่ละกลุ่ม MENTOR
* **Mentee (หน่วยบริการ 28 บัญชี):** รหัสประจำตัว GECC 6 หลัก `000001` ถึง `000028`
