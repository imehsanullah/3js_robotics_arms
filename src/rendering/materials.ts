import * as THREE from 'three';

export interface RobotMaterials {
  visualFallback: THREE.MeshStandardMaterial;
  collision: THREE.MeshBasicMaterial;
  collisionHit: THREE.MeshBasicMaterial;
  target: THREE.MeshStandardMaterial;
  com: THREE.MeshStandardMaterial;
  totalCom: THREE.MeshStandardMaterial;
  graspObject: THREE.MeshStandardMaterial;
}

export function createRobotMaterials(): RobotMaterials {
  return {
    visualFallback: new THREE.MeshStandardMaterial({
      color: 0xd7dde1,
      metalness: 0.12,
      roughness: 0.52,
    }),
    collision: new THREE.MeshBasicMaterial({
      color: 0xd97706,
      wireframe: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
    collisionHit: new THREE.MeshBasicMaterial({
      color: 0xdc2626,
      wireframe: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    }),
    target: new THREE.MeshStandardMaterial({
      color: 0x0f766e,
      emissive: 0x063d39,
      roughness: 0.4,
      metalness: 0.1,
    }),
    com: new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0x4a2a03,
      roughness: 0.35,
    }),
    totalCom: new THREE.MeshStandardMaterial({
      color: 0x16a34a,
      emissive: 0x063a18,
      roughness: 0.35,
    }),
    graspObject: new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.46,
      metalness: 0.05,
    }),
  };
}
