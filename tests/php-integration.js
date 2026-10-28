import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildPhp } from "../deploy/build-php.mjs";
import { rules, summary } from "../server/domain.js";
import { checkProduction } from "../server/check-production.js";
const php=resolve(process.env.PHP_BIN||"var/runtimes/php/php.exe");
const maria=resolve(process.env.MARIADB_BIN||"var/runtimes/maria/mariadb-10.6.28-winx64/bin");
const ext=resolve(process.env.PHP_EXT_DIR||"var/runtimes/php/ext");
const phpArgs=["-d","extension_dir="+ext,"-d","extension=pdo_mysql","-d","extension=mbstring"];
const rootBase=resolve("var/php-tests");await mkdir(rootBase,{recursive:true});
const root=await mkdtemp(join(rootBase,"isolated-"));
const dbPort=+(process.env.GECC_TEST_DB_PORT||33177),port=+(process.env.GECC_TEST_PHP_PORT||8093);
const origin="http://127.0.0.1:"+port,base=origin+"/sskgecc/";
let database,web,browser,log="",checks=[],axeStates=[],jsErrors=[];
const append=b=>{log=(log+b.toString()).slice(-100000);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const literal=v=>"'"+v.replaceAll("\\","\\\\").replaceAll("'","\\'")+"'";
let privateDir;
function phpRun(file,args=[],input,extra={}) {
  const r=spawnSync(php,[...phpArgs,file,...args],{input,encoding:"utf8",windowsHide:true,
    env:{...process.env,GECC_ISOLATED_TEST:"1",GECC_TEST_PRIVATE:privateDir,...extra}});
  if(r.status!==0) throw new Error("PHP subprocess failed: "+(r.stderr||r.error?.message));
  return r.stdout;
}
function sql(statement,args=[]) {return JSON.parse(phpRun("tests/php-db.php",[],JSON.stringify({sql:statement,args})));}
async function check(name,fn) {await fn();checks.push(name);console.log("PASS",name);}
async function waitFor(fn) {
  let error;
  for(let i=0;i<100;i++){try{if(await fn())return;}catch(e){error=e;}await delay(200);}
  throw error||new Error("Service did not become ready");
}
async function call(route,actor,method="GET",data,headers={}) {
  const response=await fetch(base+"api/index.php?route="+encodeURIComponent(route),{
    method,headers:{Origin:origin,"Content-Type":"application/json",...(actor?{Cookie:actor.cookie,"X-CSRF-Token":actor.csrf}:{}),...headers},
    body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,data:await response.json(),headers:response.headers};
}
async function login(username,password) {
  const r=await call("session",null,"POST",{username,password});assert.equal(r.status,200,username);
  return {cookie:r.headers.get("set-cookie").split(";")[0],csrf:r.data.csrf,user:r.data.user};
}
try {
  await check("PHP domain equals original JavaScript on 300 records and award cutoffs",async()=>{
    const cases=[];let seed=2570;const rand=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
    for(let i=0;i<300;i++){
      const a=rules.blankAssess();a.started=i%5!==0;
      a.phys=a.phys.map(()=>[true,false,null][Math.floor(rand()*3)]);
      a.qc.forEach(q=>{q.subs=q.subs.map(()=>rand()>.4);q.score=rand()>.5?null:Math.floor(rand()*21)/2;});
      a.narr.forEach(q=>{q.score=rand()>.2?Math.floor(rand()*21)/2:null;});
      Object.assign(a.out,{o11:3,o12:5,o13:8,o14:10,c22:15,c21:a.out.c21.map(()=>rand()>.5),t3:a.out.t3.map(()=>rand()>.5)});
      if(i%3===0)a.ready={c:["y","y","y",i%2?"n":"y"],name:"ผู้ลงนาม",date:"2026-10-28"};
      cases.push(a);
    }
    for(const total of [239.5,240,259.5,260,279.5,280,300]){
      const a=rules.blankAssess();a.started=true;a.phys.fill(true);a.qc.forEach(q=>q.score=10);
      for(const k of ["o11","o12","o13","o14","c22"])a.out[k]=Math.max(...rules.OUT[k].opts.map(x=>x[0]));
      a.out.c21.fill(true);a.out.t3.fill(true);a.narr.forEach(n=>n.score=(total-200)/10);cases.push(a);
      const gate=structuredClone(a);gate.phys[0]=false;cases.push(gate);
    }
    const got=JSON.parse(phpRun("tests/php-rules.php",[],JSON.stringify(cases)));
    for(let i=0;i<cases.length;i++)assert.deepEqual(got[i],["calc","subOf","readyOf"].map(k=>JSON.parse(JSON.stringify(rules[k](cases[i])))),"case "+i);
  });
  const release=await buildPhp(join(root,"release"));privateDir=release.privateDir;
  await mkdir(join(release.output,"public_html"),{recursive:true});
  const docroot=join(release.output,"public_html");
  await rename(release.publicDir,join(docroot,"sskgecc"));
  const password=randomBytes(24).toString("hex"),dataDir=join(root,"database");
  const init=spawnSync(join(maria,"mariadb-install-db.exe"),["--datadir="+dataDir,"--password="+password,"--port="+dbPort],{encoding:"utf8",windowsHide:true});
  assert.equal(init.status,0,init.stderr||init.stdout);
  database=spawn(join(maria,"mariadbd.exe"),["--no-defaults","--basedir="+resolve(maria,".."),"--datadir="+dataDir,"--port="+dbPort,
    "--bind-address=127.0.0.1","--console","--innodb-buffer-pool-size=64M","--max-connections=30"],{windowsHide:true});
  database.stdout.on("data",append);database.stderr.on("data",append);
  await writeFile(join(privateDir,"config.local.php"),"<?php return ["+
    "'dsn'=>"+literal("mysql:host=127.0.0.1;port="+dbPort+";dbname=mysql;charset=utf8mb4")+","+
    "'db_user'=>'root','db_password'=>"+literal(password)+",'origin'=>"+literal(origin)+",'base_path'=>'/sskgecc',"+
    "'secure_cookie'=>false,'allow_web_setup'=>true,'setup_token_hash'=>"+literal((await readFile(join(privateDir,"config.example.php"),"utf8")).match(/'setup_token_hash' => '([a-f0-9]+)'/)[1])+","+
    "'files'=>__DIR__.'/files'];",{mode:0o600});
  await waitFor(()=>{sql("SELECT 1");return true;});
  sql("CREATE DATABASE gecc_isolated CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  const config=await readFile(join(privateDir,"config.local.php"),"utf8");
  await writeFile(join(privateDir,"config.local.php"),config.replace("dbname=mysql;","dbname=gecc_isolated;"),{mode:0o600});
  web=spawn(php,[...phpArgs,"-d","display_errors=0","-S","127.0.0.1:"+port,"-t",docroot],{windowsHide:true});
  web.stdout.on("data",append);web.stderr.on("data",append);
  await waitFor(async()=>{const r=await fetch(base+"api/index.php?route=health");return r.status===503;});
  browser=await chromium.launch();const ctx=await browser.newContext({viewport:{width:390,height:900}});
  const page=await ctx.newPage();page.on("pageerror",e=>jsErrors.push(e.message));
  await check("one-time web installer creates MariaDB schema and 54 accounts, then closes itself",async()=>{
    const denied=await call("setup",null,"POST",{token:"0".repeat(64)});assert.equal(denied.status,403);
    await page.goto(base+"setup.html");
    await page.locator("#token").fill((await readFile(join(privateDir,"setup-token.txt"),"utf8")).trim());
    await page.locator("#submit").click();
    await page.waitForFunction(()=>document.getElementById("status").textContent.includes("สำเร็จ"),{timeout:120000});
    assert.equal(sql("SELECT COUNT(*) AS n FROM gecc_accounts")[0].n,54);
    assert.equal((await call("setup",null,"POST",{token:"0".repeat(64)})).status,404);
    const rerun=JSON.parse(phpRun(join(privateDir,"manage.php"),["install","--apply"]));assert.equal(rerun.skipped,54);
    assert.equal((await call("health")).status,200);
    const charset=sql("SELECT DISTINCT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA='gecc_isolated'");
    assert.ok(charset.every(r=>r.TABLE_COLLATION.startsWith("utf8mb4")));
  });
  const bundle=JSON.parse(await readFile(join(privateDir,"accounts.json"),"utf8"));
  const official=JSON.parse(await readFile(join(privateDir,"data/seed.json"),"utf8"));
  const passwords=Object.fromEntries(bundle.accounts.map(a=>[a.username,a.password]));
  await check("all 54 PHP accounts authenticate with correct scope and mandatory password change",async()=>{
    for(const a of bundle.accounts){
      const actor=await login(a.username,a.password);assert.equal(actor.user.mustChange,true);
      const r=await call("state",actor);assert.equal(r.status,200);
      assert.equal(r.data.state.units.length,a.role==="mentee"?1:a.role==="mentor"?official.units.filter(u=>u.team===a.team).length:28);
      assert.equal((await call("state",actor,"PUT",{})).status,403);
    }
  });
  const changed="Changed-password-2570";
  const actors={};
  for(const name of ["coord-01","000001","mentor-01-01","mentor-02-01"]){
    const a=await login(name,passwords[name]);
    assert.equal((await call("password",a,"POST",{current:passwords[name],password:changed})).status,200);
    assert.equal((await call("state",a,"PUT",{})).status,401);
    actors[name]=await login(name,changed);
  }
  const coord=actors["coord-01"],unit=actors["000001"],mentor=actors["mentor-01-01"],other=actors["mentor-02-01"];
  await check("public projection and auth/CSRF/origin/session boundaries",async()=>{
    const r=await call("state");assert.deepEqual(r.data.state.units,[]);assert.deepEqual(r.data.state.assess,{});
    assert.ok(!r.data.state.pins);
    assert.equal((await call("state",null,"PUT",{})).status,401);
    assert.equal((await call("state",coord,"PUT",{},{"X-CSRF-Token":"forged"})).status,403);
    assert.equal((await call("state",coord,"PUT",{}, {Origin:"https://evil.example"})).status,403);
    assert.match(coord.cookie,/gecc-/);
  });
  let snapshot=(await call("state",coord)).data;
  await check("scoped save, stale-write rejection, forged scores and Thai/emoji persistence",async()=>{
    const a=JSON.parse(JSON.stringify(rules.blankAssess()));a.started=true;a.inspectors=["Test reviewer"];
    snapshot.state.assess.u01=a;
    let r=await call("state",coord,"PUT",snapshot);assert.equal(r.status,200);snapshot=r.data;
    assert.equal((await call("state",coord,"PUT",{...snapshot,revision:snapshot.revision-1})).status,409);
    const own=(await call("state",unit)).data;own.state.assess.u01.phys[0]=true;
    assert.equal((await call("state",unit,"PUT",own)).status,403);
    const text=(await call("state",unit)).data;text.state.assess.u01.narr[0].text="ภาษาไทย ศรีสะเกษ 🏛️";
    r=await call("state",unit,"PUT",text);assert.equal(r.status,200);assert.equal(r.data.state.assess.u01.narr[0].text,text.state.assess.u01.narr[0].text);
    const wrong=(await call("state",other)).data;wrong.state.assess.u01=a;
    assert.equal((await call("state",other,"PUT",wrong)).status,403);
  });
  await check("workflow submit/review/lock/reasoned-reopen preserves incumbent behavior",async()=>{
    let r=await call("state",unit);
    r=await call("workflow/u01",unit,"POST",{revision:r.data.revision,action:"submit",sender:{name:"ผู้ส่งทดสอบ",tel:"0812345678"}});
    assert.equal(r.status,200);
    r=await call("workflow/u01",mentor,"POST",{revision:r.data.revision,action:"review"});assert.equal(r.status,200);
    const locked=(await call("state",coord)).data;locked.state.assess.u01.narr[0].text="cannot change";
    assert.equal((await call("state",coord,"PUT",locked)).status,409);
    assert.equal((await call("workflow/u01",mentor,"POST",{revision:r.data.revision,action:"reopen",note:"short"})).status,400);
    r=await call("workflow/u01",mentor,"POST",{revision:r.data.revision,action:"reopen",note:"ตรวจสอบหลักฐานเพิ่มเติม"});assert.equal(r.status,200);
  });
  await check("private attachment signatures, duplicate IDs and cross-unit access",async()=>{
    const url=base+"api/index.php?route=files%2Ftest-file";
    const options={method:"PUT",headers:{Origin:origin,Cookie:unit.cookie,"X-CSRF-Token":unit.csrf,"X-Unit-Id":"u01","X-File-Name":encodeURIComponent("หลักฐาน.pdf"),"Content-Type":"application/pdf"},body:"%PDF-1.4\nGECC test"};
    const r=await fetch(url,options);assert.equal(r.status,201);
    assert.equal((await fetch(url,options)).status,409);
    assert.equal((await fetch(url,{headers:{Cookie:other.cookie}})).status,404);
    assert.equal((await fetch(url,{headers:{Cookie:unit.cookie}})).status,200);
    assert.equal((await fetch(base+"api/index.php?route=files%2Fbad-file",{...options,body:"not a pdf"})).status,400);
    assert.equal((await fetch(base+"api/index.php?route=files%2Ftoo-big",{...options,body:"x".repeat(10485761)})).status,413);
  });
  await check("account creation/reset/disable revoke sessions and preserve coordinator access",async()=>{
    let r=await call("accounts",coord,"POST",{username:"extra-reviewer",name:"ผู้ตรวจเพิ่มเติม",role:"mentor",team:1,password:"Extra-reviewer-password"});
    assert.equal(r.status,201);
    const a=await login("extra-reviewer","Extra-reviewer-password");
    const list=(await call("accounts",coord)).data.accounts;
    const id=list.find(a=>a.username==="extra-reviewer").id;
    assert.equal((await call("accounts/"+id,coord,"PATCH",{active:false})).status,200);
    assert.equal((await call("session",a)).data.user,null);
    assert.equal((await call("accounts/"+id,coord,"PATCH",{active:true,password:"Reset-reviewer-password"})).status,200);
    assert.equal((await login("extra-reviewer","Reset-reviewer-password")).user.mustChange,true);
    assert.equal((await call("accounts/"+coord.user.id,coord,"PATCH",{active:false})).status,400);
    assert.equal((await call("accounts",unit,"POST",{role:"coord"})).status,404);
  });
  await check("invalid identifiers/dates/scores roll back and file metadata is server authoritative",async()=>{
    const current=(await call("state",coord)).data;
    for(const mutate of [
      s=>{s.fy="<script>";},s=>{s.assess.u01.date="2026-02-30";},
      s=>{s.assess.u01.phys[0]="yes";},s=>{s.assess.u01.qc[0].score=11;},
      s=>{s.assess.u01.ready={c:"malformed"};},s=>{s.assess.u01.ev="malformed";},
      s=>{s.assess.u01.quick="malformed";}
    ]){
      const bad=structuredClone(current);mutate(bad.state);
      assert.equal((await call("state",coord,"PUT",bad)).status,400);
      assert.equal((await call("state",coord)).data.revision,current.revision);
    }
    const own=(await call("state",unit)).data;
    own.state.assess.u01.ev={"phys:0":{files:[{id:"test-file",name:"หลักฐาน.pdf",type:"fake",size:1,by:"mentor"}]}};
    const r=await call("state",unit,"PUT",own);assert.equal(r.status,200);
    const f=r.data.state.assess.u01.ev["phys:0"].files[0];
    assert.equal(f.by,"mentee");assert.equal(f.type,"application/pdf");assert.ok(f.size>1);
    const reviewer=(await call("state",mentor)).data;reviewer.state.assess.u01.ev={};
    assert.equal((await call("state",mentor,"PUT",reviewer)).status,403);
  });
  await check("defect responses cannot edit or delete reviewer findings",async()=>{
    const current=(await call("state",coord)).data;
    current.state.defects.push({id:"d-test",unitId:"u01",detail:"รายละเอียดที่ต้องแก้ไข",due:"2026-11-30",status:"open",history:[]});
    assert.equal((await call("state",coord,"PUT",current)).status,200);
    const hijack=(await call("state",other)).data;
    hijack.state.defects.push({id:"d-test",unitId:official.units.find(u=>u.team===2).id,detail:"forged reassignment",due:"2026-11-30",status:"open"});
    assert.equal((await call("state",other,"PUT",hijack)).status,403);
    const own=(await call("state",unit)).data;
    const del=structuredClone(own);del.state.defects=[];assert.equal((await call("state",unit,"PUT",del)).status,403);
    own.state.defects[0].status="recheck";own.state.defects[0].response="หน่วยบริการแก้ไขเรียบร้อยแล้ว";
    const r=await call("state",unit,"PUT",own);assert.equal(r.status,200);
    assert.equal(r.data.state.defects[0].history.at(-1).by,unit.user.name);
  });
  const axe=await readFile("node_modules/axe-core/axe.min.js","utf8");
  await check("PHP frontend login, first-password change, forms, save/reload and responsive axe checks",async()=>{
    await page.goto(base);await page.waitForSelector(".summary-grid");
    assert.equal(await page.evaluate(()=>window.GECC_API_STYLE),"php");
    for(const scheme of ["light","dark"])for(const width of [390,1440]){
      await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:1000});
      for(const view of ["exec","portfolio","committee","library"]){
        await page.evaluate(v=>go(v),view);
        await page.evaluate(async()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,view);
        await page.evaluate(axe);
        const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
        axeStates.push({view:"public "+view,scheme,width,violations});
      }
    }
    await page.evaluate(()=>GECCClient.loginModal("coord",0,"ผู้ประสานงาน"));
    await page.locator("#login-name").fill("coord-01");await page.locator("#login-password").fill(changed);
    await page.locator("#server-login button[type=submit]").click();
    await page.waitForFunction(()=>S.coord===true&&DB.units.length===28);
    for(const scheme of ["light","dark"])for(const width of [390,1440]){
      await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:1000});
      for(const view of ["modules","mdash","forms","defects","settings"]){
        await page.evaluate(v=>go(v),view);
        await page.evaluate(async()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,view);
        await page.evaluate(axe);
        const audit=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
        axeStates.push({view,scheme,width,violations:audit});
        if(view==="modules"){
          await mkdir("artifacts",{recursive:true});
          await page.screenshot({path:"artifacts/php-modules-"+scheme+"-"+width+".png",fullPage:true});
        }
      }
    }
    await page.setViewportSize({width:390,height:1000});
    for(const scheme of ["light","dark"]){
      await page.emulateMedia({colorScheme:scheme});
      for(const tab of ["ready","phys","qc","narr","out","svy","sum","log"]){
        await page.evaluate(t=>go("unit",{unitId:"u01",tab:t}),tab);
        await page.evaluate(async()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
        await page.evaluate(axe);
        const violations=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
        axeStates.push({view:"assessment "+tab,scheme,width:390,violations});
      }
    }
    await page.evaluate(()=>go("unit",{unitId:"u01",tab:"narr"}));
    await page.locator('textarea[data-bind="narr.0.text"]').fill("บันทึกจาก PHP browser");
    await page.locator("[data-act=save]").first().click();await page.waitForFunction(()=>!S.dirty);
    await page.reload();await page.waitForFunction(()=>S.coord===true);
    assert.equal(await page.evaluate(()=>DB.assess.u01.narr[0].text),"บันทึกจาก PHP browser");
  });
  await check("PHP import refuses nonempty data, previews missing files and restores only into empty target",async()=>{
    const current=(await call("state",coord)).data;
    assert.equal((await call("import/preview",coord,"POST",{revision:current.revision,state:current.state})).status,409);
    const reset=await call("admin/reset",coord,"POST",{revision:current.revision,mode:"assessments"});assert.equal(reset.status,200);
    const preview=await call("import/preview",coord,"POST",{revision:reset.data.revision,state:current.state});
    assert.equal(preview.status,200);assert.deepEqual(preview.data.missing,[]);
    const restored=await call("import",coord,"POST",{revision:reset.data.revision,state:current.state});assert.equal(restored.status,200);
    assert.equal(restored.data.state.assess.u01.narr[0].text,"บันทึกจาก PHP browser");
    assert.equal((await call("import",coord,"POST",{revision:restored.data.revision,state:current.state})).status,409);
  });
  await check("PHP browser forces password change, links mismatch errors and preserves draft after a failed save",async()=>{
    const context=await browser.newContext({viewport:{width:390,height:900}});
    try{
      const p=await context.newPage();p.on("pageerror",e=>jsErrors.push(e.message));
      await p.goto(base);await p.waitForSelector(".summary-grid");
      await p.evaluate(()=>GECCClient.loginModal("coord",0,"ผู้ประสานงาน"));
      await p.locator("#login-name").fill("coord-02");await p.locator("#login-password").fill(passwords["coord-02"]);
      await p.locator("#server-login button[type=submit]").click();await p.waitForSelector("#password-form");
      await p.locator("#old-password").fill(passwords["coord-02"]);await p.locator("#new-password").fill(changed);
      await p.locator("#repeat-password").fill("Mismatch-password-2570");
      await p.locator("#password-form button[type=submit]").click();
      assert.equal(await p.evaluate(()=>document.activeElement.id),"repeat-password");
      assert.equal(await p.locator("#repeat-password").getAttribute("aria-invalid"),"true");
      await p.locator("#repeat-password").fill(changed);await p.locator("#password-form button[type=submit]").click();
      await p.waitForFunction(()=>S.role===null&&!document.getElementById("password-form"));
      await p.evaluate(()=>GECCClient.loginModal("coord",0,"ผู้ประสานงาน"));
      await p.locator("#login-name").fill("coord-02");await p.locator("#login-password").fill(changed);
      await p.locator("#server-login button[type=submit]").click();await p.waitForFunction(()=>S.coord===true);
      await p.evaluate(()=>go("unit",{unitId:"u01",tab:"narr"}));
      await p.locator('textarea[data-bind="narr.0.text"]').fill("PHP unsaved draft");
      await p.route(/\/api\/index\.php\?route=state$/,r=>r.request().method()==="PUT"?r.abort():r.continue());
      await p.locator("[data-act=save]").first().click();await p.waitForSelector("#connection-notice.error");
      assert.equal(await p.evaluate(()=>S.dirty),true);
      assert.equal(await p.evaluate(()=>S.draft.narr[0].text),"PHP unsaved draft");
    }finally{await context.close();}
  });
  await check("PHP binary backup restores via browser with SHA256 checks and missing-file reupload",async()=>{
    await page.evaluate(async()=>{await GECCClient.boot();go("settings");});
    const [download]=await Promise.all([page.waitForEvent("download"),page.evaluate(()=>GECCBackup.exportBundle())]);
    const backup="artifacts/php-backup-test.json";await download.saveAs(backup);
    const bundle=JSON.parse(await readFile(backup,"utf8"));
    assert.equal(bundle.missing.length,0);assert.equal(bundle.files.length,1);
    const file=bundle.files[0];
    assert.equal(createHash("sha256").update(Buffer.from(file.base64,"base64")).digest("hex"),file.sha256);
    await page.evaluate(async()=>{
      await GECCClient.request("/api/admin/reset",{method:"POST",body:JSON.stringify({revision:GECCClient.revision,mode:"assessments"})});
      await GECCClient.boot();go("settings");
    });
    // Simulate restoring onto empty private attachment storage in this isolated DB.
    sql("DELETE FROM gecc_files WHERE id=?",[file.id]);
    assert.match(file.id,/^[A-Za-z0-9_-]+$/);
    await unlink(join(privateDir,"files",file.id));
    await page.locator("[data-act-change=import]").setInputFiles(backup);
    await page.waitForSelector("[data-act=confirm-ok]");
    await page.locator("[data-act=confirm-ok]").click();
    await page.waitForFunction(()=>!!DB.assess.u01?.ev?.["phys:0"]);
    const bytes=await readFile(join(privateDir,"files",file.id));
    assert.equal(createHash("sha256").update(bytes).digest("hex"),file.sha256);
    assert.equal(sql("SELECT COUNT(*) AS n FROM gecc_files")[0].n,1);
  });
  await check("PHP-backed report retains working print PDF",async()=>{
    await page.evaluate(()=>go("unit",{unitId:"u01",tab:"sum"}));
    const pdf=await page.pdf({path:"artifacts/php-report-print.pdf",format:"A4",printBackground:true});
    assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  });
  await check("persistent brute-force throttling and audit evidence",async()=>{
    for(let i=0;i<10;i++)assert.equal((await call("session",null,"POST",{username:"absent-test",password:"wrong"})).status,401);
    assert.equal((await call("session",null,"POST",{username:"absent-test",password:"wrong"})).status,429);
    const events=(await call("audit",coord)).data.events;
    assert.ok(events.length>0);assert.ok(events.every(e=>e.created_at.endsWith("Z")));
  });
  await check("encoding repair previews, backs up and atomically preserves live records and credentials",async()=>{
    const corrupt=text=>new TextDecoder("windows-874").decode(new TextEncoder().encode(text));
    const before=(await call("state",coord)).data;
    const original=structuredClone(before.state);
    before.state.publicContent.library[0].name=corrupt(original.publicContent.library[0].name);
    before.state.mentorCoordinators[0].name=corrupt(original.mentorCoordinators[0].name);
    before.state.units[0].name=corrupt(original.units[0].name);
    const account=sql("SELECT * FROM gecc_accounts WHERE id=?",[coord.user.id])[0];
    sql("UPDATE gecc_accounts SET name=? WHERE id=?",[corrupt("ผู้ประสานงานจังหวัด"),coord.user.id]);
    sql("UPDATE gecc_app_state SET document=? WHERE id=1",[JSON.stringify(before.state)]);
    assert.equal((await call("admin/repair-encoding")).status,403);
    assert.equal((await call("admin/repair-encoding",unit)).status,403);
    assert.equal((await call("admin/repair-encoding",mentor,"POST",{revision:before.revision})).status,403);
    const preview=(await call("admin/repair-encoding",coord)).data;
    assert.equal(preview.count,4);assert.equal(preview.applied,false);
    assert.deepEqual((await call("state",coord)).data.state,before.state,"preview must not write");
    assert.equal((await call("admin/repair-encoding",coord,"POST",{revision:before.revision-1})).status,409);
    assert.equal((await call("admin/repair-encoding",coord,"POST",{revision:before.revision},{"X-CSRF-Token":"forged"})).status,403);
    await page.evaluate(async()=>{S.dirty=false;await GECCClient.boot();go("settings");});
    await page.locator("[data-server-action=repair-encoding]").click();
    await page.waitForSelector("#encoding-apply");
    assert.ok((await page.locator("[role=dialog]").innerText()).includes(original.mentorCoordinators[0].name));
    await page.locator("#encoding-apply").click();
    await page.waitForFunction(()=>!document.querySelector("#encoding-apply"));
    assert.deepEqual((await call("state",coord)).data.state,original);
    const after=sql("SELECT * FROM gecc_accounts WHERE id=?",[coord.user.id])[0];
    assert.equal(after.name,"ผู้ประสานงานจังหวัด");
    assert.deepEqual({...after,name:account.name},account,"password, role and scope unchanged");
    const {readdir}=await import("node:fs/promises");
    const backups=await readdir(join(privateDir,"backups"));assert.equal(backups.length,1);
    const backup=JSON.parse(await readFile(join(privateDir,"backups",backups[0]),"utf8"));
    assert.deepEqual(backup.state,before.state);assert.ok(!JSON.stringify(backup).includes("password_hash"));
    const fixed=(await call("state",coord)).data;
    const noChange=(await call("admin/repair-encoding",coord,"POST",{revision:fixed.revision})).data;
    assert.equal(noChange.count,0);assert.equal(noChange.applied,false);
    assert.equal((await call("state",coord)).data.revision,fixed.revision);
    assert.deepEqual((await call("state")).data.summary,summary(original),"PHP and Node chart aggregates agree");
    const anon=await browser.newContext({viewport:{width:1440,height:1000}});
    try {
      const p=await anon.newPage();await p.goto(base);await p.waitForSelector(".dual2");
      assert.ok(!(await p.locator(".rb-d").innerText()).includes('ณ –'),"toolbar must use aggregate update date");
      assert.equal(await p.locator(".cdt-m.start em").innerText(),await p.evaluate(()=>thDate(DB.cal.start)),"timeline must retain October 1 in Bangkok");
      await p.pdf({path:"artifacts/php-public-dashboard-print.pdf",format:"A4",printBackground:true});
      assert.equal(await p.locator(".tb-brand .seal img").count(),2);
      assert.equal(await p.locator("[data-act=dual-list]").count(),0,"public metrics have no private drilldown");
      assert.equal(await p.evaluate(()=>DB.units.length),0);
      await p.screenshot({path:"artifacts/php-public-dashboard-desktop.png",fullPage:true});
      for (const view of ["exec","portfolio","committee","library"]) {
        for (const theme of ["light","dark"]) {
          await p.emulateMedia({colorScheme:theme});
          for (const width of [360,390,768,1440]) {
            await p.setViewportSize({width,height:900});await p.evaluate(view=>go(view),view);
            assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,view+" "+theme+" "+width);
            assert.ok(!(await p.locator("#content").innerText()).includes('เธเธ'),view+" readable Thai");
            if (width===390) {
              await p.screenshot({path:`artifacts/php-public-${view}-${theme}-mobile.png`,fullPage:true});
            }
          }
        }
      }
    }finally{await anon.close();}
  });
  await check("release keeps configuration, credentials, schema and private files outside public web paths",async()=>{
    for(const path of ["/gecc-private/accounts.json","/gecc-private/setup-token.txt","/sskgecc/.env","/sskgecc/php/schema.sql","/sskgecc/server/app.js"])
      assert.equal((await fetch(origin+path)).status,404,path);
    assert.equal((await call("state")).data.state.isSample,false);
    const smoke=await checkProduction(base);assert.equal(smoke.transport,"php");assert.equal(smoke.ok,true);
    // A fresh anonymous context must never get a role from the old demo hash.
    const context=await browser.newContext();try{
      const p=await context.newPage();await p.goto(base+"#demo-mentor");await p.waitForSelector(".summary-grid");
      assert.equal(await p.evaluate(()=>S.role),null);assert.equal(await p.evaluate(()=>localStorage.getItem(KEY)),null);
    }finally{await context.close();}
  });
  assert.deepEqual(jsErrors,[]);
  const violations=axeStates.flatMap(x=>x.violations);
  assert.deepEqual(violations,[],"PHP accessibility findings");
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/php-report.json",JSON.stringify({php:phpRun("-r",["echo PHP_VERSION;"]),database:"MariaDB 10.6.28",checks,axeStates,jsErrors},null,2));
  console.log("PHP/MariaDB integration complete; "+checks.length+" groups, "+axeStates.length+" axe states.");
} catch(e) {
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/php-failure.json",JSON.stringify({checks,axeStates,jsErrors,error:e.stack},null,2));
  await writeFile("artifacts/php-test-server.log",log);
  throw e;
} finally {
  await browser?.close();
  web?.kill();
  if(database){
    try{sql("SHUTDOWN");}catch{}
    for(let i=0;i<30&&database.exitCode===null;i++)await delay(100);
    if(database.exitCode===null)database.kill();
  }
  // Deliberately retain the isolated files for private diagnosis; no real data.
}
