import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { staticFile } from '../server/static.js';
import { testDatabase } from './postgres.js';
import { migrate } from '../server/store.js';
import { createApp } from '../server/app.js';

const roster=JSON.parse(await readFile(new URL('../shared/roster-2570.json',import.meta.url),'utf8'));
const seed=JSON.parse(await readFile(new URL('../php/data/seed.json',import.meta.url),'utf8'));
const preview=createServer((req,res)=>staticFile(req,res,false));
await new Promise(r=>preview.listen(0,'127.0.0.1',r));
const pool=await testDatabase();await migrate(pool);
await pool.query('INSERT INTO app_state(id,document) VALUES(1,$1)',[JSON.stringify(seed)]);
const api=createApp({pool,origin:'http://127.0.0.1'});
await new Promise(r=>api.listen(0,'127.0.0.1',r));
const origin=server=>'http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
const errors=[],failedAssets=[],checks=[];
await mkdir('output/playwright',{recursive:true});
async function prepare(page){
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().startsWith('http://127.0.0.1:')&&r.url().includes('/assets/')&&r.status()>=400)failedAssets.push({url:r.url(),status:r.status()});});
 await page.route(/https:\/\/(?:www\.)?(?:youtube-nocookie\.com|drive\.google\.com)\//,r=>r.fulfill({status:200,contentType:'text/html',body:'<html lang="th"><title>External video preview omitted in local UI regression</title></html>'}));
}
async function pictures(page){
 await page.locator('#content img').evaluateAll(ims=>ims.forEach(i=>i.loading='eager'));
 await page.waitForFunction(()=>[...document.querySelectorAll('#content img')].every(i=>i.complete&&i.naturalWidth>0));
}
async function nav(page,view){await page.locator(`.site-nav [data-view="${view}"]`).click();await page.waitForTimeout(100);}
async function names(page,selector){return (await page.locator(selector).allTextContents()).map(n=>n.trim());}
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await prepare(page);
 await page.goto(origin(preview),{waitUntil:'domcontentloaded'});
 await page.waitForSelector('.site-nav');
 assert.deepEqual(await names(page,'.site-nav-links>button'),['หน้าหลัก','คณะทำงาน GECC','MENTOR','Library','Gallery','เข้าสู่ระบบ']);checks.push('Navigation order');await page.screenshot({path:'output/playwright/content-refresh-baseline.png',fullPage:false});
 await nav(page,'committee');await pictures(page);
 assert.equal(await page.locator('#content .committee-card').count(),19);
 assert.equal(await page.locator('.committee-secretaries>.committee-card').count(),3);
 const row=await page.locator('.committee-secretaries>.committee-card').evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().top)));
 assert.equal(new Set(row).size,1,'Three committee secretaries must share a row at desktop');
 assert.deepEqual(await names(page,'#mentor-advisors h3'),roster.publicContent.mentorAdvisors.map(m=>m.name));
 await page.screenshot({path:'output/playwright/content-refresh-committee-1440.png',fullPage:true});checks.push('Committee19cards; advisors6; final committee row3; all images load');
 await nav(page,'mentors');await page.waitForSelector('.mentor-roster');await pictures(page);
 assert.equal(await page.locator('.mentor-roster .committee-card').count(),24);
 assert.deepEqual(await names(page,'.mentor-roster h3'),roster.teams.flatMap(t=>t.members.map(m=>m.name)));
 await page.screenshot({path:'output/playwright/content-refresh-mentors-1440.png',fullPage:true});checks.push('24 mentor names and portraits in authoritative order');
 await nav(page,'gallery');await page.waitForSelector('[data-album]');await pictures(page);
 const album=page.locator('[data-album]').filter({hasText:'29 ตุลาคม 2569'}).first();assert.equal(await album.count(),1);
 assert.equal(await album.locator('[data-slide]').count(),42);assert.equal(await album.locator('[data-position]').textContent(),'1 / 42');
 await album.locator('[data-next]').click();assert.equal(await album.locator('[data-position]').textContent(),'2 / 42');
 await album.locator('[data-prev]').click();assert.equal(await album.locator('[data-position]').textContent(),'1 / 42');
 await album.locator('[data-prev]').click();assert.equal(await album.locator('[data-position]').textContent(),'42 / 42');
 await album.locator('[data-next]').click();assert.equal(await album.locator('[data-position]').textContent(),'1 / 42');
 await page.screenshot({path:'output/playwright/content-refresh-gallery-1440.png',fullPage:true});checks.push('Gallery42localimages; next/previous/wrap');
 const real=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await prepare(real);
 await real.goto(origin(api),{waitUntil:'domcontentloaded'});await real.waitForSelector('.site-nav');
 await nav(real,'portfolio');assert.deepEqual(await names(real,'[data-act="entry-path"] b'),['ที่ปรึกษา MENTOR','MENTOR','หน่วยบริการที่สมัคร']);
 const stepStart=async path=>{await nav(real,'portfolio');if(await real.locator('[data-act="entry-back"][data-step="path"]').count())await real.locator('[data-act="entry-back"][data-step="path"]').click();await real.locator(`[data-act="entry-path"][data-path="${path}"]`).click();};
 await stepStart('advisor');await real.waitForSelector('[data-act="entry-person"]');assert.deepEqual(await names(real,'[data-act="entry-person"] h3'),roster.publicContent.mentorAdvisors.map(m=>m.name));
 for(let i=0;i<6;i++){await real.locator('[data-act="entry-person"]').nth(i).click();await real.waitForSelector('#server-login');assert.ok((await real.locator('[role=dialog]').innerText()).includes(roster.publicContent.mentorAdvisors[i].name));assert.equal(await real.locator('#login-password').getAttribute('autocomplete'),'current-password');await real.locator('[data-act="modal-close"]').click();}
 let mentorCount=0,unitCount=0;
 for(const kind of ['mentor','mentee']){
  await stepStart(kind);assert.equal(await real.locator('[data-act="entry-team"]').count(),6);
  for(const t of roster.teams){
   await real.locator(`[data-act="entry-team"][data-team="${t.id}"]`).click();
   if(kind==='mentor'){
    const got=await names(real,'[data-act="entry-person"] h3');assert.deepEqual(got,t.members.map(m=>m.name));mentorCount+=got.length;
    await real.locator('[data-act="entry-person"]').first().click();
   }else{
    const got=await names(real,'[data-act="entry-unit"]>span');assert.deepEqual(got,roster.units.filter(u=>u.team===t.id).map(u=>u.name));unitCount+=got.length;
    await real.locator('[data-act="entry-unit"]').first().click();
   }
   await real.waitForSelector('#server-login');assert.equal(await real.locator('#login-name').count(),1);assert.equal(await real.locator('#login-password').count(),1);
   if(kind==='mentee')assert.equal(await real.locator('#login-name').getAttribute('maxlength'),'6');
   await real.locator('[data-act="modal-close"]').click();
   await real.locator('[data-act="entry-back"][data-step="group"]').click();assert.equal(await real.locator('[data-act="entry-team"]').count(),6);
  }
 }
 assert.equal(mentorCount,24);assert.equal(unitCount,32);checks.push('Real Node API login paths3; advisors6; groups6; mentor24+unit32 exact lists; all18representative selection routes reach credentials; back navigation');
 for(const theme of ['light','dark'])for(const width of [360,768,1440]){
  await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await page.setViewportSize({width,height:1000});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const view of ['exec','committee','mentors','library','gallery','portfolio']){
   await nav(page,view);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${view} ${theme} ${width} horizontal overflow`);
   if(width===360&&['committee','portfolio'].includes(view)){await pictures(page);await page.screenshot({path:`output/playwright/content-refresh-${view}-360-${theme}.png`,fullPage:true});await page.screenshot({path:`output/playwright/content-refresh-${view}-360-${theme}-viewport.png`,fullPage:false});}
  }
 }
 checks.push('36 responsive route/theme combinations at360/768/1440; reducedmotion; no horizontal overflow');
 assert.deepEqual(failedAssets,[]);assert.deepEqual(errors,[]);
 const result={checks,errors,failedAssets};await writeFile('output/playwright/content-refresh-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await new Promise(r=>preview.close(r));await new Promise(r=>api.close(r));await pool.end();}
