// UAT personas 1–4: isolated synthetic accounts, real Chrome interactions.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testDatabase } from './postgres.js';
import { migrate } from '../server/store.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { rules } from '../server/domain.js';

const out='output/uat10';await mkdir(out,{recursive:true});
const seed=JSON.parse(await readFile('php/data/seed.json','utf8'));
const people=[0,2,3,4].map(i=>({...seed.publicContent.mentorAdvisors[i],index:i}));
seed.assess={};seed.defects=[];seed.isSample=false;
for(const u of seed.units){const a=rules.blankAssess();a.started=true;a.wf={status:'submitted',round:1,submittedAt:'2026-10-30T00:00:00.000Z',log:[]};seed.assess[u.id]=a;}
const pool=await testDatabase();await migrate(pool);
await pool.query('INSERT INTO app_state(id,document) VALUES(1,$1)',[JSON.stringify(seed)]);
const initialPassword='Synthetic-UAT-Reviewer-2570';const newPassword='Synthetic-UAT-Changed-2570';
const hash=await hashPassword(initialPassword);
for(const person of people)await pool.query('INSERT INTO accounts(id,username,name,password_hash,role,team,must_change) VALUES($1,$1,$2,$3,$4,0,true)',[person.loginUsername,person.name,hash,'mentor']);
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const app=createApp({pool,origin:base});server.on('request',app.listeners('request')[0]);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
const results=[];
async function visibleClick(page,selector){const loc=page.locator(selector);for(let i=0;i<await loc.count();i++)if(await loc.nth(i).isVisible()){await loc.nth(i).click();return;}throw new Error('No visible control: '+selector);}
async function login(page,person,password){
 await page.locator('.site-nav [data-view="portfolio"]').click();
 await page.locator('[data-act="entry-path"][data-path="advisor"]').click();
 await page.locator('[data-act="entry-person"]').filter({hasText:person.name}).click();
 assert.equal(await page.locator('#login-name').inputValue(),person.loginUsername);
 assert.equal(await page.locator('#login-name').getAttribute('readonly'),'');
 await page.locator('#login-password').fill(password);await page.locator('#server-login button[type=submit]').click();
}
try{
 for(const [i,person] of people.entries()){
  const result={persona:i+1,name:person.name,role:'ที่ปรึกษา MENTOR ตรวจทุกกลุ่ม',viewport:[1440,390,768,1440][i],checks:[],errors:[],status:'running'};
  const context=await browser.newContext({viewport:{width:result.viewport,height:1000},colorScheme:i%2?'dark':'light',reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
  await page.route(/https:\/\/(?:www\.)?(?:youtube-nocookie\.com|drive\.google\.com)\//,r=>r.fulfill({status:200,contentType:'text/html',body:'External embeds excluded from local UAT'}));
  try{
   await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('.site-nav');
   await login(page,person,initialPassword);await page.waitForSelector('#password-form');
   result.checks.push('เลือกที่ปรึกษาจากชื่อและใช้บัญชีตรงคน; บังคับเปลี่ยนรหัสผ่านครั้งแรก');
   await page.locator('#old-password').fill(initialPassword);await page.locator('#new-password').fill(newPassword);await page.locator('#repeat-password').fill(newPassword);
   await page.locator('#password-form button[type=submit]').click();
   await page.waitForFunction(()=>S.role===null&&!document.getElementById('password-form'));
   await login(page,person,newPassword);await page.waitForFunction(()=>S.role==='mentor'&&S.allGroups===true&&S.coord===false);
   assert.equal(await page.locator('[data-view="settings"]').count(),0);
   const state=await page.request.get(base+'/api/state');assert.equal(state.status(),200);assert.equal((await state.json()).state.units.length,32);
   result.checks.push('รหัสผ่านใหม่เข้าได้; เห็นครบ32หน่วยงาน; ไม่มีเมนูผู้ดูแล');
   await visibleClick(page,'[data-view="mdash"]');await page.waitForSelector('[data-act="md-team"][data-team="6"]');
   for(const team of seed.teams){
    await page.locator(`[data-act="md-team"][data-team="${team.id}"]`).click();
    const unit=seed.units.find(u=>u.team===team.id);
    await visibleClick(page,`[data-act="open-review"][data-id="${unit.id}"]`);
    await page.waitForFunction(id=>S.view==='unit'&&S.unitId===id,unit.id);
    assert.equal(await page.locator('[data-act="wf-review"]').isEnabled(),true);
    await visibleClick(page,'#tnav [data-view="mdash"]');
   }
   result.checks.push('เลือกและเปิดแบบตรวจได้จริงครบทั้ง6กลุ่ม');
   const unit=seed.units.filter(u=>u.team===6)[i];
   await page.locator('[data-act="md-team"][data-team="6"]').click();
   await visibleClick(page,`[data-act="open-review"][data-id="${unit.id}"]`);
   await page.locator('#tab-phys').click();
   const inspector=page.locator(`#insp-box input[value=${JSON.stringify(person.name)}]`);
   assert.equal(await inspector.count(),1,'Advisor must be able to record their own exact name as inspector');
   await inspector.check();
   const note=`UAT persona ${i+1}: คำแนะนำทดสอบสำหรับกลุ่ม6`;
   await page.locator('#adv-phys').fill(note);await page.locator('[data-act="save"]').click();
   await page.waitForFunction(()=>!S.dirty&&DB.assess[S.unitId]?.adv?.phys?.startsWith('UAT persona'));
   let persisted=(await(await page.request.get(base+'/api/state')).json()).state.assess[unit.id];
   assert.equal(persisted.adv.phys,note);assert.ok(persisted.inspectors.includes(person.name));
   await page.locator('[data-act="wf-review"]').click();
   await page.getByRole('dialog').getByRole('button',{name:'ยืนยันตรวจแล้ว',exact:true}).click();
   await page.waitForFunction(()=>DB.assess[S.unitId]?.wf?.status==='reviewed');
   persisted=(await(await page.request.get(base+'/api/state')).json()).state.assess[unit.id];
   assert.equal(persisted.wf.status,'reviewed');assert.ok(persisted.wf.reviewedBy.includes(person.name));
   result.checks.push('บันทึกคำแนะนำและยืนยันผลตรวจกลุ่ม6 ด้วยชื่อผู้ตรวจตรงบัญชี; อ่านกลับฐานข้อมูลแล้วตรงกัน');
   const admin=await page.request.get(base+'/api/accounts');assert.ok([403,404].includes(admin.status()));
   const ss=await(await page.request.get(base+'/api/session')).json();const doc=await(await page.request.get(base+'/api/state')).json();doc.state.cal.close='2099-12-31';
   const illegal=await page.request.put(base+'/api/state',{headers:{Origin:base,'X-CSRF-Token':ss.csrf},data:doc});assert.equal(illegal.status(),403);
   result.checks.push('API ปฏิเสธดูบัญชีผู้ใช้และแก้ปฏิทินส่วนกลาง');
   assert.deepEqual(result.errors,[]);result.status='passed';
  }catch(e){result.status='failed';result.failure=e.message;result.stack=e.stack;}
  await page.screenshot({path:`${out}/reviewer-${i+1}.png`,fullPage:false});results.push(result);await context.close();
  await writeFile(`${out}/reviewers-results.json`,JSON.stringify({environment:'local Node/PGlite + Chrome; synthetic accounts; no deployment',results},null,2));
  console.log(JSON.stringify(result));
 }
}finally{await browser.close();await new Promise(r=>server.close(r));await pool.end();}
if(results.some(r=>r.status!=='passed'))process.exitCode=1;
