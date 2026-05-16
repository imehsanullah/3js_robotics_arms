import * as THREE from 'three';
import type { URDFRobot } from 'urdf-loader';
import type { CollisionMesh } from '../physics/types';
import { clamp } from '../robots';
import type { EndEffectorGripMotionMode, RobotEndEffectorDefinition } from '../robots';

export interface ParallelGripContactRuntime {
  enabled: boolean;
  contactValue: number;
  contactWidth: number;
  object: THREE.Mesh;
}

export interface ParallelGripVisualRuntime {
  left: ParallelPadVisual;
  right: ParallelPadVisual;
  sourceLinks: THREE.Object3D[];
  sourceLinkNames: Set<string>;
  padThickness: number;
}

interface ParallelPadVisual {
  visualRoot: THREE.Object3D;
  collisionRoot: THREE.Object3D;
  open: PadPoseSample;
  closed: PadPoseSample;
}

interface PadPoseSample {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export function createParallelGripContact(
  definition: RobotEndEffectorDefinition,
  material: THREE.Material,
): ParallelGripContactRuntime | null {
  const grip = definition.parallelGrip;
  if (!grip) {
    return null;
  }

  const geometry =
    grip.object.shape === 'cylinder'
      ? new THREE.CylinderGeometry(grip.object.size.y / 2, grip.object.size.y / 2, grip.object.size.x, 32)
      : new THREE.BoxGeometry(grip.object.size.x, grip.object.size.y, grip.object.size.z);
  const object = new THREE.Mesh(geometry, material);
  object.name = `${definition.id}_parallel_contact_object`;
  object.castShadow = true;
  object.receiveShadow = true;
  object.position.set(grip.object.position.x, grip.object.position.y, grip.object.position.z);
  object.rotation.set(grip.object.rpy.x, grip.object.rpy.y, grip.object.rpy.z, 'XYZ');

  return {
    enabled: grip.contactEnabled,
    contactValue: getCommandValueForGripWidth(definition, grip.contactWidth),
    contactWidth: grip.contactWidth,
    object,
  };
}

export function createParallelGripVisual(definition: RobotEndEffectorDefinition, model: URDFRobot) {
  if (!definition.parallelGrip) {
    return null;
  }

  const { visual: gripVisual } = definition.parallelGrip;
  const leftPadSource = model.links[gripVisual.leftPadLink];
  const rightPadSource = model.links[gripVisual.rightPadLink];
  if (!leftPadSource || !rightPadSource) {
    return null;
  }

  const left = createParallelPadVisual(definition.id, 'left', leftPadSource);
  const right = createParallelPadVisual(definition.id, 'right', rightPadSource);
  if (!left || !right) {
    return null;
  }

  left.visualRoot.visible = false;
  right.visualRoot.visible = false;
  model.add(left.visualRoot, right.visualRoot);

  const open = definition.command.open;
  const close = definition.command.close;
  model.setJointValue(definition.command.jointName, open);
  model.updateMatrixWorld(true);
  left.open = samplePoseInModel(model, leftPadSource);
  right.open = samplePoseInModel(model, rightPadSource);
  const padThickness = getPadThickness(leftPadSource);

  model.setJointValue(definition.command.jointName, close);
  model.updateMatrixWorld(true);
  left.closed = samplePoseInModel(model, leftPadSource);
  right.closed = samplePoseInModel(model, rightPadSource);

  model.setJointValue(definition.command.jointName, open);
  model.updateMatrixWorld(true);

  return {
    left,
    right,
    sourceLinks: [leftPadSource, rightPadSource],
    sourceLinkNames: collectLinkNames(leftPadSource, rightPadSource),
    padThickness,
  };
}

export function updateParallelGripVisual(
  visual: ParallelGripVisualRuntime | null,
  definition: RobotEndEffectorDefinition,
  value: number,
  motionMode: EndEffectorGripMotionMode,
) {
  if (!visual) {
    return;
  }

  const enabled = motionMode === 'parallel-pinch';
  for (const source of visual.sourceLinks) {
    source.visible = !enabled;
  }
  visual.left.visualRoot.visible = enabled;
  visual.right.visualRoot.visible = enabled;
  if (!enabled) {
    return;
  }

  const width = getGripWidth(definition, value);
  if (width === null) {
    return;
  }

  const progress = getCommandProgress(definition, value);
  const centerOffset = (width + visual.padThickness) / 2;
  const leftSign = Math.sign(visual.left.open.position.y - visual.right.open.position.y) || -1;
  const rightSign = -leftSign;

  applyParallelPadPose(visual.left, progress, leftSign * centerOffset);
  applyParallelPadPose(visual.right, progress, rightSign * centerOffset);
}

export function setParallelGripCollisionVisibility(visual: ParallelGripVisualRuntime | null, visible: boolean) {
  if (!visual) {
    return;
  }

  visual.left.collisionRoot.visible = visible;
  visual.right.collisionRoot.visible = visible;
}

export function collectParallelGripCollisionMeshes(
  visual: ParallelGripVisualRuntime | null,
  material: THREE.Material,
): CollisionMesh[] {
  if (!visual) {
    return [];
  }

  return [
    ...collectParallelFingerCollisionMeshes(visual.left, 'left_parallel_gripper_finger', material),
    ...collectParallelFingerCollisionMeshes(visual.right, 'right_parallel_gripper_finger', material),
  ];
}

export function setParallelGripContactEnabled(contact: ParallelGripContactRuntime | null, enabled: boolean, showObject = false) {
  if (!contact) {
    return;
  }
  contact.enabled = enabled;
  contact.object.visible = enabled && showObject;
}

export function getEffectiveEndEffectorTarget(definition: RobotEndEffectorDefinition, target: number, contact: ParallelGripContactRuntime | null) {
  if (!contact?.enabled) {
    return target;
  }

  const { open, close, lower, upper } = definition.command;
  const closingDirection = Math.sign(close - open);
  if (closingDirection >= 0) {
    return clamp(Math.min(target, contact.contactValue), lower, upper);
  }
  return clamp(Math.max(target, contact.contactValue), lower, upper);
}

export function getGripWidth(definition: RobotEndEffectorDefinition, value: number) {
  const grip = definition.parallelGrip;
  if (!grip) {
    return null;
  }

  const { open, close } = definition.command;
  const commandSpan = close - open;
  if (Math.abs(commandSpan) < 0.000001) {
    return grip.openWidth;
  }

  const progress = clamp((value - open) / commandSpan, 0, 1);
  return grip.openWidth + (grip.closedWidth - grip.openWidth) * progress;
}

export function isAtParallelGripContact(definition: RobotEndEffectorDefinition, current: number, target: number, contact: ParallelGripContactRuntime | null) {
  if (!contact?.enabled) {
    return false;
  }

  const effectiveTarget = getEffectiveEndEffectorTarget(definition, target, contact);
  return Math.abs(effectiveTarget - contact.contactValue) < 0.0005 && Math.abs(current - contact.contactValue) < 0.001;
}

function getCommandValueForGripWidth(definition: RobotEndEffectorDefinition, width: number) {
  const grip = definition.parallelGrip;
  if (!grip) {
    return definition.command.close;
  }

  const widthSpan = grip.closedWidth - grip.openWidth;
  const progress = Math.abs(widthSpan) < 0.000001 ? 0 : clamp((width - grip.openWidth) / widthSpan, 0, 1);
  const { open, close, lower, upper } = definition.command;
  return clamp(open + progress * (close - open), lower, upper);
}

function getCommandProgress(definition: RobotEndEffectorDefinition, value: number) {
  const { open, close } = definition.command;
  const commandSpan = close - open;
  return Math.abs(commandSpan) < 0.000001 ? 0 : clamp((value - open) / commandSpan, 0, 1);
}

function cloneMaterial(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material.map(item => item.clone()) : material.clone();
}

function samplePoseInModel(model: URDFRobot, object: THREE.Object3D): PadPoseSample {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  object.getWorldPosition(position);
  object.getWorldQuaternion(quaternion);
  model.worldToLocal(position);

  const modelQuaternion = new THREE.Quaternion();
  model.getWorldQuaternion(modelQuaternion);
  quaternion.premultiply(modelQuaternion.invert());
  return { position, quaternion };
}

function createParallelPadVisual(
  definitionId: string,
  side: 'left' | 'right',
  padSource: THREE.Object3D,
) {
  const padVisuals = cloneOwnUrdfChildren(padSource, 'isURDFVisual', `${definitionId}_parallel_${side}_pad`);
  if (padVisuals.length === 0) {
    return null;
  }

  const padCollisions = cloneOwnUrdfChildren(padSource, 'isURDFCollider', `${definitionId}_parallel_${side}_pad_collision`);

  const visualRoot = new THREE.Object3D();
  visualRoot.name = `${definitionId}_parallel_${side}_pad_root`;
  visualRoot.add(...padVisuals);

  const collisionRoot = new THREE.Object3D();
  collisionRoot.name = `${definitionId}_parallel_${side}_pad_collision_root`;
  collisionRoot.visible = false;
  collisionRoot.add(...padCollisions);
  visualRoot.add(collisionRoot);

  return {
    visualRoot,
    collisionRoot,
    open: emptyPoseSample(),
    closed: emptyPoseSample(),
  };
}

function cloneOwnUrdfChildren(root: THREE.Object3D, flag: 'isURDFVisual' | 'isURDFCollider', name: string) {
  return root.children
    .filter(child => (child as Partial<Record<typeof flag, boolean>>)[flag])
    .map((child, index) => {
      const clone = child.clone(true);
      clone.name = `${name}_${index}`;
      clone.traverse(object => {
        object.castShadow = true;
        object.receiveShadow = true;
        if (flag === 'isURDFCollider') {
          (object as Partial<{ isURDFCollider: boolean }>).isURDFCollider = false;
        }

        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry instanceof THREE.BufferGeometry) {
          mesh.geometry = mesh.geometry.clone();
          mesh.material = cloneMaterial(mesh.material);
        }
      });
      return clone;
    });
}

