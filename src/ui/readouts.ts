import * as THREE from 'three';
import type { AppElements } from '../app/dom';
import type { MoveGroupStatus } from '../motion/moveGroup';
import { RAD2DEG, formatMeters } from '../robots';
import type { RobotDefinition } from '../robots';

export function updateRobotMetadata(elements: AppElements, robot: RobotDefinition, assetStatus: string) {
  elements.brandName.textContent = robot.shortName;
  elements.brandSubtitle.textContent = 'Browser robot kinematics';
  elements.assetState.textContent = assetStatus;
}

export function resetRobotReadouts(elements: AppElements) {
  elements.readyBadge.classList.remove('is-ready');
  elements.readyBadge.textContent = 'Pending';
  elements.meshOutput.textContent = '--';
  elements.massOutput.textContent = '-- kg';
  elements.reachOutput.textContent = '-- m';
  elements.comOutput.textContent = '-- m';
  elements.poseHud.textContent = 'Tool pose unavailable';
  elements.collisionState.textContent = 'Collision: pending';
  elements.collisionState.classList.remove('is-alert');
}

export function markRobotReady(
  elements: AppElements,
  robot: RobotDefinition,
  visualCount: number,
  collisionCount: number,
  totalMass: number,
) {
  elements.meshOutput.textContent = `${visualCount} visual / ${collisionCount} collision`;
  elements.massOutput.textContent = `${totalMass.toFixed(3)} kg`;
  elements.assetState.textContent = `${robot.shortName} meshes loaded`;
  elements.readyBadge.textContent = 'Ready';
  elements.readyBadge.classList.add('is-ready');
  elements.collisionState.textContent = 'Collision: clear';
}

export function markRobotLoadFailed(elements: AppElements) {
  elements.assetState.textContent = 'URDF failed';
  elements.readyBadge.textContent = 'Error';
  elements.readyBadge.classList.remove('is-ready');
}

export function updateMoveGroupStatus(elements: AppElements, status: MoveGroupStatus) {
  elements.moveGroupState.textContent = `${status.state}: ${status.message}`;
}

export function updatePhysicsReadoutText(options: {
  elements: AppElements;
  toolFrameName: string;
  toolPosition: THREE.Vector3;
  toolQuaternion: THREE.Quaternion;
  totalCom: THREE.Vector3;
  collisions: string[];
}) {
  const euler = new THREE.Euler().setFromQuaternion(options.toolQuaternion, 'XYZ');
  setText(
    options.elements.poseHud,
    `${options.toolFrameName} xyz ${options.toolPosition.x.toFixed(3)}, ${options.toolPosition.y.toFixed(3)}, ${options.toolPosition.z.toFixed(3)} m | rpy ${(euler.x * RAD2DEG).toFixed(1)}, ${(euler.y * RAD2DEG).toFixed(1)}, ${(euler.z * RAD2DEG).toFixed(1)} deg`,
  );
  setText(options.elements.reachOutput, formatMeters(options.toolPosition.length()));
  setText(options.elements.comOutput, formatMeters(options.totalCom.z));
  setText(
    options.elements.collisionState,
    options.collisions.length ? `Collision: ${options.collisions.length}` : 'Collision: clear',
  );
  options.elements.collisionState.classList.toggle('is-alert', options.collisions.length > 0);
}

function setText(node: Node, value: string) {
  if (node.textContent !== value) {
    node.textContent = value;
  }
}
