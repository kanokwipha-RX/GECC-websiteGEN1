import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {testDatabase} from './postgres.js';
import {createApp} from '../server/app.js';
import {migrate} from '../server/store.js';

let pool,server,base;
const state={
  units:Array.from({length:32},(_,i)=>({id:`u${i+1}`,code:`999${String(i+1).padStart(3,'0')}`,name:`Test organization ${i+1}`,team:i%6+1,privateNote:'private-unit'})),
  teams:Array.from({length:6},(_,i)=>({id:i+1,members:Array.from({length:4},(_,j)=>({name:`Mentor ${i+1}:${j+1}`,pos:'Test position',photo:'assets/test.jpg',phone:'private-phone'}))})),
  publicContent:{mentorAdvisors:Array.from({length:6},(_,i)=>({name:`Advisor ${i+1}`,title:'Test title',role:'ที่ปรึกษา MENTOR',photo:'assets/advisor.jpg',email:'private-email'}))},
  assess:{u1:{text:'private-assessment'}},pins:{unit:'secret-pin'},
};
const accounts=[
  {username:'unit-custom-login',name:'Old organization display name',role:'mentee',unit_id:'u1'},
  {username:'unit-disabled',name:'Disabled unit',role:'mentee',unit_id:'u2',active:false},
  {username:'unit-duplicate-a',name:'Duplicate unit',role:'mentee',unit_id:'u3'},
  {username:'unit-duplicate-b',name:'Duplicate unit',role:'mentee',unit_id:'u3'},
  {username:'mentor-exact-login',name:'Mentor 1:1',role:'mentor',team:1},
  {username:'mentor-old-name',name:'Mentor 1:2 old surname',role:'mentor',team:1},
  {username:'mentor-wrong-group',name:'Mentor 1:3',role:'mentor',team:2},
  {username:'mentor-disabled',name:'Mentor 1:4',role:'mentor',team:1,active:false},
  {username:'mentor-duplicate-a',name:'Mentor 2:1',role:'mentor',team:2},
  {username:'mentor-duplicate-b',name:'Mentor 2:1',role:'mentor',team:2},
  {username:'mentor-wrong-role',name:'Mentor 2:2',role:'coord'},
  {username:'advisor-existing-coord',name:'Advisor 1',role:'coord'},
  {username:'advisor-existing-mentor',name:'Advisor 2',role:'mentor',team:5},
  {username:'advisor-duplicate-a',name:'Advisor 3',role:'mentor',team:3},
  {username:'advisor-duplicate-b',name:'Advisor 3',role:'coord'},
  {username:'advisor-disabled',name:'Advisor 4',role:'coord',active:false},
  {username:'advisor-wrong-role',name:'Advisor 5',role:'mentee',unit_id:'deleted-unit'},
  {username:'advisor-old-name',name:'Advisor 6 old surname',role:'coord'},
].map((a,i)=>({id:`private-account-${i}`,password_hash:'private-password-hash',unit_id:null,team:null,active:true,...a}));

