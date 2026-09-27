import assert from 'node:assert/strict';
import sharp from 'sharp';
if (process.env.STAGING_MEDIA_PROBE !== '1') throw new Error('Explicit staging probe guard required.');
const legacy=process.env.STAGING_LEGACY_TAPESTRY==='1';
const session=legacy ? 'hb590-legacy-recovery' : 'hb590-synthetic-registry-probe-'+Date.now();
const base='http://hb-live-staging-tapestry:3100/tapestry/sessions/'+session;
const headers={'x-tapestry-internal-secret':process.env.TAPESTRY_INTERNAL_SECRET};
const jpeg=await sharp({create:{width:160,height:160,channels:3,background:{r:30,g:200,b:20}}}).jpeg().toBuffer();
const upload=()=>fetch(base+'/participants/synthetic-swatch/frame',{method:'POST',headers:{...headers,'content-type':'image/jpeg'},body:jpeg});
if (legacy) {
  assert.equal((await fetch(base+'/participants/synthetic-swatch/frame',{method:'POST',headers:{'content-type':'image/jpeg'},body:jpeg})).status,401);
} else {
  assert.equal((await fetch(base,{method:'PUT'})).status,401);
  assert.equal((await upload()).status,404);
  assert.equal((await fetch(base,{method:'PUT',headers})).status,200);
}
const initial=await upload();
assert.equal(initial.status,201);
if (!legacy) assert.equal((await initial.json()).state,'composing');
const composite=await fetch(base+'/composite.jpg',{headers});
assert.equal(composite.status,200);
const bytes=Buffer.from(await composite.arrayBuffer());
const stats=await sharp(bytes).stats();
assert.ok(stats.channels[1].mean>stats.channels[0].mean);
const repeated=await upload();
assert.equal(repeated.status,200);
if (!legacy) assert.equal((await repeated.json()).state,'published');
const layout=await (await fetch(base+'/layout',{headers})).json();
assert.equal(layout.cells.length,1);
console.log(JSON.stringify({status:'passed',mode:legacy?'legacy-explicit-seed':'dynamic-registration',unauthorized:401,initialUnknownSession:legacy?null:404,registration:legacy?null:200,ingest:201,composite:200,repeatIngest:200,visibleCells:layout.cells.length,compositeBytes:bytes.length}));
