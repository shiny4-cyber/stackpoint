// Weapons, characters and hitscan. Kept engine-agnostic so bots and the player share it.
import * as THREE from 'three';
import { raycastWalls } from './world.js';

export const WEAPONS = {
  p9: { id: 'p9', name: 'P9 Sidearm', price: 0, dmg: 24, rpm: 400, mag: 12, reserve: 36, spread: 0.011, recoil: 0.010, auto: false, range: 70, reload: 1.35 },
  vx9: { id: 'vx9', name: 'VX-9 SMG', price: 1250, dmg: 20, rpm: 850, mag: 25, reserve: 75, spread: 0.017, recoil: 0.008, auto: true, range: 55, reload: 1.9 },
  ar4: { id: 'ar4', name: 'AR-4 Rifle', price: 2700, dmg: 33, rpm: 600, mag: 30, reserve: 90, spread: 0.010, recoil: 0.014, auto: true, range: 90, reload: 2.2 },
};

export const ARMOR_PRICE = 650;

const GEO = {
  torso: new THREE.BoxGeometry(0.52, 0.72, 0.3),
  hips: new THREE.BoxGeometry(0.46, 0.42, 0.28),
  head: new THREE.BoxGeometry(0.26, 0.26, 0.26),
  arm: new THREE.BoxGeometry(0.14, 0.62, 0.14),
  leg: new THREE.BoxGeometry(0.18, 0.74, 0.2),
  gun: new THREE.BoxGeometry(0.1, 0.12, 0.62),
};

const MATERIALS = new Map();
function teamMaterials(team) {
  if (!MATERIALS.has(team)) {
    MATERIALS.set(team, {
      cloth: new THREE.MeshStandardMaterial({ color: team === 'attacker' ? 0x8a5a20 : 0x2c4a6b, roughness: 0.8 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x9a7b62, roughness: 0.7 }),
      gear: new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.9, metalness: 0.1 }),
    });
  }
  return MATERIALS.get(team);
}

export function createCharacter(team) {
  const body = new THREE.Group();
  const { cloth, skin, gear } = teamMaterials(team);

  const torso = new THREE.Mesh(GEO.torso, cloth); torso.position.y = 1.24;
  const hips = new THREE.Mesh(GEO.hips, gear); hips.position.y = 0.78;
  const head = new THREE.Mesh(GEO.head, skin); head.position.y = 1.74; head.name = 'head';
  const armL = new THREE.Mesh(GEO.arm, cloth); armL.position.set(-0.33, 1.2, 0);
  const armR = new THREE.Mesh(GEO.arm, cloth); armR.position.set(0.33, 1.2, 0);
  const legL = new THREE.Mesh(GEO.leg, gear); legL.position.set(-0.13, 0.37, 0);
  const legR = new THREE.Mesh(GEO.leg, gear); legR.position.set(0.13, 0.37, 0);
  const gun = new THREE.Mesh(GEO.gun, gear); gun.position.set(0.2, 1.26, -0.34);

  for (const m of [torso, hips, head, armL, armR, legL, legR, gun]) {
    m.castShadow = true;
    m.receiveShadow = true;
    body.add(m);
  }
  body.userData.head = head;
  return body;
}

// Distance along `dir` at which the ray first touches a character, or Infinity.
export function hitCharacter(origin, dir, maxDist, char, out) {
  let best = maxDist;
  let part = null;

  // vertical capsule from feet to shoulders, radius 0.34
  const base = (char.root ?? char).position;
  const y0 = base.y + 0.35;
  const y1 = base.y + 1.5;
  const ox = origin.x - base.x;
  const oz = origin.z - base.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a > 1e-9) {
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - 0.34 * 0.34;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 0 && t < best) {
        const y = origin.y + dir.y * t;
        if (y >= y0 && y <= y1) { best = t; part = 'body'; }
      }
    }
  }
  // head sphere
  const hx = base.x - origin.x;
  const hy = base.y + 1.74 - origin.y;
  const hz = base.z - origin.z;
  const b2 = hx * dir.x + hy * dir.y + hz * dir.z;
  const c2 = hx * hx + hy * hy + hz * hz - 0.2 * 0.2;
  const disc2 = b2 * b2 - c2;
  if (disc2 >= 0) {
    const t2 = b2 - Math.sqrt(disc2);
    if (t2 > 0 && t2 < best) { best = t2; part = 'head'; }
  }
  if (part) { out.part = part; return best; }
  return Infinity;
}

// Full shot resolution: wall distance first, then every character in front of it.
export function resolveShot(origin, dir, maxDist, chars, colliders, shooter) {
  const wall = raycastWalls(origin, dir, maxDist, colliders);
  const hit = { char: null, part: null, dist: wall };
  const tmp = { part: null };
  for (const c of chars) {
    if (c === shooter || !c.alive) continue;
    const d = hitCharacter(origin, dir, hit.dist, c, tmp);
    if (d < hit.dist) { hit.dist = d; hit.char = c; hit.part = tmp.part; }
  }
  return hit;
}

export function spreadDir(dir, spread, rand = Math.random) {
  const d = dir.clone().normalize();
  const r = spread * Math.sqrt(rand());
  const theta = rand() * Math.PI * 2;
  // build any orthonormal basis around d
  const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(d, up).normalize();
  const up2 = new THREE.Vector3().crossVectors(right, d).normalize();
  return d.addScaledVector(right, Math.cos(theta) * r).addScaledVector(up2, Math.sin(theta) * r).normalize();
}
