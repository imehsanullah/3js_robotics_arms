import * as THREE from 'three';
import type { URDFRobot } from 'urdf-loader';
import { createEndEffectorRuntime } from '../endEffectors/state';
import type { EndEffectorRuntime } from '../endEffectors/state';
import {
  buildCollisionPairs,
  collectCollisionMeshes,
  collisionPairKey,
  detectCollisions,
  findIntersectingPairKeys,
  setCollisionVisibility,
} from '../physics/collisions';
import { collectInertialLinks } from '../physics/inertials';
import type { CollisionMesh, CollisionPair, InertialLink } from '../physics/types';
import { clamp, getFrameName } from '../robots';
import type { JointValues, RobotDefinition } from '../robots';
import { disposeObjectTree } from '../rendering/dispose';
import type { RobotMaterials } from '../rendering/materials';
import {
  configureRobotMaterials,
  countUrdfVisuals,
  getRobotFrame,
  loadUrdfWithAssets,
} from '../rendering/robotLoader';
import { installBvhExtensions } from '../rendering/bvh';

installBvhExtensions();

export interface LoadedRobotRuntime {
  definition: RobotDefinition;
  model: URDFRobot;
  endEffector: EndEffectorRuntime | null;
  collisionMeshes: CollisionMesh[];
  collisionPairs: CollisionPair[];
  inertialLinks: InertialLink[];
  totalMass: number;
  visualCount: number;
  dispose(): void;
}

interface LoadRobotRuntimeOptions {
  definition: RobotDefinition;
  registry: RobotDefinition[];
  scene: THREE.Scene;
  materials: RobotMaterials;
  protectedMaterials: Set<THREE.Material>;
  collisionVisible: boolean;
  inertialsVisible: boolean;
}

export async function loadRobotRuntime(options: LoadRobotRuntimeOptions): Promise<LoadedRobotRuntime> {
  const { definition, registry, scene, materials, protectedMaterials } = options;
  const model = await loadUrdfWithAssets(definition.urdfPath, registry);
  model.name = definition.name;

  try {
    validateLoadedArm(definition, model);
    configureRobotMaterials(model, materials, options.collisionVisible);
    const endEffector = await loadEndEffector(definition, registry, model, materials, options.collisionVisible);
    model.updateMatrixWorld(true);
    scene.add(model);

    const collisionMeshes = definition.capabilities.supportsCollision
      ? collectCollisionMeshes(model, materials.collision)
      : [];
    const collisionPairs = removePersistentEndEffectorOverlaps(
      collisionMeshes,
      buildCollisionPairs(collisionMeshes),
      endEffector,
    );
    const inertialCollection = definition.capabilities.supportsInertials
      ? collectInertialLinks(model, scene, materials.com, options.inertialsVisible)
      : { inertialLinks: [], totalMass: 0 };

    const runtime: LoadedRobotRuntime = {
      definition,
      model,
      endEffector,
      collisionMeshes,
      collisionPairs,
      inertialLinks: inertialCollection.inertialLinks,
      totalMass: inertialCollection.totalMass,
      visualCount: countUrdfVisuals(model),
      dispose: () => {
        scene.remove(model);
        for (const inertial of inertialCollection.inertialLinks) {
          scene.remove(inertial.marker);
          disposeObjectTree(inertial.marker, protectedMaterials);
        }
        disposeObjectTree(model, protectedMaterials);
      },
    };
    return runtime;
  } catch (error) {
    scene.remove(model);
    disposeObjectTree(model, protectedMaterials);
    throw error;
  }
}

function validateLoadedArm(definition: RobotDefinition, model: URDFRobot) {
  for (const spec of definition.jointSpecs) {
    if (!model.joints[spec.name]) {
      throw new Error(`Robot config references unknown URDF joint: ${spec.name}`);
    }
  }
  for (const [alias, frameName] of Object.entries(definition.toolFrames)) {
    if (!getRobotFrame(model, frameName)) {
      throw new Error(`Robot config frame ${alias} references unknown URDF frame: ${frameName}`);
    }
  }
}

