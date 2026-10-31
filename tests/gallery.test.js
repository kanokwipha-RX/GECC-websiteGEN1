import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const source=readFileSync('assets/public-features.js','utf8');
const prelude=source.slice(0,source.indexOf('  function embed('))+'return {load,defaults};})();';
const serverDefaults=JSON.parse(readFileSync('php/data/content-defaults.json','utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
function preview(saved){
  const sandbox={window:{},DB:{publicContent:saved},MENTOR_ADVISORS:[],esc:String};
  vm.runInNewContext(prelude,sandbox);
  return sandbox.window.GECCPublic;
}

test('Gallery defaults include all 42 supplied photos in numeric order and retain existing videos',()=>{
  const browserDefaults=plain(preview().defaults);
  assert.deepEqual(browserDefaults,serverDefaults);
  const [album]=browserDefaults.albums;
  assert.equal(album.title,'กิจกรรม GECC · 29 ตุลาคม 2569');
  assert.equal(album.date,'2026-10-29');
  assert.equal(album.status,'published');
  assert.equal(album.images.length,42);
  assert.equal(readdirSync('assets/gallery').length,42);
  const indices=album.images.map(im=>+im.src.match(/-(\d+)\.jpg$/)[1]);
  assert.deepEqual(indices,[1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,41,42,43,48]);
  for(const [i,image] of album.images.entries()){
    assert.match(image.alt,new RegExp(`ภาพที่ ${i+1}$`));
    const bytes=readFileSync(image.src);
    assert.equal(bytes[0],0xff);
    assert.equal(bytes[1],0xd8);
  }
  assert.equal(browserDefaults.videos.length,6);
  assert.equal(browserDefaults.videos.filter(v=>v.category==='activity').length,0);
});

test('local Gallery adds supplied album without changing or duplicating saved albums',async()=>{
  const saved={albums:[{title:'อัลบั้มของผู้ประสานงาน',date:'2026-10-30',status:'draft',images:[]}],videos:[]};
  const before=JSON.stringify(saved);
  const c=plain(await preview(saved).load());
  assert.equal(JSON.stringify(saved),before);
  assert.deepEqual(c.albums[0],saved.albums[0]);
  assert.deepEqual(c.albums[1],serverDefaults.albums[0]);
  assert.deepEqual(c.videos,[]);
  const updated={...serverDefaults.albums[0],description:'คำอธิบายที่ผู้ประสานงานบันทึกไว้',status:'draft'};
  const existing=plain(await preview({albums:[updated]}).load());
  assert.deepEqual(existing.albums,[updated]);
});

test('Gallery originals are preserved byte for byte when source folder is available',t=>{
  let files;
  try{files=readdirSync('../Gallery 29 ตุลาคม 2569').filter(f=>f.endsWith('.jpg'));}
  catch{return t.skip('Original photo folder is outside the repository');}
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(files.length,42);
  for(const name of files){
    const index=String(+name.match(/\((\d+)\)/)[1]).padStart(2,'0');
    assert.equal(digest(readFileSync(`../Gallery 29 ตุลาคม 2569/${name}`)),digest(readFileSync(`assets/gallery/gallery-2026-10-29-${index}.jpg`)));
  }
});
