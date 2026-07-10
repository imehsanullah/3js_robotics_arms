import type { JointValues, RobotDefinition } from './types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function getDefaultPreset(robot: RobotDefinition) {
  return robot.presets.ready ?? robot.presets.zero;
}

export function getFrameName(robot: RobotDefinition, frameKey = robot.defaultToolFrame) {
  return robot.toolFrames[frameKey] ?? frameKey;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampJointValues(robot: RobotDefinition, jointValues: Partial<JointValues>) {
  const clamped: JointValues = {};
  for (const spec of robot.jointSpecs) {
    const value = jointValues[spec.name] ?? 0;
    clamped[spec.name] = clamp(value, spec.lower, spec.upper);
  }
  return clamped;
}

export function cloneJointValues(robot: RobotDefinition, valuesToClone: Partial<JointValues>) {
  return clampJointValues(robot, valuesToClone);
}

export function formatDeg(radians: number) {
  return `${(radians * RAD2DEG).toFixed(1)} deg`;
}

export function formatMeters(meters: number) {
  return `${meters.toFixed(3)} m`;
}
