import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {validateContent} from '../server/policy.js';

const html=readFileSync('index.html','utf8');
test('an empty or partially reviewed group is never reported as all physical criteria passed',()=>{
  const context={ic:()=>'',result:null};vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function physicalEmptyHTML('),html.indexOf('function physMissModal('))+';this.render=physicalEmptyHTML;',context);
  const passed={a:{started:true,phys:Array(15).fill(true)}};
  for(const rows of [[],[{}],[passed,{}]])assert.ok(!context.render(rows).includes('ทุกหน่วยบริการผ่าน'));
  assert.match(context.render([passed]),/ทุกหน่วยบริการผ่านกายภาพครบ 15 ข้อ/);
  assert.ok(!context.render([passed,{}],0).includes('ทุกหน่วยบริการผ่าน'));
});

test('HTML challenges and malformed JSON produce Thai recovery messages without replaying writes',async()=>{
  const source=readFileSync('assets/server-client.js','utf8');
  for(const response of [new Response('<!DOCTYPE html>',{headers:{'Content-Type':'text/html'}}),new Response('{broken',{headers:{'Content-Type':'application/json'}}),new Response('<html>upstream failed</html>',{status:503,headers:{'Content-Type':'text/html'}}),new Response('{broken',{status:500,headers:{'Content-Type':'application/json'}})]){
    let calls=0;
    const context={window:{GECC_SERVER:true,GECC_API_STYLE:'php',GECC_BASE_PATH:'/sskgecc/'},Blob,clone:x=>x,fetch:async()=>{calls++;return response;}};
    vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf('  function accept('))+'return {request};})();',context);
    await assert.rejects(context.window.GECCClient.request('/api/state',{method:'PUT',body:'{}'}),e=>e.status===502&&/ข้อมูลร่างยังไม่ถูกบันทึก/.test(e.message)&&!e.message.includes('Unexpected token'));
    assert.equal(calls,1);
  }
});

test('survey links use the supplied default and validate configured destinations',()=>{
  const source=readFileSync('assets/public-features.js','utf8');
  const context={DB:{publicContent:{}},URL,safe:x=>String(x).replaceAll('&','&amp;').replaceAll('"','&quot;')};vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function surveyLinkHTML('),source.indexOf('  function decorate(')),context);
  for(const value of ['',undefined]){context.DB.publicContent.surveyUrl=value;assert.match(context.surveyLinkHTML(),/href="https:\/\/gecc-survey\.vercel\.app\/s\/demo-amphoe-a"/);}
  for(const value of ['javascript:alert(1)','https://user:password@example.org/']){context.DB.publicContent.surveyUrl=value;assert.match(context.surveyLinkHTML(),/disabled/);}
  context.DB.publicContent.surveyUrl='https://example.org/survey';assert.match(context.surveyLinkHTML(),/href="https:\/\/example.org\/survey"/);
  const base={library:[],committee:[],duties:[],advisor:{photo:''}};
  assert.throws(()=>validateContent({...base,surveyUrl:'javascript:alert(1)'}));
  assert.doesNotThrow(()=>validateContent({...base,surveyUrl:'https://example.org/survey'}));
});
