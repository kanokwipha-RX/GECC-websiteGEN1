import { chromium } from 'playwright';
import { createServer } from 'node:net';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testDatabase } from './postgres.js';
import { migrate } from '../server/store.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

// Isolated synthetic accounts; no production data or private credentials are read.
const seed=JSON.parse(await readFile(new URL('../php/data/seed.json',import.meta.url),'utf8'));
const first=(team)=>seed.units.find(u=>u.team===team);
const cases=[
 {id:5,role:'mentor',team:1,name:seed.teams[0].members[1].name,username:'mentor-01-02',width:1440},
 {id:6,role:'mentor',team:5,name:seed.teams[4].members[1].name,username:'mentor-05-02',width:390},
 {id:7,role:'mentee',team:2,name:first(2).name,username:first(2).code,unitId:first(2).id,width:1440},
 {id:8,role:'mentee',team:6,name:first(6).name,username:first(6).code,unitId:first(6).id,width:390},
];
const initialPassword='Synthetic-UAT-2570-Initial';
const changedPassword='Synthetic-UAT-2570-Changed';
const output='output/uat10';await mkdir(output,{recursive:true});
const pool=await testDatabase();await migrate(pool);
await pool.query('INSERT INTO app_state(id,document) VALUES(1,$1)',[JSON.stringify(seed)]);
const hash=await hashPassword(initialPassword);
for(const c of cases)await pool.query('INSERT INTO accounts(id,username,name,password_hash,role,unit_id,team,must_change) VALUES($1,$2,$3,$4,$5,$6,$7,true)',['uat-'+c.id,c.username,c.name,hash,c.role,c.unitId||null,c.role==='mentor'?c.team:null]);
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const origin='http://127.0.0.1:'+port;
const server=createApp({pool,origin});await new Promise(r=>server.listen(port,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
const results=[];
async function selectIdentity(page,c){
 await page.locator('.site-nav [data-view="portfolio"]').click();
 if(await page.locator('[data-act="entry-back"][data-step="path"]').count())await page.locator('[data-act="entry-back"][data-step="path"]').click();
 await page.locator(`[data-act="entry-path"][data-path="${c.role}"]`).click();
 await page.locator(`[data-act="entry-team"][data-team="${c.team}"]`).click();
 const labels=c.role==='mentor'?await page.locator('[data-act="entry-person"] h3').allTextContents():await page.locator('[data-act="entry-unit"]>span').allTextContents();
 assert.deepEqual(labels.map(n=>n.trim()),c.role==='mentor'?seed.teams.find(t=>t.id===c.team).members.map(m=>m.name):seed.units.filter(u=>u.team===c.team).map(u=>u.name));
 await page.locator('[data-act="entry-back"][data-step="group"]').click();
 assert.equal(await page.locator('[data-act="entry-team"]').count(),6);
 await page.locator(`[data-act="entry-team"][data-team="${c.team}"]`).click();
 if(c.role==='mentor')await page.locator('[data-act="entry-person"]').filter({hasText:c.name}).click();
 else await page.locator(`[data-act="entry-unit"][data-id="${c.unitId}"]`).click();
 await page.waitForSelector('#server-login');
 assert.equal(await page.locator('#login-name').inputValue(),c.username);
 assert.notEqual(await page.locator('#login-name').getAttribute('readonly'),null);
}
async function signIn(page,password){await page.locator('#login-password').fill(password);await page.locator('#server-login button[type="submit"]').click();}
try{
 for(const c of cases){
  const result={user:c.id,name:c.name,role:c.role,team:c.team,viewport:c.width,checks:[],errors:[],status:'running'};
  const context=await browser.newContext({viewport:{width:c.width,height:1000},reducedMotion:'reduce'});const page=await context.newPage();
  page.on('pageerror',e=>result.errors.push(e.message));
  try{
   await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForSelector('.site-nav');await selectIdentity(page,c);
   result.checks.push('Three-path login wizard, exact authoritative group list, back navigation, correct readonly account binding');
   await signIn(page,'Deliberately-wrong-password');await page.waitForFunction(()=>document.querySelector('#login-password')?.getAttribute('aria-invalid')==='true');
   assert.equal(await page.locator('#password-form').count(),0);result.checks.push('Wrong password rejected without entering account');
   await signIn(page,initialPassword);await page.waitForSelector('#password-form');
   await page.locator('#old-password').fill(initialPassword);await page.locator('#new-password').fill(changedPassword);await page.locator('#repeat-password').fill(changedPassword+'different');
   await page.locator('#password-form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#password-error')?.textContent.includes('ไม่ตรงกัน'));
   await page.locator('#repeat-password').fill(changedPassword);await page.locator('#password-form button[type="submit"]').click();await page.waitForSelector('#password-form',{state:'detached'});
   await selectIdentity(page,c);await signIn(page,changedPassword);await page.waitForSelector('#server-login',{state:'detached'});await page.waitForSelector('.mgrid2');
   result.checks.push('Mandatory initial password change, confirmation mismatch validation, session invalidation and successful new-password login');
   const visible=await page.evaluate(async()=>{const r=await fetch('/api/state');return r.json();});
   const expected=c.role==='mentor'?seed.units.filter(u=>u.team===c.team):seed.units.filter(u=>u.id===c.unitId);
   assert.deepEqual(visible.state.units.map(u=>u.id).sort(),expected.map(u=>u.id).sort());
   result.visibleUnitCount=visible.state.units.length;
   assert.equal(await page.locator('#content [data-view="settings"]').count(),0);
   if(c.role==='mentor'){
    await page.locator('#content [data-act="mod"][data-view="forms"]').click();
    assert.equal(await page.locator('[data-act="pick-team"]:enabled').count(),1);
    assert.equal(await page.locator(`[data-act="pick-team"][data-team="${c.team}"]`).isEnabled(),true);
    assert.deepEqual((await page.locator('[data-act="pick-unit"]').evaluateAll(els=>els.map(e=>e.dataset.id))).sort(),expected.map(u=>u.id).sort());
    await page.locator('[data-act="pick-unit"]').first().click();await page.locator('[data-act="start-assess"]').click();await page.waitForSelector('#savebar');
    assert.ok((await page.locator('#page-t').innerText()).includes(expected[0].name));
    result.checks.push('Only assigned group enabled; all own-group units visible; real form opened by clicking unit and Start');
   }else{
    await page.locator('#content [data-act="mod"][data-tab="ready"]').click();await page.waitForSelector('#savebar');
    assert.ok((await page.locator('#page-t').innerText()).includes(c.name));
    result.checks.push('Only own unit returned by server; readiness form opened from module card');
   }
   const foreign=seed.units.find(u=>u.team!==c.team);
   const forbidden=await page.evaluate(async({foreignId,revision})=>{
    const session=await (await fetch('/api/session')).json();
    const workflow=await fetch('/api/workflow/'+foreignId,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({revision,action:'review'})});
    const accounts=await fetch('/api/accounts');
    return {workflow:workflow.status,accounts:accounts.status};
   },{foreignId:foreign.id,revision:visible.revision});
   assert.equal(forbidden.workflow,403);assert.ok([403,404].includes(forbidden.accounts));result.denials=forbidden;
   result.checks.push('Foreign-group workflow rejected HTTP403; account-administration endpoint inaccessible');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.screenshot({path:`${output}/user-${c.id}-authenticated.png`,fullPage:false});
   const logout=page.locator('[data-act="logout"]').first();if(!await logout.isVisible())await page.locator('[data-act="menu-open"]').click();await logout.click();
   await page.waitForFunction(async()=>!(await (await fetch('/api/session')).json()).user);
   const after=await page.evaluate(async()=>(await (await fetch('/api/state')).json()).state.units);assert.deepEqual(after,[]);
   result.checks.push('Responsive form has no horizontal overflow; visible Logout removes session and private unit data');
   assert.deepEqual(result.errors,[]);result.status='passed';
  }catch(e){result.status='failed';result.failure=e.stack;await page.screenshot({path:`${output}/user-${c.id}-failure.png`,fullPage:false}).catch(()=>{});}
  results.push(result);await context.close();await writeFile(`${output}/scoped-users.json`,JSON.stringify({environment:'Local Chrome + isolated PGlite; synthetic accounts',results},null,2));
 }
 console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status!=='passed'))process.exitCode=1;
}finally{await browser.close();await new Promise(r=>server.close(r));await pool.end();}
