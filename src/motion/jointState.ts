import { DEG2RAD, RAD2DEG, clamp, cloneJointValues, formatDeg } from '../robots';
import type { JointName, JointValues, RobotDefinition } from '../robots';

export type SliderMap = Record<JointName, HTMLInputElement>;
export type OutputMap = Record<JointName, HTMLOutputElement>;

export interface JointStateStore {
  currentJoints: JointValues;
  targetJoints: JointValues;
  syncRobot(robot: RobotDefinition, values: JointValues): void;
  getCurrent(robot: RobotDefinition): JointValues;
  setTargets(robot: RobotDefinition, values: Partial<Record<JointName, number>>, updateControls?: boolean): void;
  setCurrent(
    robot: RobotDefinition,
    values: Partial<Record<JointName, number>>,
    options: { syncTarget: boolean; updateControls: boolean },
  ): void;
  applyStep(
    robot: RobotDefinition,
    speedScale: number,
    delta: number,
    force?: boolean,
  ): { changed: boolean; moving: boolean };
}

export function createJointStateStore(jointSliders: SliderMap, jointOutputs: OutputMap): JointStateStore {
  const currentJoints: JointValues = {};
  const targetJoints: JointValues = {};

  function syncRobot(robot: RobotDefinition, values: JointValues) {
    for (const key of Object.keys(currentJoints)) {
      delete currentJoints[key];
      delete targetJoints[key];
    }

    for (const spec of robot.jointSpecs) {
      const value = clamp(values[spec.name] ?? 0, spec.lower, spec.upper);
      currentJoints[spec.name] = value;
      targetJoints[spec.name] = value;
    }
  }

  function getCurrent(robot: RobotDefinition) {
    return cloneJointValues(robot, currentJoints);
  }

  function setTargets(robot: RobotDefinition, values: Partial<Record<JointName, number>>, updateControls = false) {
    for (const spec of robot.jointSpecs) {
      const next = values[spec.name];
      if (next === undefined) {
        continue;
      }
      targetJoints[spec.name] = clamp(next, spec.lower, spec.upper);
      if (updateControls && jointSliders[spec.name] && jointOutputs[spec.name]) {
        jointSliders[spec.name].value = String(targetJoints[spec.name] * RAD2DEG);
        setText(jointOutputs[spec.name], formatDeg(targetJoints[spec.name]));
      }
    }
  }

  function setCurrent(
    robot: RobotDefinition,
    values: Partial<Record<JointName, number>>,
    options: { syncTarget: boolean; updateControls: boolean },
  ) {
    for (const spec of robot.jointSpecs) {
      const next = values[spec.name];
      if (next === undefined) {
        continue;
      }
      const clamped = clamp(next, spec.lower, spec.upper);
      currentJoints[spec.name] = clamped;
      if (options.syncTarget) {
        targetJoints[spec.name] = clamped;
      }
      if (options.updateControls && jointSliders[spec.name] && jointOutputs[spec.name]) {
        jointSliders[spec.name].value = String(clamped * RAD2DEG);
        setText(jointOutputs[spec.name], formatDeg(clamped));
      }
    }
  }

  function applyStep(robot: RobotDefinition, speedScale: number, delta: number, force = false) {
    let moving = false;
    let changed = false;
    for (const spec of robot.jointSpecs) {
      const current = currentJoints[spec.name];
      const target = clamp(targetJoints[spec.name], spec.lower, spec.upper);
      const diff = target - current;
      if (Math.abs(diff) > 0.0005) {
        moving = true;
      }
      const maxStep = spec.velocity * speedScale * delta;
      const next = force || Math.abs(diff) <= 0.0005 ? target : current + clamp(diff, -maxStep, maxStep);
      if (Math.abs(next - current) > 1e-9) {
        changed = true;
        currentJoints[spec.name] = next;
        if (jointOutputs[spec.name]) {
          setText(jointOutputs[spec.name], formatDeg(next));
        }
      }
    }
    return { changed, moving };
  }

  return { currentJoints, targetJoints, syncRobot, getCurrent, setTargets, setCurrent, applyStep };
}

function setText(node: Node, value: string) {
  if (node.textContent !== value) {
    node.textContent = value;
  }
}

export function readJointSliderRadians(input: HTMLInputElement) {
  return Number(input.value) * DEG2RAD;
}
