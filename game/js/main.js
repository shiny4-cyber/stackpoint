// STACKPOINT — round-based tactical FPS.
// Player + 3 bot allies (attackers) vs 4 bot defenders. Attackers plant a charge at the
// site; defenders defuse it. Rounds also end on elimination or when the clock runs out.
import * as THREE from 'three';
import { buildWorld, resolveCollision, groundHeightAt, raycastWalls } from './world.js';
import { WEAPONS, ARMOR_PRICE, createCharacter, resolveShot, spreadDir } from './combat.js';
import { Bot } from './bots.js';
import { createViewmodel, updateViewmodel, viewmodelShot } from './viewmodel.js';

const STEP = 1 / 120;            // fixed simulation step
const MAX_STEPS = 8;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.14;
const FAST = new URLSearchParams(location.search).has('fast');
const ROUND_BUY = FAST ? 2 : 20;
const ROUND_TIME = 105;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 8.0;
const BOMB_TIME = 40;
const WIN_MONEY = 3250;
const LOSS_MONEY = 1400;
const KILL_MONEY = 300;
const GRENADE_PRICE = 300;

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const QS = new URLSearchParams(location.search);
renderer.shadowMap.enabled = !QS.has('noshadow');
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';

const world = buildWorld(scene);
const viewmodel = createViewmodel();
camera.add(viewmodel.group);
scene.add(camera);

// ---------- audio ----------
let actx = null;
function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}
function boom(volume = 0.3, cutoff = 2200, seconds = 0.18) {
  const ctx = audio();
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.4);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  src.connect(lp).connect(gain).connect(ctx.destination);
  src.start();
}
const gunshot = (kind) => boom(kind === 'pistol' ? 0.16 : 0.24, kind === 'pistol' ? 3200 : 2100, kind === 'pistol' ? 0.12 : 0.18);
function beep(freq = 880, vol = 0.05) {
  const ctx = audio();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.value = vol;
  o.connect(g).connect(ctx.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
  o.stop(ctx.currentTime + 0.08);
}

// ---------- state ----------
const player = {
  root: createCharacter('attacker'),
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  hp: 100, armor: 0, money: 800, alive: true,
  weapon: WEAPONS.p9, ammo: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve,
  reloading: 0, cooldown: 0, recoil: 0, bob: 0, crouch: 0, vy: 0, onGround: true,
  grenades: 1,
  kills: 0, deaths: 0,
};
player.root.visible = false;
scene.add(player.root);

let bots = [];
let allies = [];
let enemies = [];
let round = 1;
let phase = 'idle';
let phaseTimer = ROUND_BUY;
let scoreUs = 0;
let scoreThem = 0;
let killFeed = [];
let bomb = null;
let plantProgress = 0;
const noises = [];
const damageLog = [];
globalThis.__onDamage = (b, amount, part) => {
  damageLog.push({ team: b.team, amount: Math.round(amount), part, hp: Math.round(b.hp), x: +b.root.position.x.toFixed(1), z: +b.root.position.z.toFixed(1) });
  if (damageLog.length > 40) damageLog.shift();
};

const keys = new Set();
let locked = false;

// reusable scratch vectors: no per-frame allocation in the hot path
const v1 = new THREE.Vector3();
const originV = new THREE.Vector3();
const dirV = new THREE.Vector3();

// ---------- input ----------
const canvas = renderer.domElement;
document.getElementById('play').addEventListener('click', () => {
  document.getElementById('start').style.display = 'none';
  canvas.requestPointerLock();
  if (phase === 'idle') startMatch();
});
canvas.addEventListener('click', () => { if (!locked) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const sens = 0.0021;
  player.yaw -= e.movementX * sens;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * sens));
});
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyB' && phase === 'buy') toggleBuy(true);
  if (e.code === 'Escape') toggleBuy(false);
  if (e.code === 'KeyR' && !e.repeat) startReload();
  if (e.code === 'KeyG') throwGrenade();
  if (/^Digit[1-6]$/.test(e.code) && phase === 'buy') buyByIndex(Number(e.code.slice(5)) - 1);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  keys.add('Mouse0');
  if (phase === 'live') tryShoot();
});
addEventListener('mouseup', (e) => { if (e.button === 0) keys.delete('Mouse0'); });
addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- rounds ----------
const spawnAt = (team, i) => {
  const list = team === 'attacker' ? world.spawns.attackers : world.spawns.defenders;
  return list[i % list.length].clone();
};

