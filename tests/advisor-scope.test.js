import test from 'node:test';
import assert from 'node:assert/strict';
import {allowed,project} from '../server/policy.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('explicit team0 reviewer sees all six groups while ordinary/null scopes remain restricted',()=>{
 const state=JSON.parse(readFileSync('php/data/seed.json','utf8'));
 const reviewer={role:'mentor',team:0};
 assert.equal(project(state,reviewer).units.length,32);
 for(const u of state.units){assert.equal(allowed(reviewer,u),true);assert.equal(allowed({role:'mentor',team:1},u),u.team===1);assert.equal(allowed({role:'mentor',team:null},u),false);}
});
test('all-group frontend review scope survives group filtering without becoming coordinator',()=>{
 const html=readFileSync('index.html','utf8');const fn=html.match(/function canAccessUnit\(u\)\{[^\n]+/)[0];
 const context={S:{role:'mentor',team:2,coord:false,allGroups:true}};vm.createContext(context);vm.runInContext(fn,context);
 for(let team=1;team<=6;team++)assert.equal(context.canAccessUnit({id:'u'+team,team}),true);
 context.S.allGroups=false;assert.equal(context.canAccessUnit({team:1}),false);assert.equal(context.canAccessUnit({team:2}),true);
});
