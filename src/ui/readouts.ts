import * as THREE from 'three';
import { RAD2DEG, clamp, formatMeters } from '../robots';
import type { RobotDefinition } from '../robots';
import type { AppElements } from '../app/dom';
import type { MoveGroupStatus } from '../moveGroupLite';
import type { TorqueSample } from '../physics/types';

export function updateRobotMetadata(elements: AppElements, robot: RobotDefinition, assetStatus: string) {
  elements.brandName.textContent = robot.shortName;
  elements.brandSubtitle.textContent = 'Browser robot physics';
  elements.assetDescription.textContent = robot.description;
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
}

export function markRobotReady(elements: AppElements, robot: RobotDefinition, visualCount: number, collisionCount: number, totalMass: number) {
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
  robot: RobotDefinition;
  toolFrameName: string;
  toolPosition: THREE.Vector3;
  toolQuaternion: THREE.Quaternion;
  totalCom: THREE.Vector3;
  torques: TorqueSample[];
  collisions: string[];
}) {
  const euler = new THREE.Euler().setFromQuaternion(options.toolQuaternion, 'XYZ');
  options.elements.poseHud.textContent = `${options.toolFrameName} xyz ${options.toolPosition.x.toFixed(3)}, ${options.toolPosition.y.toFixed(
    3,
  )}, ${options.toolPosition.z.toFixed(3)} m | rpy ${(euler.x * RAD2DEG).toFixed(1)}, ${(
    euler.y * RAD2DEG
  ).toFixed(1)}, ${(euler.z * RAD2DEG).toFixed(1)} deg`;
  options.elements.reachOutput.textContent = formatMeters(options.toolPosition.length());
  options.elements.comOutput.textContent = formatMeters(options.totalCom.z);
  options.elements.collisionState.textContent = options.collisions.length
    ? `Collision: ${options.collisions.length}`
    : 'Collision: clear';
  options.elements.collisionState.classList.toggle('is-alert', options.collisions.length > 0);

  options.elements.torqueReadout.replaceChildren(
    ...options.torques.map(sample => {
      const spec = options.robot.jointSpecs.find(item => item.name === sample.jointName);
      const row = document.createElement('div');
      row.className = 'torque-row';
      const label = document.createElement('span');
      label.textContent = spec?.label ?? sample.jointName;
      const bar = document.createElement('span');
      bar.className = 'torque-bar';
      const fill = document.createElement('span');
      const ratio = sample.effort <= 0 ? 0 : clamp(Math.abs(sample.torque) / sample.effort, 0, 1);
      fill.style.width = `${(ratio * 100).toFixed(1)}%`;
      fill.className = ratio > 0.85 ? 'is-hot' : ratio > 0.6 ? 'is-warm' : '';
      bar.append(fill);
      const value = document.createElement('output');
      value.textContent = `${sample.torque.toFixed(2)} Nm`;
      row.append(label, bar, value);
      return row;
    }),
  );

  if (options.collisions.length === 0) {
    const clear = document.createElement('p');
    clear.className = 'quiet';
    clear.textContent = 'No active mesh intersections.';
    options.elements.collisionReadout.replaceChildren(clear);
  } else {
    options.elements.collisionReadout.replaceChildren(
      ...options.collisions.map(pair => {
        const item = document.createElement('p');
        item.className = 'collision-pair';
        item.textContent = pair;
        return item;
      }),
    );
  }
}
