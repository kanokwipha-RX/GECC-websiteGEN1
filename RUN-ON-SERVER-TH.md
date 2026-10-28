# วิธีนำ GECC ไปรันบนอีกเครื่อง / เซิร์ฟเวอร์จริง

> อัปเดต: โฮสต์จริงยืนยัน Apache/PHP 8.3.36 เท่านั้น คู่มือนี้เป็นของ
> Node/Docker จึงไม่ตรงกับโฮสต์นี้ ให้ใช้ PHP-HOSTING-PLAN-TH.md เป็นแผนปัจจุบัน
> คู่มือติดตั้งปัจจุบันคือ PHP-DEPLOYMENT-TH.md พร้อมตัวติดตั้ง PHP และ SQL MariaDB

## เลือกเครื่องให้ถูกก่อน

คำสั่งติดตั้งต้องรันผ่าน SSH **บนเซิร์ฟเวอร์ Linux ที่จะให้บริการเว็บ** และต้องมี
Docker Engine + Docker Compose v2 พร้อมสิทธิ์ใช้ Docker, OpenSSL และ flock
ไม่ใช่รันบนเครื่อง Windows ที่ใช้ส่งไฟล์ FTP อย่างเดียว

ถ้าโฮสต์มีเพียง PHP/MySQL/phpMyAdmin และไม่มี Docker หรือสิทธิ์ reverse proxy
สคริปต์นี้จะใช้เปิด backend ไม่ได้ ให้ส่ง HOSTING-HANDOFF-TH.md ให้ทีมโฮสต์ก่อน
ไม่ต้องนำ server/schema.sql ไปวางใน phpMyAdmin เพราะเป็น PostgreSQL

สคริปต์ไม่ติดตั้ง Docker ไม่ปรับ Apache อัตโนมัติ และไม่ลบข้อมูลเดิม
เปิดบริการเฉพาะ 127.0.0.1 เท่านั้น จนกว่าทีมโฮสต์จะตั้ง reverse proxy

## 1. Commit / push จากเครื่องพัฒนา

รันที่ D:\GECC Dev2 ตรวจรายการไฟล์ก่อน commit ให้ครบทั้งงาน production ก่อนหน้า
และสคริปต์รอบนี้ โดยแยกประเภทด้วย Conventional Commits เช่น

```powershell
git status --short
git add index.html assets server .env.example
git commit -m "feat(gecc): harden production runtime and provision scoped accounts"
git add .gitattributes compose.yaml deploy package.json
git commit -m "feat(deploy): automate GECC server initialization"
git add tests
git commit -m "test(gecc): verify production accounts and deployment flows"
git add *.md
git commit -m "docs(gecc): document server setup and hosting handoff"
git push -u origin codex/production-readiness
```

คำสั่งนี้อ้างถึงสาขาปัจจุบัน `codex/production-readiness` หากรวมเข้า main แล้ว
ให้ใช้ main ทั้งตอน push และตอน checkout ที่เครื่องปลายทาง
ตรวจ `git diff --cached --stat` ก่อนแต่ละ commit ได้ ไม่ควรมี .env หรือ var/private
ไฟล์รหัสผ่านและข้อมูลจริงถูก ignore และไม่เดินทางไปกับ Git

## 2. Clone / pull บนเซิร์ฟเวอร์ปลายทาง

ใช้โฟลเดอร์ส่วนตัวของบริการ เช่น ~/services ห้ามวาง repository ทั้งชุดใน
public_html, htdocs หรือโฟลเดอร์ที่ Apache เปิดให้ดาวน์โหลด เพราะมี source และไฟล์ลับ

```sh
mkdir -p ~/services
cd ~/services
git clone --branch codex/production-readiness https://github.com/kanokwipha-RX/GECC-websiteGEN1.git
cd GECC-websiteGEN1
bash deploy/production.sh check
```

