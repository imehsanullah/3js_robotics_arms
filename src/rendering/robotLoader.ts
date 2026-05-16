import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import URDFLoader, { URDFCollider, URDFRobot } from 'urdf-loader';
import type { RobotDefinition } from '../robots';
import type { RobotMaterials } from './materials';

interface UrdfVisualLike {
  isURDFVisual?: boolean;
}

export function createUrdfLoader(manager: THREE.LoadingManager, robots: RobotDefinition[]) {
  const loader = new URDFLoader(manager);
  loader.packages = Object.fromEntries(robots.map(robotDefinition => [robotDefinition.packageName, robotDefinition.packagePath]));
  loader.parseCollision = true;
  loader.parseVisual = true;

  const defaultMeshLoader = loader.defaultMeshLoader.bind(loader);
  loader.loadMeshCb = (path, meshManager, done) => {
    if (!/\.obj$/i.test(path)) {
      defaultMeshLoader(path, meshManager, done);
      return;
    }

    new OBJLoader(meshManager).load(
      path,
      object => done(object),
      undefined,
      error => done(new THREE.Group(), error instanceof Error ? error : new Error(String(error))),
    );
  };

  return loader;
}

export function configureRobotMaterials(model: URDFRobot, materials: RobotMaterials, collisionVisible: boolean) {
  model.traverse(object => {
    object.castShadow = true;
    object.receiveShadow = true;

    const maybeCollider = object as Partial<URDFCollider>;
    if (maybeCollider.isURDFCollider) {
      object.visible = collisionVisible;
      object.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = materials.collision;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
      });
      return;
    }

    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material) && !mesh.material) {
      mesh.material = materials.visualFallback;
    }
  });
}

export function countUrdfVisuals(model: URDFRobot) {
  let count = 0;
  model.traverse(object => {
    if ((object as UrdfVisualLike).isURDFVisual) {
      count += 1;
    }
  });
  return count;
}

export function getRobotFrame(model: URDFRobot | null, frameName: string) {
  if (!model) {
    return null;
  }
  return (model.getFrame(frameName) as THREE.Object3D | undefined) ?? null;
}
