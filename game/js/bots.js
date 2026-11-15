// Bot AI: lane-based navigation on the waypoint graph, line-of-sight engagement,
// burst fire with skill-scaled spread and reaction time.
import * as THREE from 'three';
import { resolveCollision, raycastWalls, groundHeightAt, buildNavGraph, nearestNode, findPath } from './world.js';
import { createCharacter, WEAPONS, spreadDir } from './combat.js';

const EYE = 1.62;

// module scratch vectors: bot updates run every fixed step, so no per-frame allocation
const aimV = new THREE.Vector3();
const dirV = new THREE.Vector3();
const flatV = new THREE.Vector3();
const wish = new THREE.Vector3();
const eyeV = new THREE.Vector3();
const candV = new THREE.Vector3();
const losDir = new THREE.Vector3();

export class Bot {
  constructor({ team, skill, waypoints, colliders, spawn, slot = 0, nav }) {
    this.slot = slot;
    this.team = team;
    this.skill = skill;           // 0..1
    this.hp = 100;
    this.armor = 25;
    this.alive = true;
    this.weapon = WEAPONS[skill > 0.72 ? 'ar4' : skill > 0.45 ? 'vx9' : 'p9'];
    this.ammo = this.weapon.mag;
    this.reserve = this.weapon.reserve;
    this.reloading = 0;
    this.cooldown = 0;
    this.burst = 0;
    this.burstPause = 0;
    this.target = null;
    this.reaction = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.wp = 0;
    this.route = [];
    this.colliders = colliders;
    this.waypoints = waypoints;

    this.nav = nav || buildNavGraph(waypoints, colliders);
    this.stuck = 0;
    this.investigateT = 0;
    this.lastPos = new THREE.Vector3(spawn.x, 0, spawn.z);

    this.root = createCharacter(team);
    this.root.position.copy(spawn);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
  }

  get eye() { return new THREE.Vector3(this.root.position.x, this.root.position.y + EYE, this.root.position.z); }

  canSee(eye, targetPos, colliders) {
    losDir.copy(targetPos).sub(eye);
    const dist = losDir.length();
    if (dist < 0.001) return false;
    losDir.multiplyScalar(1 / dist);
    const wall = raycastWalls(eye, losDir, dist, colliders);
    return wall >= dist - 0.15;
  }

  assignRoute(target, holdPoint) {
    const goalPoint = holdPoint ?? target;
    const start = nearestNode(this.nav, this.root.position.x, this.root.position.z);
    const goal = nearestNode(this.nav, goalPoint.x, goalPoint.z);
    const path = findPath(this.nav, start, goal);
    // every bot gets its own small offset so a squad does not stand on one pixel
    const ox = ((this.slot % 3) - 1) * 0.9;
    const oz = (this.slot > 2 ? 1.0 : -0.6);
    this.route = (path.length ? path : [goalPoint]).map((n) => new THREE.Vector3(n.x, n.y ?? 0, n.z));
    if (holdPoint) this.route.push(new THREE.Vector3(holdPoint.x + ox, 0, holdPoint.z + oz));
    this.wp = 0;
  }

  takeDamage(amount, part) {
    if (!this.alive) return 0;
    if (globalThis.__onDamage) globalThis.__onDamage(this, amount, part);
    const mult = part === 'head' ? 4 : 1;
    let dmg = amount * mult;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return mult;
  }

  update(dt, ctx) {
    if (!this.alive) return;
    const pos = this.root.position;
    eyeV.set(pos.x, pos.y + EYE, pos.z);

    // perception is throttled: a full scan every ~90 ms, cheap distance checks in between
    this.percept = (this.percept ?? 0) - dt;
    if (this.percept <= 0) {
      this.percept = 0.08 + Math.random() * 0.04;
      const enemies = ctx.enemies(this);
      let best = null;
      let bestD = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        const ep = e.root.position;
        const d = Math.hypot(ep.x - pos.x, ep.z - pos.z);
        if (d > 70 || d >= bestD) continue;
        candV.set(ep.x, ep.y + 1.25, ep.z);
        if (!this.canSee(eyeV, candV, this.colliders)) continue;
        best = e; bestD = d;
      }
      if (best && best !== this.target) this.reaction = (1 - this.skill) * 0.55 + 0.12;
      if (!best) this.reaction = 0.2;
      this.target = best;
      this.targetDist = bestD;
    }
    const best2 = this.target;
    const best = best2 && best2.alive ? best2 : null;
    if (!best) this.target = null;