หาก clone ไว้แล้ว ให้เข้าโฟลเดอร์เดิม ตรวจว่าไม่มีงานค้าง แล้วใช้

```sh
git status --short
git switch codex/production-readiness
git pull --ff-only
bash deploy/production.sh check
```

อย่า clone ซ้ำคนละโฟลเดอร์แล้วสลับรันไปมา โดยเฉพาะระบบที่มีฐานข้อมูลเดิม
หาก check ไม่ผ่าน ให้ส่งผลลัพธ์ที่ไม่มีรหัสผ่านให้ทีมโฮสต์แก้ความพร้อมก่อน

## 3. เตรียมและเริ่ม backend อัตโนมัติ

สำหรับติดตั้งครั้งแรก หลัง check ผ่าน:

```sh
bash deploy/production.sh init --apply
```

คำสั่งนี้ทำตามลำดับ:

1. ป้องกันรัน setup ซ้อนกัน และสร้าง .env แบบส่วนตัวหากยังไม่มี
2. สุ่มรหัสผ่าน PostgreSQL ให้เอง ไม่แสดงรหัสในหน้าจอ
3. Build image และรอให้ PostgreSQL พร้อม
4. สร้างตารางและรายการหน่วยบริการที่ยังไม่มี ไม่แทนที่ข้อมูลเดิม
5. สร้างไฟล์บัญชีส่วนตัวหากยังไม่มี ตรวจรายชื่อ/สิทธิ์ แล้วสร้างเฉพาะบัญชีที่ยังขาด
6. เริ่ม backend และรอ health check ผ่าน จากนั้นแสดงสถานะ container

ไม่มีการนำเข้าคะแนนเดโมหรือข้อมูลจริงอัตโนมัติ ไม่มีคำสั่งล้างฐานข้อมูล
หากไฟล์บัญชีมาจากเครื่องพัฒนาและต้องการใช้รหัสผ่านชุดเดิม ให้ย้ายไฟล์นั้นผ่าน
ช่องทางส่วนตัวมาที่ var/private/accounts.json **ก่อน** init และกำหนดเจ้าของเป็น
ผู้ใช้ที่รันสคริปต์ โฟลเดอร์ permission 700 และไฟล์ 600 ห้ามส่งผ่าน GitHub
หากไม่ย้าย สคริปต์จะสร้างรหัสผ่านชุดใหม่บนเครื่องปลายทาง

ไฟล์ .env ที่สร้างใหม่ใช้ค่าของเว็บนี้:

```dotenv
APP_ORIGIN=https://www.osscsskfda.org
BASE_PATH=/sskgecc
WEB_PORT=8080
```

มี COMPOSE_PROJECT_NAME และ POSTGRES_PASSWORD ที่สร้างให้อัตโนมัติด้วย
หากมี .env อยู่แล้ว สคริปต์จะใช้ไฟล์เดิมและไม่เปลี่ยนรหัสผ่านฐานข้อมูลให้
ต้องมี POSTGRES_PASSWORD และ APP_ORIGIN ที่ถูกต้องตาม compose.yaml
อย่าเปลี่ยน POSTGRES_PASSWORD ของฐานข้อมูลเดิมโดยแก้ไฟล์อย่างเดียว
เพราะจะไม่เปลี่ยนรหัสผ่านในฐานข้อมูลที่สร้างไปแล้ว

บัญชีแรกเข้าอยู่ใน var/private/accounts.json: หน่วยบริการ 28, MENTOR 24,
ผู้ประสานงาน 2 ทุกบัญชีต้องเปลี่ยนรหัสผ่านก่อนบันทึกข้อมูล
บัญชีเดิมที่สคริปต์รายงาน skipped จะคงรหัสผ่านเดิม ไม่ใช้รหัสในไฟล์นี้
เก็บไฟล์นี้ไว้กับผู้ดูแลเท่านั้น และส่งแต่ละบัญชีให้เจ้าของบัญชีผ่านช่องทางส่วนตัว

