import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const source=readFileSync('assets/public-features.js','utf8');let calls=[];
 const context={window:{GECC_SERVER:true},S:{view:'other'},request:()=>new Promise((resolve,reject)=>calls.push({resolve,reject})),viewPortfolio:()=>{}};
 vm.createContext(context);vm.runInContext('let rosterGeneration=0,rosterLoading=false,loginOptions=null,loginUnits=null,loginError=null;'+source.slice(source.indexOf('  function resetLoginOptions()'),source.indexOf('  async function units()'))+'\nfunction result(){return {loginOptions,loginError,rosterLoading};}',context);return {context,calls};
}
test('successful cached login options refresh after content boot reset',async()=>{
 const {context:c,calls}=fixture();let pending=c.loadLoginOptions();calls[0].resolve({units:[{name:'old'}]});await pending;await c.loadLoginOptions();assert.equal(calls.length,1);
 c.resetLoginOptions();assert.equal(c.result().loginOptions,null);pending=c.loadLoginOptions();calls[1].resolve({units:[{name:'new'}]});await pending;assert.equal(c.result().loginOptions.units[0].name,'new');
});
test('older inflight metadata cannot overwrite a newer reset request',async()=>{
 const {context:c,calls}=fixture();const old=c.loadLoginOptions();c.resetLoginOptions();const current=c.loadLoginOptions();calls[1].resolve({units:[{name:'new'}]});await current;calls[0].resolve({units:[{name:'stale'}]});await old;assert.equal(c.result().loginOptions.units[0].name,'new');
});
