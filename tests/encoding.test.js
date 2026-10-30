import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertCleanThai, hasCorruptThai } from "../deploy/encoding-check.mjs";
import { initialState } from "../server/seed.js";
import { rules, summary } from "../server/domain.js";
import { buildPhp } from "../deploy/build-php.mjs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const corrupt = text => new TextDecoder("windows-874").decode(new TextEncoder().encode(text));
test("PHP seed and criteria are clean UTF-8 and match authoritative source", async () => {
  const seed = JSON.parse(readFileSync("php/data/seed.json", "utf8"));
  const criteria = JSON.parse(readFileSync("php/data/criteria.json", "utf8"));
  assertCleanThai(seed); assertCleanThai(criteria);
  assert.deepEqual(seed, JSON.parse(JSON.stringify(await initialState())));
  assert.equal(JSON.stringify(criteria), JSON.stringify({PHYS:rules.PHYS,QC:rules.QC,NARR:rules.NARR,OUT:rules.OUT}));
  assert.throws(() => assertCleanThai({library:corrupt("เอกสารการประชุม")}));
  for (const text of ["เนื้อหาและข้อเสนอของเธอ", "ภาษาไทย ศรีสะเกษ 🏛️", "MENTOR", "https://example.org"])
    assert.equal(hasCorruptThai(text), false, text);
});

const php = resolve(process.env.PHP_BIN || "var/runtimes/php/php.exe");
test("encoding repair reverses corrupted strings only, is idempotent and preserves all values", {skip:!existsSync(php)}, () => {
  const names = ["ภญ.มัลลิกา สุพล", "ภญ.กนกวิภา ประกอบศรี", "เอกสารการประชุม", "กลุ่มที่ 1: งานปกครองอำเภอ"];
  const original = {names, id:"u01", code:"000001", date:"2026-10-28", score:240, flags:[true,false,null], correct:"ภาษาไทย 🏛️", url:"https://example.org/file.pdf"};
  const broken = {...original, names:names.map(corrupt)};
  const result = spawnSync(php,["-d","extension_dir="+resolve("var/runtimes/php/ext"),"-d","extension=mbstring","-r",
    "require 'php/encoding.php'; $v=json_decode(stream_get_contents(STDIN)); $changes=[]; $fixed=\\GECC\\repair_thai_value($v,$changes); $again=[]; \\GECC\\repair_thai_value($fixed,$again); echo json_encode([$fixed,$changes,$again],JSON_UNESCAPED_UNICODE);"],{input:JSON.stringify(broken),encoding:"utf8",windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  const [fixed,changes,again] = JSON.parse(result.stdout);
  assert.deepEqual(fixed,original); assert.equal(changes.length,names.length); assert.deepEqual(again,[]);
});

test("public chart totals use real assessment and readiness states without unit details", async () => {
  const s = await initialState();
  const a = structuredClone(rules.blankAssess()); a.started=true; a.phys[0]=true;
  a.ready={c:["y","y","y","n"],name:"ผู้ลงนาม",date:"2026-10-28"}; a.updatedAt="2026-10-28T08:00:00.000Z";
  const b = structuredClone(a); b.phys.fill(true); b.qc.forEach(q=>q.score=10); b.narr.forEach(q=>q.score=10);
  for(const key of ["o11","o12","o13","o14","c22"]) b.out[key]=1;
  b.out.c21[0]=true;b.out.t3[0]=true;b.ready.c.fill("y");
  s.assess={u01:a,u02:b};
  const got=summary(s);
  assert.deepEqual(got.submission,{done:1,prog:1,none:26});
  assert.deepEqual(got.readiness,{ready:1,notready:1,draft:0,none:26});
  assert.equal(got.lastUpdatedAt,a.updatedAt);
  assert.ok(!JSON.stringify(got).includes("u01"));
});

test("update bundle versions assets and excludes setup, credentials and live backups", async () => {
  const root=await mkdtemp(join(tmpdir(),"gecc-update-"));
  try {
    const release=await buildPhp(join(root,"release"),{updateOnly:true});
    const files=await readdir(release.privateDir);
    for(const name of ["config.local.php","config.example.php","accounts.json","files","backups","installed.lock","setup-token.txt","install.php","schema.sql"])
      assert.ok(!files.includes(name),name);
    assert.ok(!(await readdir(release.publicDir)).includes("setup.html"));
    const html=await readFile(join(release.publicDir,"index.html"),"utf8");
    const refs=[...html.matchAll(/(?:src|href)="((?:assets|shared)\/[\w/-]+\.(?:js|css))\?v=([a-f0-9]+)"/g)];
    assert.equal(refs.length,8);
    assert.ok(!(await readdir(join(release.publicDir,"assets/library"))).includes("sources.json"));
    assert.ok(!html.includes("geccssk2027"));
    assert.ok(!html.includes("1wjorBuZYDM3ZOjo44cnxPtchOMnPixBR"));
    for(const [,path,hash] of refs)
      assert.equal(hash,createHash("sha256").update(await readFile(join(release.publicDir,path))).digest("hex").slice(0,12),path);
    assert.match(await readFile(join(release.publicDir,"assets/runtime.js"),"utf8"),/GECC_API_STYLE="php"/);
  } finally {await rm(root,{recursive:true,force:true});}
});
