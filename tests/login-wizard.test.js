import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const roster=JSON.parse(readFileSync(new URL('../shared/roster-2570.json',import.meta.url),'utf8'));
function wizard(overrides={}){
  const content={innerHTML:''};
  const state={entryPath:null,entryTeam:null,...overrides};
  const context={S:state,DB:roster,MENTOR_ADVISORS:roster.publicContent.mentorAdvisors,
    window:{GECC_SERVER:false},esc:String,ic:()=>'',setCollectionHead:()=>{},
    $:selector=>selector==='#content'?content:{focus:()=>{}},
    groupChoice:t=>`<button data-act="entry-team" data-team="${t.id}">${t.name}</button>`,
    personCard:(p,opts)=>`<button data-act="${opts.action}" data-index="${opts.index}">${p.name}</button>`};
  const from=html.indexOf('function loginChoices(){');
  assert.ok(from>=0,'wizard entry point exists');
  const peopleFrom=html.indexOf('function viewPortfolioEntry(team){');
  vm.runInNewContext(html.slice(from,html.indexOf('/* ================= Shared widgets',from))+'\n'+html.slice(peopleFrom,html.indexOf('function modList(){',peopleFrom)),context);
  context.viewPortfolio();
  return {context,content,state};
}
test('login begins with only the three requested channels',()=>{
  const {content}=wizard();
  assert.equal((content.innerHTML.match(/data-act="entry-path"/g)||[]).length,3);
  for(const name of ['ที่ปรึกษา MENTOR','MENTOR','หน่วยบริการที่สมัคร'])assert.ok(content.innerHTML.includes(name));
  assert.equal((content.innerHTML.match(/data-act="entry-team"/g)||[]).length,0);
});
test('advisors use six supplied names in order without assigning numbered groups',()=>{
  const {content}=wizard({entryPath:'advisor'});
  let at=-1;
  for(const person of roster.publicContent.mentorAdvisors){const next=content.innerHTML.indexOf(person.name);assert.ok(next>at,person.name);at=next;}
  assert.equal((content.innerHTML.match(/data-act="entry-person"/g)||[]).length,6);
  assert.equal((content.innerHTML.match(/data-act="entry-team"/g)||[]).length,0);
});
test('mentor and agency channels advance group then full group roster',()=>{
  for(const path of ['mentor','mentee']){
    const {content}=wizard({entryPath:path});
    assert.equal((content.innerHTML.match(/data-act="entry-team"/g)||[]).length,6);
    for(const team of roster.teams){
      const {content}=wizard({entryPath:path,entryTeam:team.id});
      const people=path==='mentor'?team.members:roster.units.filter(u=>u.team===team.id);
      for(const person of people)assert.ok(content.innerHTML.includes(person.name),person.name);
      assert.equal((content.innerHTML.match(new RegExp(`data-act="${path==='mentor'?'entry-person':'entry-unit'}"`,'g'))||[]).length,people.length);
      assert.equal((content.innerHTML.match(/data-act="entry-team"/g)||[]).length,0);
    }
  }
});
test('production waits for authoritative login options, with a retry on failure',()=>{
  const {context,content}=wizard({entryPath:'mentee',entryTeam:1});
  context.window.GECC_SERVER=true;context.window.GECCPublic={loginOptions:null,loginError:'unavailable'};
  context.viewPortfolio();
  assert.equal((content.innerHTML.match(/data-act="entry-unit"/g)||[]).length,0);
  assert.ok(content.innerHTML.includes('entry-retry'));
});
