import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeUnitCodes} from '../server/seed.js';
test('unit codes survive reordering and new codes never reuse old identities',()=>{const s={units:[{id:'u2',code:'000009'},{id:'u1',code:'000002'},{id:'new'}]};initializeUnitCodes(s);assert.deepEqual(s.units.map(u=>u.code),['000009','000002','000010']);assert.equal(s.nextUnitCode,11);});
test('duplicate unit codes fail closed',()=>assert.throws(()=>initializeUnitCodes({units:[{code:'000001'},{code:'000001'}]})));
test('unit codes retain previously reserved next number',()=>{const s={nextUnitCode:40,units:[{code:'000001'},{}]};initializeUnitCodes(s);assert.equal(s.units[1].code,'000040');});
