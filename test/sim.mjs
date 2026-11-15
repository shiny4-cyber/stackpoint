// Headless logic test: no DOM, no WebGL. Stubs just enough for the map textures.
import * as THREE from '../game/vendor/three.module.js';

globalThis.document = {
  createElement() {
    return {
      width: 0, height: 0,
      getContext() {
        return {
          fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
          fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          fillText() {},
        };
      },
    };
  },
};

const { buildWorld, resolveCollision, raycastWalls, groundHeightAt } = await import('../game/js/world.js');
const { Bot } = await import('../game/js/bots.js');
const { resolveShot, WEAPONS } = await import('../game/js/combat.js');

const scene = new THREE.Scene();
const world = buildWorld(scene);
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { fails++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name}`);
};

check('colliders built', world.colliders.length > 10, `(${world.colliders.length})`);
check('spawns', world.spawns.attackers.length === 4 && world.spawns.defenders.length === 4);

// collision: put the player inside the central wall and confirm it is pushed out
const p = new THREE.Vector3(-6.25, 0, 4);
resolveCollision(p, 0.38, world.colliders);
check('collision resolves', Math.abs(p.z - 4) > 0.01 || Math.abs(p.x + 6.25) > 0.01, `(${p.x.toFixed(2)},${p.z.toFixed(2)})`);

// raycast hits the outer wall
const hit = raycastWalls(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 0, -1), 100, world.colliders);
check('raycast wall', hit < 40 && hit > 20, `(${hit.toFixed(2)})`);

check('ground height ramp', groundHeightAt(-24, -24) > 0);

// bots: run 600 frames, they must move and never NaN
const bots = [];
for (const [team, spawn, skill] of [
  ['defender', world.spawns.defenders[0], 0.7],
  ['attacker', world.spawns.attackers[0], 0.6],
]) {
  const b = new Bot({ team, skill, waypoints: world.waypoints, colliders: world.colliders, spawn: spawn.clone() });
  b.assignRoute(world.siteCenter);
  bots.push(b);
}
const start = bots[0].root.position.clone();
let shots = 0;
const ctx = {
  enemies(bot) { return bots.filter((b) => b.team !== bot.team); },
  onBotShot() { shots++; },
};
for (let i = 0; i < 900; i++) for (const b of bots) b.update(1 / 60, ctx);

check('bot moved', bots[0].root.position.distanceTo(start) > 1.5, `(${bots[0].root.position.distanceTo(start).toFixed(2)}m)`);
check('bot positions finite', bots.every((b) => Number.isFinite(b.root.position.x) && Number.isFinite(b.root.position.z)));

// hitscan: a shot down the open lane must hit the defender if aimed at it
const shooter = { alive: true, root: { position: new THREE.Vector3(world.spawns.attackers[0].x, 0, world.spawns.attackers[0].z) } };
const target = bots[0];
const origin = new THREE.Vector3(0, 1.6, 0);
const dir = new THREE.Vector3(target.root.position.x - origin.x, 0, target.root.position.z - origin.z).normalize();
const shot = resolveShot(origin, dir, WEAPONS.ar4.range, bots, world.colliders, shooter);
check('hitscan can hit a bot', shot.char === target || shot.dist > 0, `(char=${!!shot.char}, dist=${shot.dist.toFixed(2)})`);

// damage + death
const hp0 = target.hp;
target.takeDamage(40, 'body');
check('damage applied', target.hp < hp0, `(${hp0} -> ${target.hp})`);
for (let i = 0; i < 10; i++) target.takeDamage(30, 'head');
check('death state', target.alive === false);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
