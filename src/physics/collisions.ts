import * as THREE from 'three';
import { URDFCollider, URDFLink, URDFRobot } from 'urdf-loader';
import type { CollisionMesh, CollisionPair } from './types';

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
        link: link ?? model,
        mesh,
      });
    });
  });
  return collisionMeshes;
}

export function buildCollisionPairs(collisionMeshes: CollisionMesh[]) {
  const pairs: CollisionPair[] = [];
  for (let i = 0; i < collisionMeshes.length; i += 1) {
    for (let j = i + 1; j < collisionMeshes.length; j += 1) {
      const a = collisionMeshes[i];
      const b = collisionMeshes[j];
      if (a.link === b.link || areAdjacentLinks(a.link, b.link)) {
        continue;
      }
      pairs.push([i, j]);
    }
  }
  return pairs;
}

export function findIntersectingPairKeys(collisionMeshes: CollisionMesh[], collisionPairs: CollisionPair[]) {
  const intersections = new Set<string>();
  const matrix = new THREE.Matrix4();
  for (const [aIndex, bIndex] of collisionPairs) {
    const a = collisionMeshes[aIndex];
    const b = collisionMeshes[bIndex];
    a.mesh.updateWorldMatrix(true, false);
    b.mesh.updateWorldMatrix(true, false);
    matrix.copy(a.mesh.matrixWorld).invert().multiply(b.mesh.matrixWorld);
    const boundsTree = (a.mesh.geometry as THREE.BufferGeometry & {
      boundsTree?: { intersectsGeometry: (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => boolean };
    }).boundsTree;
    if (boundsTree?.intersectsGeometry(b.mesh.geometry, matrix)) {
      intersections.add(collisionPairKey(aIndex, bIndex));
    }
  }
  return intersections;
}

export function detectCollisions(
  collisionMeshes: CollisionMesh[],
  collisionPairs: CollisionPair[],
  collisionMaterial: THREE.Material,
  collisionHitMaterial: THREE.Material,
) {
  const collisions: string[] = [];
  for (const item of collisionMeshes) {
    item.mesh.material = collisionMaterial;
  }

  const matrix = new THREE.Matrix4();
  for (const [aIndex, bIndex] of collisionPairs) {
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
    } else {
      item.mesh.visible = visible;
    }
  }
}

function findParentLink(object: THREE.Object3D | null): URDFLink | null {
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

function areAdjacentLinks(a: URDFLink, b: URDFLink) {
  const aToB = movableJointsToAncestor(a, b);
  const bToA = movableJointsToAncestor(b, a);
  return (aToB !== null && aToB <= 1) || (bToA !== null && bToA <= 1);
}

function movableJointsToAncestor(descendant: THREE.Object3D, ancestor: THREE.Object3D) {
  let current: THREE.Object3D | null = descendant.parent;
  let movableJoints = 0;
  while (current) {
    if (current === ancestor) return movableJoints;
    const joint = current as Partial<{ isURDFJoint: boolean; jointType: string }>;
    if (joint.isURDFJoint && joint.jointType !== 'fixed') movableJoints += 1;
    current = current.parent;
  }
  return null;
}

export function collisionPairKey(aIndex: number, bIndex: number) {
  return `${aIndex}:${bIndex}`;
}
