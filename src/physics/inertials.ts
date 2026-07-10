import * as THREE from 'three';
import type { URDFLink, URDFRobot } from 'urdf-loader';
import type { InertialLink } from './types';

interface InertialCollection {
  inertialLinks: InertialLink[];
  totalMass: number;
}

export function collectInertialLinks(
  model: URDFRobot,
  scene: THREE.Scene,
  material: THREE.Material,
  visible: boolean,
): InertialCollection {
  const inertialLinks: InertialLink[] = [];
  let totalMass = 0;

  model.traverse(object => {
    const link = object as Partial<URDFLink>;
    if (!link.isURDFLink || !link.inertial || link.inertial.mass <= 0) {
      return;
    }
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), material);
    marker.visible = visible;
    scene.add(marker);
    const localCog = new THREE.Vector3(...link.inertial.origin.xyz);
    inertialLinks.push({
      link: link as URDFLink,
      name: link.urdfName ?? link.name ?? 'unnamed_link',
      mass: link.inertial.mass,
      localCog,
      marker,
    });
    totalMass += link.inertial.mass;
  });

  return { inertialLinks, totalMass };
}

export function updateCenterOfMass(inertialLinks: InertialLink[], totalMass: number, totalComMesh: THREE.Object3D) {
  const total = new THREE.Vector3();
  const linkCog = new THREE.Vector3();
  for (const sample of inertialLinks) {
    linkCog.copy(sample.localCog);
    sample.link.localToWorld(linkCog);
    sample.marker.position.copy(linkCog);
    total.addScaledVector(linkCog, sample.mass);
  }
  if (totalMass > 0) {
    total.multiplyScalar(1 / totalMass);
  }
  totalComMesh.position.copy(total);
  return total;
}

export function setInertialVisibility(inertialLinks: InertialLink[], totalComMesh: THREE.Object3D, visible: boolean) {
  for (const item of inertialLinks) {
    item.marker.visible = visible;
  }
  totalComMesh.visible = visible;
}