function startMatch() {
  round = 1; scoreUs = 0; scoreThem = 0; player.money = 800; player.grenades = 1;
  startRound();
}

function startRound() {
  phase = 'buy';
  phaseTimer = ROUND_BUY;
  killFeed = [];
  bomb = null;
  plantProgress = 0;
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;

  for (const b of bots) scene.remove(b.root);
  bots = []; allies = []; enemies = [];

  player.pos.copy(spawnAt('attacker', 0));
  player.vel.set(0, 0, 0);
  player.hp = 100;
  player.alive = true;
  player.ammo = player.weapon.mag;
  player.reserve = player.weapon.reserve;
  player.reloading = 0;
  player.crouch = 0;
  player.vy = 0;
  player.onGround = true;
  player.cooldown = 0;
  player.recoil = 0;
  noises.length = 0;
  document.getElementById('feed').innerHTML = '';
  player.yaw = Math.atan2(-(world.siteCenter.x - player.pos.x), -(world.siteCenter.z - player.pos.z));
  player.pitch = 0;
  document.getElementById('dead').classList.remove('on');

  const mk = (team, skill, pos, slot) => {
    const b = new Bot({ team, skill, waypoints: world.waypoints, colliders: world.colliders, spawn: pos, slot, nav: world.nav });
    const holds = world.holds[team];
    b.assignRoute(world.siteCenter, holds[slot % holds.length]);
    scene.add(b.root);
    bots.push(b);
    (team === 'attacker' ? allies : enemies).push(b);
    return b;
  };
  const NOBOTS = new URLSearchParams(location.search).has('nobots');
  if (!NOBOTS) {
  mk('attacker', 0.66, spawnAt('attacker', 1), 0);
  mk('attacker', 0.6, spawnAt('attacker', 2), 1);
  mk('attacker', 0.72, spawnAt('attacker', 3), 2);
  mk('defender', 0.44, spawnAt('defender', 0), 3);
  mk('defender', 0.52, spawnAt('defender', 1), 4);
  mk('defender', 0.56, spawnAt('defender', 2), 5);
  mk('defender', 0.4, spawnAt('defender', 3), 6);
  }

  updateHud();
  banner(`ROUND ${round}`, 'BUY PHASE — B FOR SHOP');
  toggleBuy(true);
}

function banner(text, sub = '') {
  const el = document.getElementById('banner');
  el.innerHTML = `${text}<small>${sub}</small>`;
  el.style.opacity = 1;
  clearTimeout(banner._t);
  banner._t = setTimeout(() => { el.style.opacity = 0; }, 1900);
}

function endRound(winner, reason) {
  if (phase === 'over' || phase === 'idle') return;
  phase = 'over';
  toggleBuy(false);
  if (winner === 'us') { scoreUs++; player.money += WIN_MONEY; banner('ROUND WON', reason); }
  else { scoreThem++; player.money += LOSS_MONEY; banner('ROUND LOST', reason); }
  player.money = Math.min(16000, player.money);
  updateHud();
  setTimeout(() => {
    if (scoreUs >= 7 || scoreThem >= 7) {
      banner(scoreUs >= 7 ? 'MATCH WON' : 'MATCH LOST', `${scoreUs} — ${scoreThem}`);
      setTimeout(() => {
        document.getElementById('start').style.display = 'grid';
        phase = 'idle';
      }, 2600);
    } else {
      round++;
      startRound();
    }
  }, 2200);
}

// ---------- buy ----------
const BUY = [
  { kind: 'weapon', id: 'vx9' },
  { kind: 'weapon', id: 'ar4' },
  { kind: 'armor' },
  { kind: 'grenade' },
  { kind: 'ammo' },
];
const priceOf = (item) => item.kind === 'weapon' ? WEAPONS[item.id].price
  : item.kind === 'armor' ? ARMOR_PRICE
    : item.kind === 'grenade' ? GRENADE_PRICE : 300;
const nameOf = (item) => item.kind === 'weapon' ? WEAPONS[item.id].name
  : item.kind === 'armor' ? 'Kevlar Vest'
    : item.kind === 'grenade' ? 'HE Grenade' : 'Ammo Refill';

