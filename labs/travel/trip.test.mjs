import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const trip=JSON.parse(fs.readFileSync(new URL('./data/trip.json',import.meta.url)));
const places=JSON.parse(fs.readFileSync(new URL('./data/places.json',import.meta.url)));
test('three-day itinerary has sourced places and continuous road routes',()=>{
  assert.equal(trip.days.length,3);assert.equal(trip.routes.length,3);
  const ids=new Set();for(const d of trip.days){assert.equal(d.stops.length,2);const r=trip.routes.find(r=>r.day===d.day);assert.equal(r.from,d.stops[0].id);assert.equal(r.to,d.stops[1].id);
    for(const s of d.stops){assert.ok(places.some(p=>p.id===s.id));assert.ok(trip.official[s.id].startsWith('https://'));assert.ok(!ids.has(s.id));ids.add(s.id);}
    assert.ok(r.coordinates.length>20);assert.ok(r.wayIds.length>1);assert.ok(r.meters>300&&r.meters<4000);assert.ok(r.endpointGaps.every(d=>d<100));
    let meters=0;for(let i=1;i<r.coordinates.length;i++){const a=r.coordinates[i-1],b=r.coordinates[i];const m=Math.hypot((a[0]-b[0])*73200,(a[1]-b[1])*111320);assert.ok(m<250,'no long synthetic jumps');meters+=m;}assert.ok(Math.abs(meters-r.meters)<1);
  }
  assert.equal(trip.provenance.license,'ODbL');assert.ok(trip.buildings.length>100&&trip.buildings.length<=900);for(const b of trip.buildings){assert.ok(['osm-height','estimated-from-levels','illustrative-default'].includes(b.heightSource));assert.deepEqual(b.coordinates[0],b.coordinates.at(-1));}
});
