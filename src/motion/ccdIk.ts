import * as THREE from 'three';
import { URDFJoint, URDFRobot } from 'urdf-loader';
import { clamp, cloneJointValues } from '../robots';
import type { JointValues, RobotDefinition } from '../robots';
import type { CartesianPoseTarget, IkResult } from '../moveGroupLite';
import { getRobotFrame } from '../rendering/robotLoader';

export interface CcdIkOptions {
  robot: RobotDefinition;
  model: URDFRobot | null;
  toolFrameName: string;
  toolFrameObject?: THREE.Object3D | null;
  pose: CartesianPoseTarget;
  seed: JointValues;
  getCurrentJointValues: () => JointValues;
  setRobotJointValues: (values: JointValues) => void;
}

export function solveCcdIk(options: CcdIkOptions): IkResult {
  if (!options.model) {
    return {
      success: false,
      joints: cloneJointValues(options.robot, options.seed),
      error: Number.POSITIVE_INFINITY,
      iterations: 0,
      message: 'Robot is not ready yet.',
    };
  }

  const savedCurrent = options.getCurrentJointValues();
  const solution = cloneJointValues(options.robot, options.seed);
  const requestedTarget = new THREE.Vector3(options.pose.position.x, options.pose.position.y, options.pose.position.z);
  options.setRobotJointValues(solution);

  const result = solveCcdPositionTarget(
    options.robot,
    options.model,
    options.toolFrameName,
    options.toolFrameObject ?? null,
    requestedTarget,
    solution,
  );
  options.setRobotJointValues(savedCurrent);
  return result;
}

function solveCcdPositionTarget(
  robotDefinition: RobotDefinition,
  model: URDFRobot,
  toolFrameName: string,
  toolFrameObject: THREE.Object3D | null,
  requestedTarget: THREE.Vector3,
  solution: JointValues,
): IkResult {
  const tool = toolFrameObject ?? getRobotFrame(model, toolFrameName);
  if (!tool) {
    return {
      success: false,
      joints: cloneJointValues(robotDefinition, solution),
      error: Number.POSITIVE_INFINITY,
      iterations: 0,
      message: `${toolFrameName} frame is not available.`,
    };
  }

  const chain = [...robotDefinition.jointSpecs].reverse();
  const toolPosition = new THREE.Vector3();
  const jointPosition = new THREE.Vector3();
  const axisWorld = new THREE.Vector3();
  const jointQuaternion = new THREE.Quaternion();
  const toTool = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const projectedTool = new THREE.Vector3();
  const projectedTarget = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let iterations = 0;

  for (let iteration = 0; iteration < 60; iteration += 1) {
    iterations = iteration + 1;
    model.updateMatrixWorld(true);
    tool.getWorldPosition(toolPosition);
    if (toolPosition.distanceTo(requestedTarget) < 0.006) {
      break;
    }

    for (const spec of chain) {
      const joint = model.joints[spec.name] as URDFJoint | undefined;
      if (!joint) {
        continue;
      }
      joint.getWorldPosition(jointPosition);
      joint.getWorldQuaternion(jointQuaternion);
      axisWorld.copy(joint.axis).applyQuaternion(jointQuaternion).normalize();
      tool.getWorldPosition(toolPosition);

      toTool.subVectors(toolPosition, jointPosition);
      toTarget.subVectors(requestedTarget, jointPosition);
      projectedTool.copy(toTool).addScaledVector(axisWorld, -toTool.dot(axisWorld));
      projectedTarget.copy(toTarget).addScaledVector(axisWorld, -toTarget.dot(axisWorld));
      if (projectedTool.lengthSq() < 0.000001 || projectedTarget.lengthSq() < 0.000001) {
        continue;
      }

      projectedTool.normalize();
      projectedTarget.normalize();
      cross.crossVectors(projectedTool, projectedTarget);
      const angle = Math.atan2(axisWorld.dot(cross), clamp(projectedTool.dot(projectedTarget), -1, 1));
      const limitedAngle = clamp(angle * 0.72, -0.24, 0.24);
      solution[spec.name] = clamp(solution[spec.name] + limitedAngle, spec.lower, spec.upper);
      model.setJointValue(spec.name, solution[spec.name]);
    }
  }

  model.updateMatrixWorld(true);
  tool.getWorldPosition(toolPosition);
  const error = toolPosition.distanceTo(requestedTarget);
  return {
    success: error < 0.012,
    joints: cloneJointValues(robotDefinition, solution),
    error,
    iterations,
    message: error < 0.012 ? undefined : `IK ended ${error.toFixed(4)} m from the target.`,
  };
}
