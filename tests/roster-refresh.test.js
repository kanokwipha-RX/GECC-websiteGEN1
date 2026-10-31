import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
const source=readFileSync('index.html','utf8');
const roster=JSON.parse(readFileSync('shared/roster-2570.json','utf8'));
const legacy=JSON.parse(readFileSync('php/data/content-refresh-baseline.json','utf8'));
function model(){
  const context={};
  vm.runInNewContext(source.slice(source.indexOf('const GROUP_PHOTOS ='),source.indexOf('const DISTRICT_OPTS ='))+'\n'+source.slice(source.indexOf('function defaultTeams(){'),source.indexOf('function sampleDB(){'))+'\nthis.model={blankDB,migrate};',context);
  return context.model;
}
test('fresh browser roster uses all32 stable codes and authoritative mentor names/photos',()=>{
  const db=model().blankDB();
  assert.equal(db.units.length,32);
  assert.deepEqual(JSON.parse(JSON.stringify(db.units)),roster.units);
  for(const team of db.teams)assert.deepEqual(JSON.parse(JSON.stringify(team.members)),roster.teams.find(t=>t.id===team.id).members);
  assert.deepEqual(db.units.reduce((counts,u)=>(counts[u.team-1]++,counts),[0,0,0,0,0,0]),[6,6,5,5,5,5]);
});
test('existing browser migration preserves all assessments, code bindings and customized people',()=>{
  const db=structuredClone(legacy);
  db.assess={u10:{inspectors:['ผู้ตรวจเดิม'],text:'ข้อมูลจริง',score:247,wf:{status:'reviewed',log:[{by:'ผู้ตรวจเดิม'}]}}};
  db.defects=[{id:'existing',unitId:'u10',detail:'ต้องคงไว้'}];
  const before=JSON.stringify({assess:db.assess,defects:db.defects});
  db.teams[3].members=[{name:'รายชื่อที่ผู้ใช้กำหนดเอง',photo:'assets/custom.jpg'}];
  model().migrate(db);
  assert.equal(db.units.length,32);
  assert.equal(JSON.stringify({assess:db.assess,defects:db.defects}),before);
  for(const u of legacy.units){const after=db.units.find(x=>x.id===u.id);assert.equal(after.code,u.code);}
  for(const [id,team] of [['u10',6],['u15',5],['u24',3]])assert.equal(db.units.find(u=>u.id===id).team,team);
  assert.equal(db.teams[3].members[0].name,'รายชื่อที่ผู้ใช้กำหนดเอง');
  const after=JSON.stringify(db);model().migrate(db);assert.equal(JSON.stringify(db),after,'migration is idempotent');
});