function renderBuy() {
  const grid = document.getElementById('buygrid');
  grid.innerHTML = '';
  BUY.forEach((item, i) => {
    const price = priceOf(item);
    const owned = item.kind === 'weapon' && player.weapon.id === item.id;
    const div = document.createElement('div');
    div.className = 'item' + (player.money < price || owned ? ' poor' : '');
    div.innerHTML = `<b>${i + 1}. ${nameOf(item)}</b><div class="meta"><span>${owned ? 'equipped' : item.kind}</span><span>$${price}</span></div>`;
    div.onclick = () => buyByIndex(i);
    grid.appendChild(div);
  });
}
function buyByIndex(i) {
  const item = BUY[i];
  if (!item || phase !== 'buy') return;
  const price = priceOf(item);
  if (player.money < price) return;
  if (item.kind === 'weapon') {
    if (player.weapon.id === item.id) return;
    const w = WEAPONS[item.id];
    player.reloading = 0;
    player.weapon = w; player.ammo = w.mag; player.reserve = w.reserve;
  } else if (item.kind === 'armor') player.armor = 100;
  else if (item.kind === 'grenade') player.grenades = Math.min(2, player.grenades + 1);
  else player.reserve = player.weapon.reserve;
  player.money -= price;
  renderBuy();
  updateHud();
  beep(660);
}
function toggleBuy(on) {
  const el = document.getElementById('buy');
  el.classList.toggle('on', on);
  if (on) { renderBuy(); document.exitPointerLock?.(); }
}

// ---------- combat ----------
function startReload() {
  if (player.reloading > 0 || player.ammo === player.weapon.mag || player.reserve <= 0) return;
  player.reloading = player.weapon.reload;
}

function tryShoot() {
  if (!player.alive || player.reloading > 0 || player.cooldown > 0) return;
  const w = player.weapon;
  if (player.ammo <= 0) { startReload(); return; }
  player.ammo--;
  player.cooldown = 60 / w.rpm;
  viewmodelShot(viewmodel);
  player.recoil = Math.min(0.055, player.recoil + w.recoil);
  gunshot(w.id === 'p9' ? 'pistol' : 'rifle');
  emitNoise(player.pos.x, player.pos.z, 34);

  camera.getWorldPosition(originV);
  camera.getWorldDirection(dirV);
  const spread = w.spread + player.recoil * 0.55 + (isMoving() ? 0.014 : 0) - player.crouch * 0.003;
  const shot = spreadDir(dirV, Math.max(0.002, spread));
  const hit = resolveShot(originV, shot, w.range, bots, world.colliders, player);

  addTracer(originV, shot, Math.min(hit.dist, w.range));

  if (hit.char) {
    hit.char.takeDamage(w.dmg, hit.part);
    beep(hit.part === 'head' ? 1320 : 880, 0.06);
    if (!hit.char.alive) onKill(hit.char, 'player');
  }
  updateHud();
}

function emitNoise(x, z, radius) {
  noises.push({ x, z, radius, t: 3.0 });
  if (noises.length > 24) noises.shift();
}

function onKill(victim, killer) {
  if (victim.team === 'defender' && killer === 'player') {
    player.kills++;
    player.money = Math.min(16000, player.money + KILL_MONEY);
    addFeed('<span style="color:#f0b90b">you</span> eliminated an enemy');
  } else if (victim === playerTarget) {
    addFeed('<span style="color:#c0392b">an enemy</span> eliminated you');
  } else {
    addFeed('<span style="color:#c0392b">an enemy</span> eliminated an ally');
  }
  checkRoundEnd();
}

const tracers = [];
function addTracer(from, dir, dist) {
  const geo = new THREE.BufferGeometry();
  geo.setFromPoints([from.clone(), v1.copy(from).addScaledVector(dir, dist).clone()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe6a3, transparent: true, opacity: 0.85 }));
  scene.add(line);
  tracers.push({ line, life: 0.06 });
}

// ---------- grenades ----------
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.11, 8, 6);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2f3438, metalness: 0.5, roughness: 0.5 });

