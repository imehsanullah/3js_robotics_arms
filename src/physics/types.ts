import * as THREE from 'three';
import type { URDFLink } from 'urdf-loader';

export interface CollisionMesh {
  name: string;
  linkName: string;
  link: URDFLink;
  mesh: THREE.Mesh;
}

export type CollisionPair = readonly [number, number];

export interface InertialLink {
  link: URDFLink;
  name: string;
  mass: number;
  localCog: THREE.Vector3;
  marker: THREE.Mesh;
}
