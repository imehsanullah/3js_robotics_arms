import * as THREE from 'three';
import { URDFJoint, URDFRobot } from 'urdf-loader';
import type { RobotDefinition } from '../robots';
import type { InertialLink, TorqueSample } from './types';

export function computeGravityTorques(robotDefinition: RobotDefinition, model: URDFRobot | null, inertialLinks: InertialLink[]) {
  if (!model || !robotDefinition.capabilities.supportsGravityTorques) {
    return [];
  }

  const gravity = new THREE.Vector3(0, 0, -9.80665);
  const torqueSamples: TorqueSample[] = [];
  const jointPosition = new THREE.Vector3();
  const axisWorld = new THREE.Vector3();
  const jointQuaternion = new THREE.Quaternion();
  const cog = new THREE.Vector3();
  const radius = new THREE.Vector3();
  const force = new THREE.Vector3();
  const moment = new THREE.Vector3();

  for (const spec of robotDefinition.jointSpecs) {
    const joint = model.joints[spec.name] as URDFJoint | undefined;
    if (!joint) {
      continue;
    }
    joint.getWorldPosition(jointPosition);
    joint.getWorldQuaternion(jointQuaternion);
    axisWorld.copy(joint.axis).applyQuaternion(jointQuaternion).normalize();

    let torque = 0;
    const downstream = robotDefinition.downstreamLinks[spec.name] ?? [];
    for (const linkSample of inertialLinks) {
      if (!downstream.includes(linkSample.name)) {
        continue;
      }
      cog.copy(linkSample.localCog);
      linkSample.link.localToWorld(cog);
      radius.subVectors(cog, jointPosition);
      force.copy(gravity).multiplyScalar(linkSample.mass);
      moment.crossVectors(radius, force);
      torque += axisWorld.dot(moment);
    }
    torqueSamples.push({ jointName: spec.name, torque, effort: spec.effort });
  }

  return torqueSamples;
}