function throwGrenade() {
  if (!player.alive || phase !== 'live' || player.grenades <= 0) return;
  player.grenades--;
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.castShadow = true;
  camera.getWorldPosition(v1);
  camera.getWorldDirection(dirV);
  mesh.position.copy(v1);
  scene.add(mesh);
  grenades.push({ mesh, vel: dirV.clone().multiplyScalar(16).add(new THREE.Vector3(0, 3.4, 0)), fuse: 2.6 });
  updateHud();
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.vel.y -= 22 * dt;
    const stepLen = g.vel.length() * dt;
    if (stepLen > 1e-4) {
      v1.copy(g.vel).normalize();
      const wall = raycastWalls(g.mesh.position, v1, stepLen + 0.12, world.colliders);
      if (wall < stepLen + 0.12) {
        g.vel.multiplyScalar(-0.35);
        g.vel.y = Math.max(g.vel.y, 0);
      } else {
        g.mesh.position.addScaledVector(g.vel, dt);
      }
    }
    const floor = groundHeightAt(g.mesh.position.x, g.mesh.position.z) + 0.11;
    if (g.mesh.position.y < floor) {
      g.mesh.position.y = floor;
      g.vel.y *= -0.32;
      g.vel.x *= 0.6;
      g.vel.z *= 0.6;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explode(g.mesh.position.clone());
      scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}

function explode(center) {
  boom(0.5, 900, 0.5);
  emitNoise(center.x, center.z, 45);
  const light = new THREE.PointLight(0xffb347, 8, 18, 2);
  light.position.copy(center);
  scene.add(light);
  setTimeout(() => scene.remove(light), 120);
  const R = 8.5;
  for (const b of bots) {
    if (!b.alive) continue;
    const d = b.root.position.distanceTo(center);
    if (d > R) continue;
    b.takeDamage(95 * (1 - d / R), 'body');
    if (!b.alive) onKill(b, 'grenade');
  }
  const dp = center.distanceTo(player.pos);
  if (dp < R) playerTarget.takeDamage(80 * (1 - dp / R), 'body');
}

// ---------- bomb ----------
function updateBomb(dt) {
  if (phase !== 'live') return;
  const atSite = player.pos.distanceTo(world.siteCenter) < 4.2;

  if (!bomb && player.alive && atSite && keys.has('KeyE')) {
    plantProgress += dt;
    if (plantProgress >= PLANT_TIME) {
      bomb = { position: world.siteCenter.clone(), timer: BOMB_TIME, defuse: 0, exploded: false };
      plantProgress = 0;
      banner('CHARGE PLANTED', 'hold the site for 40 seconds');
      for (const d of enemies) d.assignRoute({ x: bomb.position.x, z: bomb.position.z });
      beep(520, 0.08);
    }
  } else if (!bomb) {
    plantProgress = Math.max(0, plantProgress - dt * 2);
  }

  if (!bomb) return;
  bomb.timer -= dt;
  if (bomb.timer <= 0 && !bomb.exploded) {
    bomb.exploded = true;
    explode(bomb.position.clone());
    endRound('us', 'the charge detonated');
    return;
  }
  // a defuse only progresses while no attacker is alive within 10 m of the charge:
  // anyone contesting the site interrupts it and the progress resets
  let contested = false;
  if (player.alive && player.pos.distanceTo(bomb.position) < 10) contested = true;
  for (const a of allies) {
    if (a.alive && a.root.position.distanceTo(bomb.position) < 10) contested = true;
  }
  if (contested) bomb.defuse = Math.max(0, bomb.defuse - dt * 2);

  for (const b of enemies) {
    if (!b.alive || bomb.noDefuse) continue;
    const near = b.root.position.distanceTo(bomb.position) < 2.6;
    const engaged = b.target && b.target.alive;
    if (near && !engaged && !contested) {
      bomb.defuse += dt;
      if (bomb.defuse >= DEFUSE_TIME) {
        endRound('them', 'the charge was defused');
        return;
      }
    }
  }
}

// ---------- player damage target ----------
const playerTarget = {
  root: { position: player.pos },
  get alive() { return player.alive; },
  get eye() { return v1.set(player.pos.x, player.pos.y + EYE_STAND, player.pos.z); },
  team: 'attacker',
  takeDamage(amount, part) {
    let dmg = amount * (part === 'head' ? 3 : 1);
    if (player.armor > 0) {
      const absorbed = Math.min(player.armor, dmg * 0.5);
      player.armor -= absorbed;
      dmg -= absorbed;
    }
    player.hp -= dmg;
    hurtFlash();
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      player.deaths++;
      document.getElementById('dead').classList.add('on');
      document.getElementById('deadnote').textContent = `round ${round} — spectating`;
      checkRoundEnd();
    }
    return part === 'head' ? 3 : 1;
  },
};

function hurtFlash() {
  const el = document.getElementById('hurt');
  el.style.boxShadow = 'inset 0 0 140px rgba(190,30,30,.5)';
  clearTimeout(hurtFlash._t);
  hurtFlash._t = setTimeout(() => { el.style.boxShadow = 'inset 0 0 120px rgba(190,30,30,0)'; }, 190);
}