function removePersistentEndEffectorOverlaps(
  collisionMeshes: CollisionMesh[],
  collisionPairs: CollisionPair[],
  endEffector: EndEffectorRuntime | null,
) {
  if (!endEffector) return collisionPairs;
  const { command } = endEffector.definition;
  endEffector.model.setJointValue(command.jointName, command.open);
  endEffector.model.updateMatrixWorld(true);
  const openIntersections = findIntersectingPairKeys(collisionMeshes, collisionPairs);
  endEffector.model.setJointValue(command.jointName, command.close);
  endEffector.model.updateMatrixWorld(true);
  const closedIntersections = findIntersectingPairKeys(collisionMeshes, collisionPairs);
  endEffector.model.setJointValue(command.jointName, command.open);
  endEffector.model.updateMatrixWorld(true);

  return collisionPairs.filter(([aIndex, bIndex]) => {
    const bothInsideEndEffector =
      isDescendantOf(collisionMeshes[aIndex].link, endEffector.model) &&
      isDescendantOf(collisionMeshes[bIndex].link, endEffector.model);
    const key = collisionPairKey(aIndex, bIndex);
    return !(bothInsideEndEffector && openIntersections.has(key) && closedIntersections.has(key));
  });
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

async function loadEndEffector(
  definition: RobotDefinition,
  registry: RobotDefinition[],
  model: URDFRobot,
  materials: RobotMaterials,
  collisionVisible: boolean,
) {
  const endEffectorDefinition = definition.endEffector;
  if (!endEffectorDefinition) {
    return null;
  }
  const gripperModel = await loadUrdfWithAssets(endEffectorDefinition.urdfPath, registry, {
    [endEffectorDefinition.packageName]: endEffectorDefinition.packagePath,
  });
  if (!gripperModel.joints[endEffectorDefinition.command.jointName]) {
    disposeObjectTree(gripperModel);
    throw new Error(`End-effector config references unknown URDF joint: ${endEffectorDefinition.command.jointName}`);
  }
  const mountFrame = getRobotFrame(model, getFrameName(definition, endEffectorDefinition.mountFrame));
  if (!mountFrame) {
    disposeObjectTree(gripperModel);
    throw new Error(`End-effector mount frame is unavailable: ${endEffectorDefinition.mountFrame}`);
  }

  gripperModel.name = endEffectorDefinition.name;
  gripperModel.position.set(
    endEffectorDefinition.origin.position.x,
    endEffectorDefinition.origin.position.y,
    endEffectorDefinition.origin.position.z,
  );
  gripperModel.rotation.set(
    endEffectorDefinition.origin.rpy.x,
    endEffectorDefinition.origin.rpy.y,
    endEffectorDefinition.origin.rpy.z,
    'XYZ',
  );
  mountFrame.add(gripperModel);
  configureRobotMaterials(gripperModel, materials, collisionVisible);
  return createEndEffectorRuntime(endEffectorDefinition, gripperModel);
}

export function applyRobotJointValues(runtime: LoadedRobotRuntime, values: Partial<JointValues>) {
  for (const spec of runtime.definition.jointSpecs) {
    const value = values[spec.name];
    if (value !== undefined) {
      runtime.model.setJointValue(spec.name, clamp(value, spec.lower, spec.upper));
    }
  }
  runtime.model.updateMatrixWorld(true);
}

export function getRuntimeToolFrame(runtime: LoadedRobotRuntime | null) {
  if (!runtime) {
    return null;
  }
  return runtime.endEffector?.tcpFrame ?? getRobotFrame(runtime.model, getFrameName(runtime.definition));
}

export function detectRuntimeCollisions(
  runtime: LoadedRobotRuntime,
  collisionMaterial: THREE.Material,
  collisionHitMaterial: THREE.Material,
) {
  return detectCollisions(runtime.collisionMeshes, runtime.collisionPairs, collisionMaterial, collisionHitMaterial);
}

export function setRuntimeCollisionVisibility(runtime: LoadedRobotRuntime, visible: boolean) {
  setCollisionVisibility(runtime.collisionMeshes, visible);
}
