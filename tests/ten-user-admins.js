import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testDatabase } from './postgres.js';
import { migrate } from '../server/store.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

const roster=JSON.parse(await readFile('shared/roster-2570.json','utf8'));
const seed=JSON.parse(await readFile('php/data/seed.json','utf8'));
const pool=await testDatabase();await migrate(pool);
await pool.query('INSERT INTO app_state(id,document) VALUES(1,$1)',[JSON.stringify(seed)]);
const subjects=[{number:9,index:1},{number:10,index:5}].map(v=>({...v,...roster.publicContent.mentorAdvisors[v.index]}));
for(const s of subjects)await pool.query('INSERT INTO accounts(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,$5)',['uat-admin-'+s.number,s.loginUsername,s.name,await hashPassword('UatTemporary!2570-'+s.number),'coord']);
let app;const server=createServer((req,res)=>app.emit('request',req,res));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;app=createApp({pool,origin});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
await mkdir('output/uat10',{recursive:true});
const report={environment:'Local Chrome + isolated PGlite; synthetic credentials; no production writes',subjects:[],findings:[],errors:[]};
async function choose(page,s){
 await page.locator('.site-nav [data-view="portfolio"]').click();
 const back=page.locator('[data-act="entry-back"][data-step="path"]');if(await back.count())await back.click();
 await page.locator('[data-act="entry-path"][data-path="advisor"]').click();
 await page.locator('[data-act="entry-person"]').filter({hasText:s.name}).click();
 await page.waitForSelector('#server-login');assert.equal(await page.locator('#login-name').inputValue(),s.loginUsername);
}
async function login(page,s,password){await choose(page,s);await page.locator('#login-password').fill(password);await page.locator('#server-login button[type=submit]').click();}
async function settings(page){await page.locator('[data-view="settings"]:visible').first().click();await page.waitForSelector('[data-act="settings-save"]');}
try{
 for(const s of subjects){
  const context=await browser.newContext({viewport:{width:s.number===9?1440:1280,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push({user:s.number,message:e.message}));
  const result={user:s.number,name:s.name,role:s.number===9?'Existing coordinator retained':'Super administrator (coord full permissions)',checks:[],status:'running'};report.subjects.push(result);
  try{
   await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForSelector('.site-nav');
   await login(page,s,'UatTemporary!2570-'+s.number);await page.waitForSelector('#password-form');result.checks.push('Advisor name selects the exact assigned account; initial password login succeeds');
   assert.equal(await page.locator('#password-form [data-act="modal-close"]').count(),0);
   await page.locator('#old-password').fill('UatTemporary!2570-'+s.number);await page.locator('#new-password').fill('UatChanged!2570-'+s.number);await page.locator('#repeat-password').fill('UatChanged!2570-'+s.number);await page.locator('#password-form button[type=submit]').click();await page.waitForSelector('#password-form',{state:'detached'});
   result.checks.push('Mandatory first password change completes and ends the session');
   await login(page,s,'UatChanged!2570-'+s.number);await page.waitForSelector('#server-login',{state:'detached'});await page.waitForFunction(()=>S.coord&&DB.units.length===32);
   assert.deepEqual(await page.evaluate(()=>[...new Set(DB.units.map(u=>u.team))].sort()),[1,2,3,4,5,6]);result.checks.push('New password login returns all32 units across all6 groups');
   await settings(page);assert.equal(await page.locator('[data-k="name"][data-u]').count(),32);
   await page.locator('[data-server-action="accounts"]').click();await page.waitForSelector('#account-form');assert.equal(await page.locator('#account-form').count(),1);await page.locator('[data-act="modal-close"]').click();result.checks.push('Can open settings and account management');
   const old=seed.units[0].name,changed=old+' · UAT '+s.number;
   await page.locator(`[data-u="${seed.units[0].id}"][data-k="name"]`).fill(changed);await page.locator('[data-act="settings-save"]').click();
   await page.waitForFunction(value=>DB.units[0].name===value&&document.querySelector('#connection-notice')?.textContent.includes('บันทึกข้อมูลกลางแล้ว'),changed);
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(value=>DB.units[0]?.name===value,changed);await settings(page);
   assert.equal(await page.locator(`[data-u="${seed.units[0].id}"][data-k="name"]`).inputValue(),changed);result.checks.push('Unit label edit persists after browser reload');
   await page.locator(`[data-u="${seed.units[0].id}"][data-k="name"]`).fill(old);await page.locator('[data-act="settings-save"]').click();await page.waitForFunction(value=>DB.units[0].name===value&&document.querySelector('#connection-notice')?.textContent.includes('บันทึกข้อมูลกลางแล้ว'),old);
   result.checks.push('Reverted test edit to exact original name');
   await page.screenshot({path:`output/uat10/user-${s.number}-settings.png`,fullPage:false});
   // Prime public cache, mutate a synthetic test account, then refresh authoritative state.
   await page.evaluate(()=>GECCPublic.loadLoginOptions(true));
   const before=await page.evaluate(()=>GECCPublic.loginOptions.advisors.find(a=>a.username==='advisor-02')?.username);
   await pool.query('UPDATE accounts SET active=false WHERE username=$1',['advisor-02']);
   await page.evaluate(()=>GECCClient.boot());
   await page.evaluate(()=>GECCPublic.loadLoginOptions());
   const cached=await page.evaluate(()=>GECCPublic.loginOptions?.advisors.find(a=>a.username==='advisor-02')?.username);
   const authoritative=(await (await page.request.get(origin+'/api/public/login-options')).json()).advisors.find(a=>a.username==='advisor-02');
   if(before&&cached&&!authoritative)report.findings.push({severity:'P2',user:s.number,issue:'Disabled advisor remains in cached login options after authoritative boot',cachedUsername:cached,expected:'No account hint for inactive account'});
   else result.checks.push('Login options invalidated after authoritative refresh');
   await pool.query('UPDATE accounts SET active=true WHERE username=$1',['advisor-02']);
   // User9 was deliberately disabled above; re-authenticate after reactivation if session is gone.
   if(!(await page.evaluate(()=>S.role))){await login(page,s,'UatChanged!2570-'+s.number);await page.waitForSelector('#server-login',{state:'detached'});await page.waitForFunction(()=>S.coord);}
   await page.locator('[data-act="logout"]').first().click();await page.waitForFunction(()=>S.role===null);
   assert.equal((await page.request.get(origin+'/api/accounts')).status(),401);
   const anon=(await (await page.request.get(origin+'/api/state')).json()).state;assert.equal(anon.units.length,0);assert.deepEqual(anon.assess,{});
   result.checks.push('Logout removes session; account API denies access and private assessments are not exposed');result.status='passed';
  }catch(e){result.status='failed';result.error=e.message;await page.screenshot({path:`output/uat10/user-${s.number}-failure.png`,fullPage:false}).catch(()=>{});}
  finally{await context.close();}
 }
}finally{await writeFile('output/uat10/admin-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));await pool.end();}
if(report.subjects.some(s=>s.status==='failed')||report.errors.length)process.exitCode=1;
