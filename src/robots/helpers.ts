import type {
  JointName,
  JointSpec,
  JointValues,
  RobotActionDefinition,
  RobotDefinition,
  RobotGroupDefinition,
} from './types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

export function joint(name: string, label: string, lower: number, upper: number, velocity: number, effort: number): JointSpec {
  return { name, label, lower, upper, velocity, effort };
}

export function values(jointSpecs: JointSpec[], jointValues: number[]) {
  return Object.fromEntries(jointSpecs.map((spec, index) => [spec.name, jointValues[index] ?? 0])) as JointValues;
}

export function group(name: string, label: string, jointSpecs: JointSpec[], defaultFrame?: string): RobotGroupDefinition {
  return {
    name,
    label,
    jointNames: jointSpecs.map(spec => spec.name),
    defaultFrame,
    supportsIk: Boolean(defaultFrame),
  };
}

export function action(
  name: string,
  label: string,
  duration: number,
  keyframes: Array<{ time: number; joints: Partial<JointValues> }>,
  loop = false,
): RobotActionDefinition {
  return { name, label, duration, keyframes, loop };
}

export function downstream(pairs: [string, string[]][]) {
  return Object.fromEntries(pairs) as Record<string, string[]>;
}

export function serialDownstream(jointSpecs: JointSpec[], childLinks: string[]) {
  return Object.fromEntries(
    jointSpecs.map((spec, index) => [spec.name, childLinks.slice(index)]),
  ) as Record<JointName, string[]>;
}

export function getDefaultPreset(robot: RobotDefinition) {
  return robot.presets.ready ?? robot.presets.zero;
}

export function getDefaultGroup(robot: RobotDefinition) {
  return robot.groups[robot.defaultGroup] ?? Object.values(robot.groups)[0];
}

export function getFrameName(robot: RobotDefinition, frameKey = robot.defaultToolFrame) {
  return robot.toolFrames[frameKey] ?? frameKey;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clampJointValues(robot: RobotDefinition, jointValues: Partial<JointValues>) {
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
