import * as THREE from 'three';
globalThis.document = { createElement(){ return { width:0,height:0,getContext(){ return new Proxy({}, { get: () => () => {} }); } }; } };
const { buildWorld, raycastWalls } = await import('/root/work/fps/game/js/world.js');
const { resolveShot } = await import('/root/work/fps/game/js/combat.js');
const w = buildWorld(new THREE.Scene());

const from = new THREE.Vector3(-19.8, 1.62, 18.1);
const to = new THREE.Vector3(-5.5, 1.25, -5.6);
const dir = to.clone().sub(from).normalize();
const dist = to.distanceTo(from);
const wall = raycastWalls(from, dir, dist, w.colliders);
console.log('dist', dist.toFixed(2), 'wall hit at', wall.toFixed(2), wall < dist ? 'BLOCKED (ok)' : 'CLEAR (bug?)');

const target = { alive: true, root: { position: new THREE.Vector3(-5.5, 0, -5.6) }, team: 'defender' };
const shooter = { alive: true, root: { position: from.clone() } };
const hit = resolveShot(from, dir, 90, [target], w.colliders, shooter);
console.log('resolveShot char?', !!hit.char, 'dist', hit.dist.toFixed(2));
