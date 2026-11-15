// First-person viewmodel: a stylised rifle built from boxes, plus muzzle flash and
// recoil/reload animation. Lives on the camera so it always reads in screenshots.
import * as THREE from 'three';

function part(w, h, d, color, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 }));
  m.position.set(x, y, z);
  return m;
}

export function createViewmodel() {
  const group = new THREE.Group();
  const gunmetal = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.42, metalness: 0.75 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.85, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 0.75 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.9 });

  // receiver + handguard + barrel
  group.add(part(0.11, 0.12, 0.46, 0, 0, 0, -0.18, gunmetal));
  group.add(part(0.09, 0.09, 0.30, 0, 0, 0.005, -0.50, polymer));
  group.add(part(0.035, 0.035, 0.34, 0, 0, 0.012, -0.74, gunmetal));
  // magazine + grip
  const mag = part(0.07, 0.20, 0.09, 0, 0, -0.15, -0.12, polymer);
  mag.rotation.x = 0.18;
  group.add(mag);
  const grip = part(0.07, 0.16, 0.09, 0, 0, -0.12, 0.06, polymer);
  grip.rotation.x = -0.3;
  group.add(grip);
  // stock
  group.add(part(0.07, 0.09, 0.22, 0, 0, 0.0, 0.14, polymer));
  // sight
  group.add(part(0.03, 0.05, 0.10, 0, 0, 0.09, -0.30, gunmetal));

  // hands
  const rightHand = part(0.09, 0.11, 0.13, 0, 0.02, -0.14, 0.03, glove);
  const leftHand = part(0.09, 0.10, 0.14, 0, -0.02, -0.10, -0.42, glove);
  group.add(rightHand, leftHand);
  group.add(part(0.07, 0.20, 0.08, 0, 0.03, -0.22, 0.16, skin));
  group.add(part(0.07, 0.18, 0.08, 0, -0.03, -0.20, -0.50, skin));

  // muzzle flash: a small emissive cone, hidden until a shot
  const flash = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.20, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.95 }),
  );
  flash.rotation.x = -Math.PI / 2;
  flash.position.set(0, 0.012, -0.94);
  flash.visible = false;
  group.add(flash);

  const light = new THREE.PointLight(0xffb347, 0, 6, 2);
  light.position.set(0, 0.05, -0.9);
  group.add(light);

  group.position.set(0.20, -0.19, -0.30);
  group.rotation.y = 0.03;

  return { group, flash, light, kick: 0, reloadT: 0 };
}

export function updateViewmodel(vm, dt, opts) {
  const { moving, recoil, reloading, crouch, alive } = opts;
  vm.group.visible = alive;
  if (!alive) return;

  vm.kick = Math.max(0, vm.kick - dt * 6);
  const sway = Math.sin(performance.now() * 0.0016) * 0.004 + (moving ? Math.sin(performance.now() * 0.012) * 0.006 : 0);
  const baseY = -0.19 + crouch * 0.02;

  vm.group.position.set(0.20 + sway, baseY + sway * 0.5, -0.30 + vm.kick * 0.06);
  vm.group.rotation.x = -vm.kick * 0.18 + recoil * 1.2;
  vm.group.rotation.z = reloading > 0 ? -0.35 : 0;
  vm.group.rotation.y = 0.03 + (reloading > 0 ? 0.2 : 0);

  vm.flash.visible = vm.kick > 0.55;
  vm.light.intensity = vm.flash.visible ? 12 : 0;
}

export function viewmodelShot(vm) {
  vm.kick = 1;
}