before(async()=>{
  pool=await testDatabase();await migrate(pool);
  await pool.query('INSERT INTO app_state(id,document) VALUES(1,$1)',[JSON.stringify(state)]);
  for(const a of accounts)await pool.query('INSERT INTO accounts(id,username,name,password_hash,role,unit_id,team,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,a.username,a.name,a.password_hash,a.role,a.unit_id,a.team,a.active]);
  server=createApp({pool,origin:'http://127.0.0.1',basePath:'/sskgecc'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  base=`http://127.0.0.1:${server.address().port}/sskgecc`;
});
after(async()=>{await new Promise(r=>server.close(r));await pool.end();});
async function options(){const res=await fetch(base+'/api/public/login-options');assert.equal(res.status,200);return {res,data:await res.json()};}

test('anonymous login options project 32 units, 24 mentors and 6 advisors with only approved fields',async()=>{
  const {res,data}=await options();
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.deepEqual(Object.keys(data).sort(),['advisors','mentors','units']);
  assert.equal(data.units.length,32);assert.equal(data.mentors.length,24);assert.equal(data.advisors.length,6);
  assert.deepEqual(Object.keys(data.units[0]).sort(),['id','name','team','username']);
  assert.deepEqual(Object.keys(data.mentors[0]).sort(),['name','photo','pos','team','username']);
  assert.deepEqual(Object.keys(data.advisors[0]).sort(),['name','photo','role','title','username']);
  assert.doesNotMatch(JSON.stringify(data),/private-|password_hash|secret-pin|must_change|unit_id/);
  assert.equal(data.units[0].username,'unit-custom-login');
  assert.equal(data.mentors[0].username,'mentor-exact-login');
  assert.equal(data.advisors[0].username,'advisor-existing-coord');
  assert.equal(data.advisors[1].username,'advisor-existing-mentor');
});

test('disabled, duplicate, renamed, wrong-role and wrong-group accounts never create username hints',async()=>{
  const {data}=await options();
  for(const unit of data.units.slice(1))assert.equal(unit.username,'',unit.name);
  for(const mentor of data.mentors.slice(1))assert.equal(mentor.username,'',mentor.name);
  for(const advisor of data.advisors.slice(2))assert.equal(advisor.username,'',advisor.name);
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM accounts')).rows[0].n,accounts.length);
  assert.deepEqual((await pool.query('SELECT document FROM app_state WHERE id=1')).rows[0].document,state);
});

test('login options only allow GET and do not establish a session',async()=>{
  const denied=await fetch(base+'/api/public/login-options',{method:'POST',headers:{Origin:'http://127.0.0.1'}});
  assert.equal(denied.status,401);
  const {res}=await options();assert.equal(res.headers.get('set-cookie'),null);
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM sessions')).rows[0].n,0);
});

test('explicit advisor usernames select the configured separate account and never fall back',async()=>{
  const configured=structuredClone(state);
  const bindings=['advisor-separate','advisor-missing','advisor-wrong-person','advisor-inactive','advisor-unit-role',''];
  configured.publicContent.mentorAdvisors.forEach((p,i)=>p.loginUsername=bindings[i]);
  const extra=[
    {username:'advisor-separate',name:'Advisor 1',role:'mentor',team:1},
    {username:'advisor-wrong-person',name:'Different person',role:'coord'},
    {username:'advisor-inactive',name:'Advisor 4',role:'coord',active:false},
    {username:'advisor-four-old-enabled',name:'Advisor 4',role:'coord'},
    {username:'advisor-unit-role',name:'Advisor 5',role:'mentee',unit_id:'u5'},
    {username:'advisor-five-old-enabled',name:'Advisor 5',role:'mentor',team:5},
    {username:'advisor-six-old-enabled',name:'Advisor 6',role:'coord'},
  ].map((a,i)=>({id:`configured-account-${i}`,unit_id:null,team:null,active:true,...a}));
  try{
    for(const a of extra)await pool.query('INSERT INTO accounts(id,username,name,password_hash,role,unit_id,team,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,a.username,a.name,'private-password-hash',a.role,a.unit_id,a.team,a.active]);
    await pool.query('UPDATE app_state SET document=$1 WHERE id=1',[JSON.stringify(configured)]);
    const {data}=await options();
    assert.equal(data.advisors[0].username,'advisor-separate');
    assert.deepEqual(data.advisors.slice(1).map(p=>p.username),['','','','','']);
    assert.ok(data.advisors.every(p=>!Object.hasOwn(p,'loginUsername')));
    assert.equal((await pool.query("SELECT role FROM accounts WHERE username='advisor-existing-coord'")).rows[0].role,'coord');
  }finally{
    await pool.query('UPDATE app_state SET document=$1 WHERE id=1',[JSON.stringify(state)]);
    for(const a of extra)await pool.query('DELETE FROM accounts WHERE id=$1',[a.id]);
  }
});

test('PHP anonymous login options agree with Node projection when a PHP runtime is available',async t=>{
  const bundled=resolve('var/runtimes/php/php.exe');
  const php=process.env.PHP_BIN||(existsSync(bundled)?bundled:'php');
  const available=spawnSync(php,['-v'],{encoding:'utf8',windowsHide:true});
  if(available.error?.code==='ENOENT')return t.skip('PHP runtime unavailable; Node result does not certify PHP');
  assert.equal(available.status,0,available.stderr);
  const code=`namespace GECC;
    $input=json_decode(stream_get_contents(STDIN));
    function state(){global $input;return [$input->state,1];}
    function query($sql){global $input;if($sql!=='SELECT username,name,role,unit_id,team FROM gecc_accounts WHERE active=1')throw new \\RuntimeException('Unexpected account projection');return new class($input->accounts){public function __construct(private $rows){} public function fetchAll(){return array_map(fn($a)=>(array)$a,array_values(array_filter($this->rows,fn($a)=>$a->active)));}};}
    function reply($v){echo json_encode($v,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);exit;}
    require ${JSON.stringify(resolve('php/public-features.php').replaceAll('\\','/'))};
    feature_routes('public/login-options','GET',null);`;
  const run=fixture=>{
    const result=spawnSync(php,['-r',code],{input:JSON.stringify({state:fixture,accounts}),encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(run(state),(await options()).data);
  const configured=structuredClone(state);
  const bindings=['advisor-existing-coord','advisor-does-not-exist','advisor-duplicate-b','advisor-disabled','advisor-wrong-role','advisor-old-name'];
  configured.publicContent.mentorAdvisors.forEach((p,i)=>p.loginUsername=bindings[i]);
  try{
    await pool.query('UPDATE app_state SET document=$1 WHERE id=1',[JSON.stringify(configured)]);
    const projected=run(configured);
    assert.deepEqual(projected,(await options()).data);
    assert.deepEqual(projected.advisors.map(p=>p.username),['advisor-existing-coord','','advisor-duplicate-b','','','']);
  }finally{await pool.query('UPDATE app_state SET document=$1 WHERE id=1',[JSON.stringify(state)]);}
  assert.ok(readFileSync('php/api.php','utf8').includes("if (str_starts_with($route,'public/')||$route==='library') feature_routes($route,$method,$session);"));
});
