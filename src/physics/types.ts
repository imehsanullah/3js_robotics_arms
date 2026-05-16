import * as THREE from 'three';
import type { URDFLink } from 'urdf-loader';
import type { JointName } from '../robots';

export interface CollisionMesh {
  name: string;
  linkName: string;
  mesh: THREE.Mesh;
}

export interface InertialLink {
  link: URDFLink;
  name: string;
  mass: number;
  localCog: THREE.Vector3;
  marker: THREE.Mesh;
}

export interface TorqueSample {
  jointName: JointName;
  torque: number;
  effort: number;
}