function isMoving() {
  return keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
}

// ---------- player movement ----------
function updatePlayer(dt) {
  if (!player.alive) return;
  if (phase !== 'live') { player.vel.set(0, 0, 0); return; }
  const crouching = keys.has('ControlLeft') || keys.has('KeyC');
  player.crouch += ((crouching ? 1 : 0) - player.crouch) * Math.min(1, dt * 10);

  const base = keys.has('ShiftLeft') ? 2.3 : 5.1;
  const speed = base * (1 - player.crouch * 0.45);

  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  const rx = Math.cos(player.yaw);
  const rz = -Math.sin(player.yaw);
  let wx = 0;
  let wz = 0;
  if (keys.has('KeyW')) { wx += fx; wz += fz; }
  if (keys.has('KeyS')) { wx -= fx; wz -= fz; }
  if (keys.has('KeyD')) { wx += rx; wz += rz; }
  if (keys.has('KeyA')) { wx -= rx; wz -= rz; }
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx = (wx / len) * speed; wz = (wz / len) * speed; }

  const accel = Math.min(1, dt * 11);
  player.vel.x += (wx - player.vel.x) * accel;
  player.vel.z += (wz - player.vel.z) * accel;

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  resolveCollision(player.pos, 0.38, world.colliders);
  const floor = groundHeightAt(player.pos.x, player.pos.z);
  if (keys.has('Space') && player.onGround) { player.vy = 5.4; player.onGround = false; }
  player.vy -= 18 * dt;
  player.pos.y += player.vy * dt;
  if (player.pos.y <= floor) { player.pos.y = floor; player.vy = 0; player.onGround = true; }
  else player.onGround = false;

  player.recoil = Math.max(0, player.recoil - dt * 0.085);
  player.cooldown = Math.max(0, player.cooldown - dt);
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      const need = player.weapon.mag - player.ammo;
      const take = Math.min(need, player.reserve);
      player.ammo += take; player.reserve -= take;
    }
  }
  player.bob += dt * (Math.hypot(player.vel.x, player.vel.z) > 0.4 ? 7.5 : 0);

  const eye = EYE_STAND + (EYE_CROUCH - EYE_STAND) * player.crouch;
  camera.position.set(player.pos.x, player.pos.y + eye + Math.sin(player.bob) * 0.011, player.pos.z);
  camera.rotation.set(player.pitch + player.recoil * 0.45, player.yaw, 0);
  player.root.position.copy(player.pos);
  player.root.rotation.y = player.yaw;
}

function checkRoundEnd() {
  if (phase !== 'live') return;
  if (enemies.every((b) => !b.alive)) { endRound('us', 'enemy team eliminated'); return; }
  // with a charge planted the round is decided by it, not by the last attacker dying
  if (!bomb && !player.alive && allies.every((b) => !b.alive)) endRound('them', 'attackers eliminated');
}

// ---------- bots bridge ----------
const ctx = {
  noise(bot) {
    let best = null;
    for (const n of noises) {
      if (n.t <= 0 || n.radius < 6) continue;
      const d = Math.hypot(n.x - bot.root.position.x, n.z - bot.root.position.z);
      if (d > n.radius) continue;
      if (!best || n.t > best.t) best = n;
    }
    return best;
  },
  enemies(bot) {
    return bot.team === 'defender' ? [playerTarget, ...allies] : enemies;
  },
  onBotShot(bot, eye, dir, weapon) {
    gunshot(weapon.id === 'p9' ? 'pistol' : 'rifle');
    emitNoise(bot.root.position.x, bot.root.position.z, 30);
    const targets = bot.team === 'defender' ? [playerTarget, ...allies.filter((a) => a !== bot)] : enemies;
    const hit = resolveShot(eye, dir, weapon.range, targets, world.colliders, bot);
    addTracer(eye, dir, Math.min(hit.dist, weapon.range));
    if (hit.char) {
      hit.char.takeDamage(weapon.dmg, hit.part);
      const dead = hit.char === playerTarget ? !player.alive : !hit.char.alive;
      if (dead) onKill(hit.char, bot);
    }
  },
};

