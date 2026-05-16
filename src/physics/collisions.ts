import * as THREE from 'three';
import { URDFCollider, URDFLink, URDFRobot } from 'urdf-loader';
import type { RobotDefinition } from '../robots';
import type { CollisionMesh } from './types';

export function collectCollisionMeshes(model: URDFRobot, material: THREE.Material) {
  const collisionMeshes: CollisionMesh[] = [];
  let fallbackIndex = 0;
  model.traverse(object => {
    const maybeCollider = object as Partial<URDFCollider>;
    if (!maybeCollider.isURDFCollider) {
      return;
    }

    const collider = object as URDFCollider;
    const link = findParentLink(collider);
    const name = collider.urdfName || collider.name || `collision_${fallbackIndex}`;
    fallbackIndex += 1;

    collider.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
        return;
      }
      mesh.geometry.computeBoundsTree();
      mesh.material = material;
      collisionMeshes.push({
        name,
        linkName: link?.urdfName ?? link?.name ?? name,
        mesh,
      });
    });
  });
  return collisionMeshes;
}

export function buildCollisionPairs(robot: RobotDefinition, collisionMeshes: CollisionMesh[]) {
  const collisionPairSet = new Set<string>();
  const linkIndex = new Map(robot.linkChain.map((linkName, index) => [linkName, index]));

  for (let i = 0; i < collisionMeshes.length; i += 1) {
    for (let j = i + 1; j < collisionMeshes.length; j += 1) {
      const a = collisionMeshes[i];
      const b = collisionMeshes[j];
      if (shouldSkipCollisionPair(linkIndex, a.linkName, b.linkName)) {
        continue;
      }
      collisionPairSet.add(`${i}:${j}`);
    }
  }

  return collisionPairSet;
}

export function detectCollisions(
  collisionMeshes: CollisionMesh[],
  collisionPairSet: Set<string>,
  collisionMaterial: THREE.Material,
  collisionHitMaterial: THREE.Material,
) {
  const collisions: string[] = [];
  for (const item of collisionMeshes) {
    item.mesh.material = collisionMaterial;
  }

  const matrix = new THREE.Matrix4();
  for (const key of collisionPairSet) {
    const [aIndex, bIndex] = key.split(':').map(Number);
    const a = collisionMeshes[aIndex];
    const b = collisionMeshes[bIndex];
    a.mesh.updateWorldMatrix(true, false);
    b.mesh.updateWorldMatrix(true, false);
    matrix.copy(a.mesh.matrixWorld).invert().multiply(b.mesh.matrixWorld);
    const boundsTree = (a.mesh.geometry as THREE.BufferGeometry & {
      boundsTree?: { intersectsGeometry: (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => boolean };
    }).boundsTree;
    if (boundsTree?.intersectsGeometry(b.mesh.geometry, matrix)) {
      collisions.push(`${a.linkName} / ${b.linkName}`);
      a.mesh.material = collisionHitMaterial;
      b.mesh.material = collisionHitMaterial;
    }
  }
  return collisions;
}

export function setCollisionVisibility(collisionMeshes: CollisionMesh[], visible: boolean) {
  for (const item of collisionMeshes) {
    let object: THREE.Object3D | null = item.mesh;
    while (object && !(object as Partial<URDFCollider>).isURDFCollider) {
      object = object.parent;
    }
    if (object) {
      object.visible = visible;
    }
  }
}

function findParentLink(object: THREE.Object3D): URDFLink | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const maybeLink = current as Partial<URDFLink>;
    if (maybeLink.isURDFLink) {
      return current as URDFLink;
    }
    current = current.parent;
  }
  return null;
}

function shouldSkipCollisionPair(linkIndex: Map<string, number>, a: string, b: string) {
  const indexA = linkIndex.get(a);
  const indexB = linkIndex.get(b);
  if (indexA === undefined || indexB === undefined) {
    return false;
  }
  return Math.abs(indexA - indexB) <= 1;
}
