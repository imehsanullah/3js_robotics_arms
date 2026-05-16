import * as THREE from 'three';

export function disposeObjectTree(object: THREE.Object3D, protectedMaterials: Set<THREE.Material> = new Set()) {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const geometry = mesh.geometry as THREE.BufferGeometry & { disposeBoundsTree?: () => void };
    geometry.disposeBoundsTree?.();
    geometry.dispose();

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || protectedMaterials.has(material)) {
        continue;
      }
      material.dispose();
    }
  });
}
