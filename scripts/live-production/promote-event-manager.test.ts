import assert from 'node:assert/strict';
import {test} from 'vitest';
import type pg from 'pg';
import {parsePromotion,promoteEventManager} from './promote-event-manager';
const input={staffUserId:'80000000-0000-4000-8000-000000000001',bindingId:'80000000-0000-4000-8000-000000000002',accountSubject:'synthetic-subject'};
test('private request rejects missing, extra and malformed identities',()=>{
    assert.deepEqual(parsePromotion(input),input);
    for(const v of [null,{}, {...input,email:'not-identity'}, {...input,bindingId:'-'.repeat(36)}, {...input,accountSubject:''}]) assert.throws(()=>parsePromotion(v));
});
function fixture(row:Record<string,unknown>|null){
    const queries:string[]=[];
    return {queries,db:{query:async(sql:string)=>{
        queries.push(sql);
        return sql.startsWith('SELECT')?{rows:row?[row]:[],rowCount:row?1:0}:{rows:[],rowCount:1};
    }} as unknown as pg.PoolClient};
}
test('dry-run has no mutation; replay has no duplicate audit',async()=>{
    for(const [role,result] of [['OPERATOR','would-enable'],['FACILITATOR_OP','already-enabled']]){
        const f=fixture({role});assert.equal(await promoteEventManager(f.db,input,false),result);
        assert.ok(!f.queries.some(q=>/UPDATE users|INSERT INTO/.test(q)));
        assert.equal(f.queries.at(-1),'ROLLBACK');
    }
});
test('promotion locks exact binding, updates role and audits atomically',async()=>{
    const f=fixture({role:'OPERATOR'});
    assert.equal(await promoteEventManager(f.db,input,true),'enabled');
    assert.ok(f.queries[1].includes('FOR UPDATE OF u,b'));
    assert.equal(f.queries.filter(q=>q.startsWith('UPDATE')).length,1);
    assert.equal(f.queries.filter(q=>q.startsWith('INSERT')).length,1);
    assert.equal(f.queries.at(-1),'COMMIT');
});
test('mismatch and disabled bindings fail without mutation',async()=>{
    for(const row of [null,{role:'ADMIN'},{role:'OPERATOR',disabled_at:new Date()},{role:'OPERATOR',binding_disabled:new Date()}]){
        const f=fixture(row);await assert.rejects(promoteEventManager(f.db,input,true));
        assert.equal(f.queries.at(-1),'ROLLBACK');
        assert.ok(!f.queries.some(q=>/UPDATE users|INSERT INTO/.test(q)));
    }
});
