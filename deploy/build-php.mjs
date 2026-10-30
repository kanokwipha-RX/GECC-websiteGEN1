import { cp, mkdir, readFile, writeFile, access, chmod, unlink } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { rules } from "../server/domain.js";
import { initialState } from "../server/seed.js";
import { assertCleanThai } from "./encoding-check.mjs";
process.umask(0o077);
function windowsPrivate(path, directory) {
  if(process.platform!=="win32")return;
  const user=(process.env.USERDOMAIN?process.env.USERDOMAIN+"\\":"")+process.env.USERNAME;
  execFileSync("icacls",[path,"/inheritance:r","/grant:r",user+":"+(directory?"(OI)(CI)":"")+"F","SYSTEM:"+(directory?"(OI)(CI)":"")+"F"],{windowsHide:true});
}
export async function buildPhp(output, {updateOnly=false} = {}) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  output = resolve(output || join(root, "var/releases/gecc-php-" + new Date().toISOString().replace(/[:.]/g,"-")));
  try { await access(output); throw new Error("Output already exists; choose a fresh folder to preserve credentials."); }
  catch(e) { if (e.code !== "ENOENT") throw e; }
  const publicDir = join(output, "public"), privateDir = join(output, "gecc-private");
  await mkdir(output, { recursive:true, mode:0o700 });
  windowsPrivate(output,true);
  const excluded = new Set(["config.local.php","accounts.json","setup-token.txt","installed.lock","files","backups",
    ...(updateOnly ? ["config.example.php","install.php","schema.sql","manage.php"] : [])]);
  await cp(join(root,"php"), privateDir, { recursive:true, filter: path => !excluded.has(basename(path)) });
  if (updateOnly) {
    await mkdir(publicDir,{recursive:true});
    await cp(join(root,"php-public/.htaccess"),join(publicDir,".htaccess"));
  } else await cp(join(root,"php-public"), publicDir, { recursive:true });
  for (const path of ["index.html","assets","shared"]) await cp(join(root,path), join(publicDir,path), {recursive:true});
  await unlink(join(publicDir,"assets/library/sources.json"));
  await writeFile(join(publicDir,"assets/runtime.js"),
    (await readFile(join(root,"assets/runtime.js"),"utf8"))+'\nwindow.GECC_API_STYLE="php";\n');
  let html = await readFile(join(publicDir,"index.html"),"utf8");
  for (const match of html.matchAll(/(?:src|href)="((?:assets|shared)\/[\w/-]+\.(?:js|css))"/g)) {
    const hash = createHash("sha256").update(await readFile(join(publicDir,match[1]))).digest("hex").slice(0,12);
    html = html.replaceAll('"'+match[1]+'"','"'+match[1]+'?v='+hash+'"');
  }
  // Production publishes no Library folder URLs or shared password in page source.
  html=html.replace(/const LIBRARY_ROOT = [^;]+;/, 'const LIBRARY_ROOT = "";')
    .replace(/const LIBRARY_FOLDERS = \[[\s\S]*?\n\];/, 'const LIBRARY_FOLDERS = [];')
    .replaceAll("geccssk2027", "DEMO_ONLY_NOT_A_PRODUCTION_PASSWORD");
  await writeFile(join(publicDir,"index.html"),html);
  await mkdir(join(privateDir,"data"), {recursive:true});
  const criteria = {PHYS:rules.PHYS,QC:rules.QC,NARR:rules.NARR,OUT:rules.OUT};
  const seed = await initialState();
  assertCleanThai(criteria,"criteria"); assertCleanThai(seed,"seed");
  await writeFile(join(privateDir,"data/criteria.json"), JSON.stringify(criteria));
  await writeFile(join(privateDir,"data/seed.json"), JSON.stringify(seed));
  if (!updateOnly) {
  const token = randomBytes(32).toString("hex");
  const template = await readFile(join(privateDir,"config.example.php"),"utf8");
  await writeFile(join(privateDir,"config.example.php"),template.replace("BUILD_INSERTS_TOKEN_HASH",createHash("sha256").update(token).digest("hex")),{mode:0o600});
  await writeFile(join(privateDir,"setup-token.txt"), token+"\n",{flag:"wx",mode:0o600});
  }
  await writeFile(join(output,"README-DEPLOY.txt"),
    (updateOnly ? "UPDATE ONLY: back up existing site, database and private files first. Do not reinstall or reset data.\nUpload public CONTENTS to existing public_html/sskgecc; gecc-private CONTENTS to existing private directory.\nPreserve config.local.php, accounts.json, installed.lock and files/. Follow RELEASE-CONTENT-V2-TH.md: remove legacy public assets/library/sources.json, configure library_password_hash privately, then run php gecc-private/migrate-content.php --apply. Sign in as coordinator, open Settings > ตรวจและซ่อมภาษาไทย, preview and confirm.\n" : "Upload public contents to public_html/sskgecc; upload gecc-private OUTSIDE public_html.\n"+
    "Copy private config.example.php to config.local.php and fill hosting database credentials.\n"+
    "CLI: php gecc-private/manage.php check; php gecc-private/manage.php install --apply.\n"+
    "No SSH: temporarily enable allow_web_setup, open HTTPS /sskgecc/setup.html, supply setup-token.txt.\n"+
    "After success disable allow_web_setup and remove public setup.html. Passwords stay in private accounts.json.\n"+
    "Never upload the whole release folder into public_html. See PHP-DEPLOYMENT-TH.md in source.\n"),{mode:0o600});
  await cp(join(root,"PHP-DEPLOYMENT-TH.md"),join(output,"PHP-DEPLOYMENT-TH.md"));
  await cp(join(root,"RELEASE-CONTENT-V2-TH.md"),join(output,"RELEASE-CONTENT-V2-TH.md"));
  return {output,publicDir,privateDir};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),r=await buildPhp(args.find(a=>!a.startsWith("--")),{updateOnly:args.includes("--update")});
    if(args.includes("--zip")){
      const zip=r.output+".zip";
      if(process.platform==="win32")execFileSync("tar",["-a","-cf",zip,"-C",r.output,"."],{windowsHide:true});
      else execFileSync("zip",["-qr",zip,"."],{cwd:r.output});
      await chmod(zip,0o600);windowsPrivate(zip,false);
      console.log("Private deployment ZIP: "+zip);
    }
    console.log("PHP release prepared: "+r.output+"\nNo production data or existing account file included.");
  }
  catch(e){console.error(e.message);process.exitCode=1;}
}
