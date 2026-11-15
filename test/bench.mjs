import * as THREE from 'three';
globalThis.document = { createElement(){ return { width:0,height:0,getContext(){ return new Proxy({}, { get: () => () => {} }); } }; } };
const { buildWorld } = await import('/root/work/fps/game/js/world.js');
const { Bot } = await import('/root/work/fps/game/js/bots.js');
const scene = new THREE.Scene();
const world = buildWorld(scene);
const bots = [];
for (let i=0;i<7;i++){
  const b = new Bot({ team: i<3?'attacker':'defender', skill:0.6, waypoints: world.waypoints, colliders: world.colliders, spawn: (i<3?world.spawns.attackers:world.spawns.defenders)[i%4].clone(), slot:i, nav: world.nav });
  b.assignRoute(world.siteCenter); bots.push(b);
}
const ctx = { enemies(bot){ return bots.filter(x=>x.team!==bot.team); }, onBotShot(){} };
const t0=performance.now();
for (let i=0;i<1200;i++) for (const b of bots) b.update(1/120, ctx);
console.log('1200 steps x 7 bots:', (performance.now()-t0).toFixed(1),'ms → per sim-second', ((performance.now()-t0)/10).toFixed(2),'ms');
