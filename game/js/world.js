// Map: a compact bomb-site compound ("Stackpoint"). Geometry is boxes only so the
// collision set stays exact and cheap: every solid mesh registers an AABB collider.
import * as THREE from 'three';

export const MAP = { size: 64, wallHeight: 5 };


function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#12181e'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#f0b90b'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#f0b90b';
  g.font = 'bold 62px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addSign(scene, text, x, y, z, yaw) {
  const mat = new THREE.MeshBasicMaterial({ map: signTexture(text), toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  scene.add(mesh);
  // backing plate so the sign reads as mounted on the wall instead of floating
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.78, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a2128, roughness: 0.8, metalness: 0.2 }),
  );
  back.position.set(x, y, z);
  back.rotation.y = yaw;
  back.translateZ(-0.06);
  scene.add(back);
  return mesh;
}

function addBox(scene, colliders, mat, x, y, z, w, h, d, solid = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (solid) {
    colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    });
  }
  return mesh;
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#333c46';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 60 + Math.random() * 40;
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(170,185,200,.22)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}


function woodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8a6a42';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? 'rgba(60,40,20,.18)' : 'rgba(255,220,160,.08)';
    g.fillRect(0, i * 32, 256, 30);
  }
  g.strokeStyle = 'rgba(40,26,12,.55)';
  g.lineWidth = 3;
  for (let i = 0; i <= 8; i++) {
    g.beginPath();
    g.moveTo(0, i * 32);
    g.lineTo(256, i * 32);
    g.stroke();
  }
  g.strokeStyle = 'rgba(28,18,8,.8)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 246, 246);
  g.strokeStyle = 'rgba(240,185,11,.55)';
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(20, 236); g.lineTo(236, 20); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function concreteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5d6a78';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 70 + Math.random() * 55;
    g.fillStyle = `rgba(${v},${v + 4},${v + 10},.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  g.strokeStyle = 'rgba(30,38,46,.55)';
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildWorld(scene) {
  const colliders = [];
  scene.background = new THREE.Color(0x2c4055);
  scene.fog = new THREE.Fog(0x3c556e, 55, 120);

  // sky dome: vertical gradient so the scene reads as an outdoor night compound
  const skyGeo = new THREE.SphereGeometry(140, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x16283c) },
      bottom: { value: new THREE.Color(0x7a93a8) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y / 160.0 + 0.35, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  scene.add(new THREE.AmbientLight(0x9fb2c4, 1.0));
  scene.add(new THREE.HemisphereLight(0xbcd0e0, 0x2a3440, 1.5));
  const sun = new THREE.DirectionalLight(0xffe3b8, 3.4);
  sun.position.set(24, 34, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 110;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x5f8fb8, 0.7);
  fill.position.set(-18, 16, -22);
  scene.add(fill);

  const S = MAP.size;
  const woodTex = woodTexture();
  woodTex.repeat.set(1, 1);
  const wallTex = concreteTexture();
  wallTex.repeat.set(2, 1);
  const concrete = new THREE.MeshStandardMaterial({ map: wallTex, color: 0xefe2cf, roughness: 0.92, metalness: 0.04 });
  const concreteDark = new THREE.MeshStandardMaterial({ color: 0x3a444f, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, color: 0xffffff, roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x7b8794, roughness: 0.45, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x8a6d1f, roughness: 0.6, metalness: 0.3, emissive: 0x2a1f05 });

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const H = MAP.wallHeight;
  const half = S / 2;
  // outer walls
  addBox(scene, colliders, concreteDark, 0, H / 2, -half, S, H, 2);
  addBox(scene, colliders, concreteDark, 0, H / 2, half, S, H, 2);
  addBox(scene, colliders, concreteDark, -half, H / 2, 0, 2, H, S);
  addBox(scene, colliders, concreteDark, half, H / 2, 0, 2, H, S);

  // central site building: one wide door facing the attackers' approach, side walls solid
  const wallY = 2;
  addBox(scene, colliders, concrete, -6.75, wallY, 14, 5.5, 4, 0.6);  // front wall, left of the door
  addBox(scene, colliders, concrete, 6.75, wallY, 14, 5.5, 4, 0.6);   // front wall, right of the door
  addBox(scene, colliders, concrete, -6.25, wallY, 4, 5.5, 4, 0.6);   // back wall, left of the defenders' door
  addBox(scene, colliders, concrete, 6.25, wallY, 4, 5.5, 4, 0.6);    // back wall, right of the defenders' door
  addBox(scene, colliders, concrete, -8.7, wallY, 9, 0.6, 4, 10);     // west wall
  addBox(scene, colliders, concrete, 8.7, wallY, 9, 0.6, 4, 10);      // east wall
  addBox(scene, colliders, accent, 0, 0.12, 9, 6, 0.24, 5, false); // site marker, walkable

  // crates: cover lines
  const crate = (x, z, s = 2) => addBox(scene, colliders, wood, x, s / 2, z, s, s, s);
  crate(-16, -4); crate(-18, -2); crate(-16, -2); crate(16, -6); crate(18, -4);
  crate(-4, 22); crate(4, 22); crate(-12, 18); crate(12, 18);
  crate(-20, 12, 1.6); crate(20, 14, 1.6); crate(-22, 4); crate(22, 2);

  // long sightlines / lane dividers
  addBox(scene, colliders, concrete, -13, 1.6, -18, 10, 3.2, 0.8);
  addBox(scene, colliders, concrete, 13, 1.6, -18, 10, 3.2, 0.8);
  addBox(scene, colliders, metal, 0, 1.1, -22, 3, 2.2, 3);

  // ramp boxes near spawns
  addBox(scene, colliders, concrete, -24, 0.6, -24, 5, 1.2, 5);
  addBox(scene, colliders, concrete, 24, 0.6, -24, 5, 1.2, 5);

  const spawns = {
    attackers: [new THREE.Vector3(-22, 1.7, 26), new THREE.Vector3(-18, 1.7, 27), new THREE.Vector3(-26, 1.7, 27), new THREE.Vector3(-22, 1.7, 24)],
    defenders: [new THREE.Vector3(-5, 1.7, 6), new THREE.Vector3(5, 1.7, 6), new THREE.Vector3(-3, 1.7, 11), new THREE.Vector3(3, 1.7, 11)],
  };

  // site marking on the floor: painted "A" so the objective reads at a glance
  // hazard bands along the site walls mark the objective without changing the collision model
  const hazard = new THREE.MeshStandardMaterial({ color: 0xf0b90b, roughness: 0.7, emissive: 0x3a2a02, emissiveIntensity: 0.6 });
  addBox(scene, colliders, hazard, -6.75, 0.5, 14.34, 5.5, 0.5, 0.08, false);
  addBox(scene, colliders, hazard, 6.75, 0.5, 14.34, 5.5, 0.5, 0.08, false);
  addBox(scene, colliders, hazard, -6.25, 0.5, 3.66, 5.5, 0.5, 0.08, false);
  addBox(scene, colliders, hazard, 6.25, 0.5, 3.66, 5.5, 0.5, 0.08, false);

  // signage over both doors so the site reads at a glance
  addSign(scene, 'SITE A', 0, 3.35, 14.34, 0);
  addSign(scene, 'SITE A', 0, 3.35, 3.66, Math.PI);

  const siteCanvas = document.createElement('canvas');
  siteCanvas.width = siteCanvas.height = 256;
  const sg = siteCanvas.getContext('2d');
  sg.fillStyle = 'rgba(240,185,11,0.10)';
  sg.fillRect(0, 0, 256, 256);
  sg.strokeStyle = 'rgba(240,185,11,0.85)';
  sg.lineWidth = 14;
  sg.strokeRect(18, 18, 220, 220);
  sg.fillStyle = 'rgba(240,185,11,0.85)';
  sg.font = 'bold 150px monospace';
  sg.textAlign = 'center';
  sg.textBaseline = 'middle';
  sg.fillText('A', 128, 138);
  const siteTex = new THREE.CanvasTexture(siteCanvas);
  siteTex.colorSpace = THREE.SRGBColorSpace;
  const siteDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({ map: siteTex, transparent: true, depthWrite: false }),
  );
  siteDecal.rotation.x = -Math.PI / 2;
  siteDecal.position.set(0, 0.02, 9);
  scene.add(siteDecal);

  // practical lights: warm sodium fixtures on the compound walls
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, emissive: 0xffb347, emissiveIntensity: 2.2, roughness: 0.4 });
  for (const [x, z, ry] of [[-28, 6, Math.PI / 2], [28, 6, -Math.PI / 2], [-6, -28, 0], [6, 28, Math.PI]]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.5), lampMat);
    lamp.position.set(x, 4.2, z);
    lamp.rotation.y = ry;
    scene.add(lamp);
    const pl = new THREE.PointLight(0xffb347, 55, 26, 2);
    pl.position.set(x * 0.98, 4.0, z * 0.98);
    scene.add(pl);
  }

  // barrels: silhouette breakers along the lanes
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3f4a52, roughness: 0.55, metalness: 0.45 });
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.15, 12);
  for (const [x, z] of [[-19, 8], [-18.2, 9.4], [19, 10], [20.2, 8.6], [-9, -16], [9.6, -15.4]]) {
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(x, 0.58, z);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
    colliders.push({ min: new THREE.Vector3(x - 0.55, 0, z - 0.55), max: new THREE.Vector3(x + 0.55, 1.15, z + 0.55) });
  }

  // waypoint graph: coarse nodes tied to cover and lanes
  const waypoints = [
    [-22, 24], [-14, 20], [-6, 20], [2, 20], [10, 20], [18, 22],
    [-24, 10], [-16, 8], [-6, 6], [4, 6], [14, 8], [24, 10],
    [-24, -6], [-14, -8], [-4, -10], [6, -10], [16, -8], [24, -6],
    [-20, -20], [-10, -22], [0, -22], [10, -22], [20, -20],
    [-6, 2], [0, 0], [6, 2], [0, 16], [-3, 12], [3, 12],
    [0, 6], [-4, 6.5], [4, 6.5], [0, 11], [-6.5, 9], [6.5, 9],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  // tactical hold points: each bot takes one so a squad spreads instead of stacking
  const holds = {
    attacker: [
      new THREE.Vector3(-5.5, 0, 7.5), new THREE.Vector3(5.5, 0, 7.5),
      new THREE.Vector3(-4.0, 0, 11.5), new THREE.Vector3(4.0, 0, 11.5),
    ],
    defender: [
      new THREE.Vector3(-6.0, 0, 5.5), new THREE.Vector3(6.0, 0, 5.5),
      new THREE.Vector3(-2.0, 0, 5.0), new THREE.Vector3(2.0, 0, 5.0),
    ],
  };

  const nav = buildNavGraph(waypoints, colliders);
  return { colliders, spawns, waypoints, nav, holds, siteCenter: new THREE.Vector3(0, 0, 9) };
}

// Waypoint graph with visibility edges: two nodes are connected when a chest-height ray
// between them clears every collider. Bots path over this instead of walking into walls.
export function buildNavGraph(waypoints, colliders) {
  const eye = 1.0;
  const adj = waypoints.map(() => []);
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i];
      const b = waypoints[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 22) continue;
      const dir = new THREE.Vector3(dx / dist, 0, dz / dist);
      const from = new THREE.Vector3(a.x, eye, a.z);
      const blocked = raycastWalls(from, dir, dist, colliders);
      if (blocked >= dist - 0.2) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  return { nodes: waypoints, adj };
}

export function nearestNode(graph, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function findPath(graph, startIdx, goalIdx) {
  const n = graph.nodes.length;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const seen = new Array(n).fill(false);
  dist[startIdx] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (!seen[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u === -1) break;
    seen[u] = true;
    if (u === goalIdx) break;
    for (const v of graph.adj[u]) {
      const a = graph.nodes[u];
      const b = graph.nodes[v];
      const w = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
  }
  if (dist[goalIdx] === Infinity) return [];
  const path = [];
  for (let at = goalIdx; at !== -1; at = prev[at]) path.push(graph.nodes[at]);
  return path.reverse();
}

// Axis-aligned circle-vs-AABB resolution. A centre inside the box is pushed out along
// the shallowest face; a centre outside is pushed along the closest-point normal.
export function resolveCollision(pos, radius, colliders) {
  for (const c of colliders) {
    if (pos.y - 1.6 > c.max.y || pos.y + 0.2 < c.min.y) continue;
    const inside = pos.x > c.min.x && pos.x < c.max.x && pos.z > c.min.z && pos.z < c.max.z;
    if (inside) {
      const dxMin = pos.x - c.min.x;
      const dxMax = c.max.x - pos.x;
      const dzMin = pos.z - c.min.z;
      const dzMax = c.max.z - pos.z;
      const m = Math.min(dxMin, dxMax, dzMin, dzMax);
      if (m === dxMin) pos.x = c.min.x - radius;
      else if (m === dxMax) pos.x = c.max.x + radius;
      else if (m === dzMin) pos.z = c.min.z - radius;
      else pos.z = c.max.z + radius;
      continue;
    }
    const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
    const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      const d = Math.sqrt(d2) || 0.0001;
      const push = (radius - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    }
  }
  const lim = MAP.size / 2 - 1.6;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
}

export function groundHeightAt(x, z) {
  // ramp boxes are the only raised walkable surfaces; approximate with two pads
  if (Math.hypot(x + 24, z + 24) < 3.6) return 1.2;
  if (Math.hypot(x - 24, z + 24) < 3.6) return 1.2;
  return 0;
}

// Segment vs AABB, returns nearest hit distance (or Infinity). Used by hitscan.
export function raycastWalls(origin, dir, maxDist, colliders) {
  let best = maxDist;
  for (const c of colliders) {
    let tmin = 0;
    let tmax = best;
    let hit = true;
    for (const axis of ['x', 'y', 'z']) {
      const o = origin[axis];
      const d = dir[axis];
      if (Math.abs(d) < 1e-8) {
        if (o < c.min[axis] || o > c.max[axis]) { hit = false; break; }
      } else {
        let t1 = (c.min[axis] - o) / d;
        let t2 = (c.max[axis] - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { hit = false; break; }
      }
    }
    if (hit && tmin < best) best = tmin;
  }
  return best;
}