    // hearing: a fresh gunshot or explosion nearby pulls an idle bot to investigate
    if (!best && this.investigateT <= 0 && ctx.noise) {
      const n = ctx.noise(this);
      if (n) {
        this.assignRoute({ x: n.x, z: n.z });
        this.investigateT = 4.5;
      }
    }
    if (this.investigateT > 0) this.investigateT -= dt;
    const bestD = best ? Math.hypot(best.root.position.x - pos.x, best.root.position.z - pos.z) : Infinity;

    // aim at the target's chest/head; skill decides the error cone
    if (best) {
      const tp = best.root.position;
      aimV.set(tp.x, tp.y + 1.25, tp.z);
      dirV.copy(aimV).sub(eyeV);
      flatV.set(dirV.x, 0, dirV.z).normalize();
      this.yaw = Math.atan2(flatV.x, flatV.z);
      this.root.rotation.y = this.yaw;

      // stand and strafe at mid range, push when far, back off when close
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafe *= -1; this.strafeTimer = 0.5 + Math.random() * 0.9; }
      if (bestD > 18) {
        // too far to trade: close the distance instead of standing in the open
        wish.copy(flatV).multiplyScalar(0.95);
      } else {
        wish.set(flatV.z, 0, -flatV.x).multiplyScalar(this.strafe * 0.6);
        if (bestD < 7) wish.addScaledVector(flatV, -0.55);
      }

      this.reaction -= dt;
      if (this.reaction <= 0) this.shoot(ctx, best, bestD);
    } else {
      // patrol the route toward the site
      const atEnd = this.wp >= this.route.length;
      if (atEnd) {
        // holding: no desired velocity, and no repath loop
        wish.set(0, 0, 0);
      } else {
        const node = this.route[this.wp];
        wish.set(node.x - pos.x, 0, node.z - pos.z);
        if (wish.length() < 1.6) {
          this.wp++;
        } else {
          wish.normalize();
          this.yaw = Math.atan2(wish.x, wish.z);
        }
      }
    }

    // stuck detection: if the bot has not moved for a second, re-path
    this.stuck += dt;
    if (this.stuck > 1.0) {
      if (pos.distanceTo(this.lastPos) < 0.35 && !best) {
        this.wp = 0;
        this.assignRoute(this.route[this.route.length - 1]);
      }
      this.lastPos.copy(pos);
      this.stuck = 0;
    this.investigateT = 0;
    }

    // integrate movement with collision
    const speed = best ? 2.6 : 4.6;
    const wlen = wish.length();
    if (wlen > 1e-4) wish.multiplyScalar(speed / wlen);
    this.vel.lerp(wish, Math.min(1, dt * 8));
    pos.x += this.vel.x * dt;
    pos.z += this.vel.z * dt;
    resolveCollision(pos, 0.36, this.colliders);
    pos.y = groundHeightAt(pos.x, pos.z) + (pos.y > groundHeightAt(pos.x, pos.z) ? 0 : 0);

    // reload
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = this.weapon.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take; this.reserve -= take;
      }
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.burstPause > 0) this.burstPause -= dt;
  }

  shoot(ctx, target, dist) {
    if (dist > 34) return;
    if (this.reloading > 0 || this.cooldown > 0 || this.burstPause > 0) return;
    if (this.ammo <= 0) {
      if (this.reserve > 0) this.reloading = this.weapon.reload;
      return;
    }
    this.ammo--;
    this.cooldown = 60 / this.weapon.rpm;
    this.burst++;
    const burstMax = this.weapon.auto ? 3 + Math.round(this.skill * 4) : 1;
    if (this.burst >= burstMax) { this.burst = 0; this.burstPause = 0.18 + Math.random() * 0.3; }

    const aim = new THREE.Vector3(target.root.position.x, target.root.position.y + 1.3, target.root.position.z);
    let dir = aim.sub(eyeV).normalize();
    const skillSpread = (1 - this.skill) * 0.05 + this.weapon.spread;
    dir = spreadDir(dir, skillSpread * (1 + dist / 22));
    ctx.onBotShot(this, eyeV, dir, this.weapon);
  }
}
