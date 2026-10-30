import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { staticFile } from '../server/static.js';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const server=createServer((req,res)=>staticFile(req,res,false));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.GECCPublic);
  await page.locator('[data-act=dual-list][data-p="1"][data-s=g]').click();
  await page.waitForSelector('#public-results');
  const expected=await page.evaluate(()=>allInfo(0).filter(x=>x.subAll==='done').length);
  assert.equal(await page.locator('[data-public-id]').count(),expected);
  await page.locator('[data-public-id]').first().click();
  assert.equal(await page.locator('[data-act=open-form]').count(),0);
  assert.ok((await page.locator('[role=dialog]').innerText()).includes('สถานะด้านกายภาพรายข้อ'));
  await page.locator('[data-act=modal-close]').click();
  await page.locator('[data-view=gallery]').click();
  await page.waitForSelector('[data-album]');
  assert.equal(await page.locator('[data-view=gallery]').getAttribute('aria-current'),'page');
  await page.locator('[data-slide="1"]').first().click();
  assert.equal(await page.locator('[data-slide="1"]').first().getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('iframe').count(),5);
  assert.ok(await page.evaluate(()=>GECCPublic.embed('https://evil.example/video'))==='');
  await page.locator('[data-view=mentors]').click();
  await page.waitForSelector('.mentor-roster');
  assert.equal(await page.locator('.mentor-roster .committee-card').count(),24);
  await page.evaluate(()=>{S.role='mentor';S.coord=true;go('settings');});
  await page.locator('[data-feature-editor]').click();
  await page.locator('[data-add-album]').click();
  await page.locator('[data-content-key="albums.0.title"]').fill('อัลบั้มทดสอบ');
  await page.locator('[data-content-key="albums.0.date"]').fill('2026-10-30');
  await page.locator('[data-content-key="albums.0.status"]').selectOption('published');
  await page.locator('[data-add-video]').click();
  assert.equal(await page.locator('[data-content-key="videos.6.category"]').inputValue(),'activity');
  await page.locator('#feature-content-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#feature-content-form'));
  await page.evaluate(()=>go('gallery'));
  await page.waitForSelector('[data-album]');
  assert.ok((await page.locator('#content').innerText()).includes('อัลบั้มทดสอบ'));
  for(const theme of ['light','dark'])for(const width of [360,768,1440]){
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await page.setViewportSize({width,height:1000});
    for(const view of ['exec','committee','portfolio','gallery','mentors']){
      await page.evaluate(v=>go(v),view);await page.waitForTimeout(80);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${view} ${theme} ${width}`);
    }
  }
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/content-v2-mentors.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS Content v2 public filters, safe detail, gallery, roster, content editor and responsive themes');
}finally{await browser.close();await new Promise(r=>server.close(r));}