function emptyPoseSample(): PadPoseSample {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  };
}

function getPadThickness(padSource: THREE.Object3D) {
  padSource.updateWorldMatrix(true, true);
  const padToWorld = padSource.matrixWorld;
  const worldToPad = padToWorld.clone().invert();
  const box = new THREE.Box3();
  for (const visual of padSource.children) {
    if (!(visual as Partial<{ isURDFVisual: boolean }>).isURDFVisual) {
      continue;
    }
    const visualBox = new THREE.Box3().setFromObject(visual).applyMatrix4(worldToPad);
    box.union(visualBox);
  }

  const size = new THREE.Vector3();
  box.getSize(size);
  return size.y > 0 ? size.y : 0.00635;
}

function applyParallelPadPose(
  visual: ParallelPadVisual,
  progress: number,
  centerY: number,
) {
  visual.visualRoot.position.lerpVectors(visual.open.position, visual.closed.position, progress);
  visual.visualRoot.position.y = centerY;
  visual.visualRoot.quaternion.copy(visual.open.quaternion);
}

function collectParallelFingerCollisionMeshes(
  visual: ParallelPadVisual,
  linkName: string,
  material: THREE.Material,
) {
  const collisionMeshes: CollisionMesh[] = [];
  let index = 0;
  visual.collisionRoot.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
      return;
    }

    mesh.geometry.computeBoundsTree();
    mesh.material = material;
    mesh.visible = true;
    collisionMeshes.push({
      name: mesh.name || `${linkName}_${index}`,
      linkName,
      mesh,
    });
    index += 1;
  });
  return collisionMeshes;
}

function collectLinkNames(...roots: THREE.Object3D[]) {
  const names = new Set<string>();
  for (const root of roots) {
    root.traverse(object => {
      if ((object as Partial<{ isURDFLink: boolean }>).isURDFLink && object.name) {
        names.add(object.name);
      }
    });
  }
  return names;
}