หากพอร์ต 8080 ถูกใช้อยู่ ให้ทีมเปลี่ยน WEB_PORT และพอร์ต Apache ให้ตรงกัน
สคริปต์จะไม่ปิดโปรแกรมอื่นเพื่อแย่งใช้พอร์ต

## 4. เปิดผ่านโดเมนจริง — ทีม Apache ทำครั้งแรก

ให้ทีมโฮสต์อ่าน deploy/apache-sskgecc.conf และเพิ่มใน HTTPS VirtualHost เดิม
ของ www.osscsskfda.org โดยเปิด proxy/proxy_http และคงเส้นทางเว็บอื่นไว้
Apache ส่ง /sskgecc/ ไปที่ http://127.0.0.1:8080/sskgecc/ ทั้งหน้าเว็บและ API
ตรวจ Apache config ให้ผ่านก่อน reload ผ่านขั้นตอนของทีมโฮสต์

ขั้นตอนนี้เปลี่ยนเว็บจริง จึงไม่ได้รวมไว้ใน init อัตโนมัติ
สำรองเว็บ/การตั้งค่า/ฐานข้อมูลและไฟล์แนบเดิมก่อนสลับเส้นทาง
จากนั้นตรวจ:

```sh
bash deploy/production.sh status
bash deploy/production.sh smoke
```

smoke ต้องแสดง ok: true หาก API ยัง 404 ให้ตรวจ reverse proxy แทนการอัปโหลด
HTML ซ้ำ ต้องทดสอบล็อกอินสามบทบาท เปลี่ยนรหัสผ่าน บันทึก/โหลดใหม่ แนบ/โหลดไฟล์
และสำรอง/กู้คืนบน staging ด้วยก่อนรับรองระบบจริง

## 5. การเริ่มใหม่ / การอัปเดตรอบถัดไป

หลังเครื่อง restart Docker จะเริ่มบริการให้อัตโนมัติเมื่อ Docker daemon ทำงาน
ดูสถานะด้วย status หากต้องสั่งเริ่มบริการเดิม:

```sh
bash deploy/production.sh start --apply
```

คำสั่ง start ไม่ build ไม่ migrate และไม่สร้างบัญชีใหม่
การอัปเดต code ให้ทีมสำรอง PostgreSQL พร้อมไฟล์แนบอย่างสอดคล้องกันก่อน
ตรวจ diff/release แล้ว pull รุ่นที่อนุมัติ และรัน init --apply เพื่อ build/migrate
และเริ่ม image ใหม่ การรันนี้อาจสร้าง container ใหม่และทำให้บริการหยุดช่วงสั้น ๆ
ห้ามทำขณะมีคนบันทึกข้อมูล และห้ามใช้ docker compose down -v

ถ้าหยุดกลางทาง ขั้นตอนก่อนหน้าอาจสำเร็จแล้ว ให้ดูข้อความผิดพลาดและแก้สาเหตุก่อน
รันซ้ำได้โดยไม่ทับรหัสผ่านเดิม แต่ไม่ได้ rollback ให้อัตโนมัติ
การคืนระบบต้องใช้คู่ image/ฐานข้อมูล/ไฟล์แนบที่สำรองไว้ ตาม DEPLOYMENT.md

## ขอบเขตการทดสอบสคริปต์

ทดสอบ Bash syntax และลำดับคำสั่งด้วย Docker จำลอง รวมการหยุดเมื่อ migrate
ล้มเหลว การเก็บ .env/บัญชีเดิมไว้เมื่อรันซ้ำ และการไม่ทำงานหากไม่ระบุ --apply
เครื่องพัฒนายังไม่มี Docker daemon จึงยังไม่ได้ทดสอบ build/container/proxy จริง
สคริปต์จะหยุดหากโฮสต์ไม่พร้อม ไม่ถือว่าการตรวจจำลองแทนผลติดตั้งจริงได้