// ---------- hud ----------
function addFeed(html) {
  killFeed.unshift(html);
  killFeed = killFeed.slice(0, 5);
  document.getElementById('feed').innerHTML = killFeed.map((k) => `<div>${k}</div>`).join('');
}
function updateHud() {
  document.getElementById('hp').textContent = Math.max(0, Math.round(player.hp));
  document.getElementById('ap').textContent = Math.round(player.armor);
  document.getElementById('cash').textContent = `$${player.money}`;
  document.getElementById('mag').textContent = player.ammo;
  document.getElementById('reserve').textContent = `/ ${player.reserve}`;
  document.getElementById('round').textContent = round;
  document.getElementById('score').textContent = `${scoreUs} — ${scoreThem}`;
  const t = Math.max(0, Math.ceil(phaseTimer));
  document.getElementById('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

  const objective = document.getElementById('objective');
  if (bomb) {
    objective.textContent = `CHARGE ${Math.max(0, bomb.timer).toFixed(1)}s${bomb.defuse > 0 ? ` · DEFUSING ${(bomb.defuse / DEFUSE_TIME * 100).toFixed(0)}%` : ''}`;
    objective.style.color = '#ff6b4a';
  } else if (phase === 'live' && player.alive) {
    const near = player.pos.distanceTo(world.siteCenter) < 4.2;
    objective.textContent = near
      ? (keys.has('KeyE') ? `PLANTING ${(plantProgress / PLANT_TIME * 100).toFixed(0)}%` : 'HOLD E TO PLANT')
      : 'OBJECTIVE: PLANT THE CHARGE AT THE SITE';
    objective.style.color = near ? '#f0b90b' : '#8b949e';
  } else {
    objective.textContent = '';
  }
  document.getElementById('nades').textContent = `nade x${player.grenades}`;
}

// ---------- loop: fixed step, decoupled render ----------
let acc = 0;
let last = performance.now();
let frames = 0;

function frame(now) {
  

requestAnimationFrame(frame);
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += elapsed;
  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) {
    simulate(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;
  updateHud();
  renderer.render(scene, camera);
  frames++;
  window.__frames = frames;
}

function simulate(dt) {
  if (phase === 'buy') {
    phaseTimer -= dt;
    if (phaseTimer <= 0) {
      phase = 'live';
      phaseTimer = ROUND_TIME;
      toggleBuy(false);
      banner('LIVE', 'plant the charge or eliminate them');
    }
  } else if (phase === 'live') {
    phaseTimer -= dt;
    if (phaseTimer <= 0 && !bomb) endRound('them', 'time expired — no charge planted');
  }

  updatePlayer(dt);
  updateViewmodel(viewmodel, dt, {
    moving: Math.hypot(player.vel.x, player.vel.z) > 0.6,
    recoil: player.recoil,
    reloading: player.reloading,
    crouch: player.crouch,
    alive: player.alive && phase !== 'idle',
  });
  if (phase === 'live') for (const b of bots) b.update(dt, ctx);
  updateGrenades(dt);
  updateBomb(dt);
  for (const n of noises) n.t -= dt;
  if (noises.length > 12) noises.splice(0, noises.length - 12);

  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    tracers[i].line.material.opacity = Math.max(0, tracers[i].life / 0.06) * 0.85;
    if (tracers[i].life <= 0) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers[i].line.material.dispose();
      tracers.splice(i, 1);
    }
  }

  if (phase === 'live' && player.weapon.auto && keys.has('Mouse0')) tryShoot();
  if (keys.has('KeyR')) startReload();
}

requestAnimationFrame(frame);

window.__testNoDefuse = () => { if (bomb) bomb.noDefuse = true; };
window.__tp = (x, z, yaw, pitch = 0) => { player.pos.set(x, groundHeightAt(x, z), z); player.yaw = yaw; player.pitch = pitch; };
window.__advance = (seconds) => { const n = Math.round(seconds * 120); for (let i = 0; i < n; i++) simulate(1 / 120); };

window.__debug = () => ({
  phase, round, scoreUs, scoreThem, timer: Math.round(phaseTimer), alive: player.alive, hp: Math.round(player.hp), plant: +plantProgress.toFixed(2), eKey: keys.has('KeyE'),
  player: [player.pos.x.toFixed(1), player.pos.z.toFixed(1)], yaw: +player.yaw.toFixed(3),
  bots: bots.map((b) => ({ team: b.team, alive: b.alive, hp: Math.round(b.hp), x: +b.root.position.x.toFixed(1), z: +b.root.position.z.toFixed(1) })),
  bomb: bomb ? { t: +bomb.timer.toFixed(1) } : null,
  dmg: damageLog.slice(-8),
});
