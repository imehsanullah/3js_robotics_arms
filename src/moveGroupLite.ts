import * as THREE from 'three';
import type { JointName, JointSpec, JointValues, PoseName } from './robots';
import { clamp } from './robots';

export type { JointValues } from './robots';
export type PartialJointValues = Partial<Record<JointName, number>>;

export interface CartesianPoseTarget {
  position: { x: number; y: number; z: number };
  rpy?: { roll: number; pitch: number; yaw: number };
  quaternion?: { x: number; y: number; z: number; w: number };
}

export interface ToolPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  rpy: THREE.Euler;
}

export interface IkResult {
  success: boolean;
  joints: JointValues;
  error: number;
  iterations: number;
  message?: string;
}

export interface MoveGroupTrajectoryPoint {
  timeFromStart: number;
  positions: JointValues;
}

export type MoveGroupTargetType = 'joint' | 'named' | 'pose';

export interface MoveGroupPlan {
  groupName: string;
  jointNames: JointName[];
  targetType: MoveGroupTargetType;
  start: JointValues;
  goal: JointValues;
  duration: number;
  trajectory: MoveGroupTrajectoryPoint[];
  success: boolean;
  warnings: string[];
  collisions: string[];
}

export interface MoveGroupPlanOptions {
  avoidCollisions?: boolean;
  maxVelocityScalingFactor?: number;
  stepsPerSecond?: number;
}

export interface MoveGroupExecuteOptions {
  allowCollisionExecution?: boolean;
  speedScale?: number;
}

export type MoveGroupExecutionState = 'idle' | 'planning' | 'planned' | 'executing' | 'done' | 'stopped' | 'failed';

export interface MoveGroupStatus {
  groupName: string;
  state: MoveGroupExecutionState;
  message: string;
  plan?: MoveGroupPlan;
}

export interface MoveGroupExecutionResult {
  status: 'done' | 'stopped' | 'failed';
  plan: MoveGroupPlan;
  message: string;
}

export interface MoveGroupAdapter {
  isReady(): boolean;
  getCurrentJointValues(): JointValues;
  setCurrentJointValues(values: JointValues): void;
  holdCurrentState(): void;
  getCurrentPose(): ToolPose | null;
  solveIk(pose: CartesianPoseTarget, seed: JointValues): IkResult;
  checkCollisionsForState?(values: JointValues): string[];
  setPoseTargetVisual?(pose: CartesianPoseTarget): void;
  onStatusChange?(status: MoveGroupStatus): void;
}

export interface MoveGroupLiteOptions {
  jointSpecs: JointSpec[];
  defaultGroupName?: string;
  groups?: Record<string, JointName[]>;
  namedTargets?: Record<string, JointValues>;
}

type TargetSpec =
  | { type: 'named'; name: string }
  | { type: 'joint'; joints: PartialJointValues }
  | { type: 'pose'; pose: CartesianPoseTarget };

export class MoveGroupLite {
  private readonly adapter: MoveGroupAdapter;
  private readonly jointSpecs: JointSpec[];
  private readonly defaultGroupName: string;
  private readonly groups: Record<string, JointName[]>;
  private readonly namedTargets: Record<string, JointValues>;
  private readonly groupInstances = new Map<string, MoveGroup>();

  constructor(adapter: MoveGroupAdapter, options: MoveGroupLiteOptions) {
    this.adapter = adapter;
    this.jointSpecs = options.jointSpecs;
    this.defaultGroupName = options.defaultGroupName ?? 'manipulator';

    const defaultJointNames = this.jointSpecs.map(spec => spec.name);
    this.groups = options.groups ?? {
      manipulator: defaultJointNames,
      arm: defaultJointNames,
    };
    this.namedTargets = options.namedTargets ?? {};
  }

  group(name = this.defaultGroupName) {
    const jointNames = this.groups[name];
    if (!jointNames) {
      throw new Error(`Unknown MoveGroupLite group: ${name}`);
    }

    let group = this.groupInstances.get(name);
    if (!group) {
      group = new MoveGroup(name, jointNames, this.jointSpecs, this.namedTargets, this.adapter);
      this.groupInstances.set(name, group);
    }
    return group;
  }

  getGroupNames() {
    return Object.keys(this.groups);
  }

  getNamedTargets() {
    return Object.keys(this.namedTargets);
  }
}

export class MoveGroup {
  private target: TargetSpec = { type: 'named', name: 'ready' };
  private latestPlan: MoveGroupPlan | null = null;
  private executionToken = 0;

  constructor(
    readonly name: string,
    readonly jointNames: JointName[],
    private readonly jointSpecs: JointSpec[],
    private readonly namedTargets: Record<string, JointValues>,
    private readonly adapter: MoveGroupAdapter,
  ) {}

  setNamedTarget(name: PoseName | string) {
    if (!this.namedTargets[name]) {
      throw new Error(`Unknown named target: ${name}`);
    }
    this.target = { type: 'named', name };
    this.emit('idle', `Target: ${name}`);
    return this;
  }

  setJointValueTarget(joints: PartialJointValues) {
    this.target = { type: 'joint', joints: { ...joints } };
    this.emit('idle', 'Joint target set');
    return this;
  }

  setJointTarget(joints: PartialJointValues) {
    return this.setJointValueTarget(joints);
  }

  setPoseTarget(pose: CartesianPoseTarget) {
    this.target = {
      type: 'pose',
      pose: {
        position: { ...pose.position },
        rpy: pose.rpy ? { ...pose.rpy } : undefined,
        quaternion: pose.quaternion ? { ...pose.quaternion } : undefined,
      },
    };
    this.adapter.setPoseTargetVisual?.(this.target.pose);
    this.emit('idle', 'Pose target set');
    return this;
  }

  clearPoseTargets() {
    if (this.target.type === 'pose') {
      this.target = { type: 'named', name: 'ready' };
    }
    this.emit('idle', 'Pose target cleared');
    return this;
  }

  getCurrentJointValues() {
    return pickJoints(this.adapter.getCurrentJointValues(), this.jointNames);
  }

  getCurrentPose() {
    return this.adapter.getCurrentPose();
  }

  async plan(options: MoveGroupPlanOptions = {}) {
    this.emit('planning', 'Planning');

    const start = this.adapter.getCurrentJointValues();
    const warnings: string[] = [];
    let goal = cloneJointValues(this.jointSpecs, start);
    let success = this.adapter.isReady();

    if (!success) {
      warnings.push('Robot is not ready yet.');
    } else if (this.target.type === 'named') {
      goal = mergeGroupJoints(start, this.namedTargets[this.target.name], this.jointNames);
    } else if (this.target.type === 'joint') {
      goal = mergeGroupJoints(start, this.target.joints, this.jointNames);
    } else {
      const ik = this.adapter.solveIk(this.target.pose, start);
      goal = mergeGroupJoints(start, ik.joints, this.jointNames);
      success = ik.success;
      if (!ik.success) {
        warnings.push(ik.message ?? `IK ended ${ik.error.toFixed(4)} m from the target.`);
      }
      if (this.target.pose.rpy || this.target.pose.quaternion) {
        warnings.push('Orientation target was accepted but current CCD IK solves position only.');
      }
    }

    goal = clampJointValues(this.jointSpecs, goal);
    const maxVelocityScalingFactor = clamp(options.maxVelocityScalingFactor ?? 1, 0.05, 1);
    const trajectory = buildTrajectory(
      this.jointSpecs,
      start,
      goal,
      this.jointNames,
      maxVelocityScalingFactor,
      options.stepsPerSecond ?? 60,
    );
    const duration = trajectory.at(-1)?.timeFromStart ?? 0;
    const collisions = options.avoidCollisions === false ? [] : this.sampleCollisions(trajectory);

    if (collisions.length > 0) {
      success = false;
      warnings.push(`Collision check found ${collisions.length} intersecting pair(s).`);
    }

    const plan: MoveGroupPlan = {
      groupName: this.name,
      jointNames: [...this.jointNames],
      targetType: this.target.type,
      start,
      goal,
      duration,
      trajectory,
      success,
      warnings,
      collisions,
    };

    this.latestPlan = plan;
    this.emit(success ? 'planned' : 'failed', success ? `Plan: ${trajectory.length} points` : 'Plan failed', plan);
    return plan;
  }

  async execute(plan = this.latestPlan, options: MoveGroupExecuteOptions = {}): Promise<MoveGroupExecutionResult> {
    if (!plan) {
      plan = await this.plan();
    }

    if (!plan.success && !options.allowCollisionExecution) {
      const message = plan.warnings[0] ?? 'Plan was not successful.';
      this.emit('failed', message, plan);
      return { status: 'failed', plan, message };
    }

    const token = ++this.executionToken;
    const speedScale = clamp(options.speedScale ?? 1, 0.05, 5);
    const durationMs = (plan.duration * 1000) / speedScale;
    this.emit('executing', 'Executing', plan);

    return new Promise(resolve => {
      const startedAt = performance.now();

      const step = () => {
        if (this.executionToken !== token) {
          this.adapter.holdCurrentState();
          this.emit('stopped', 'Stopped', plan);
          resolve({ status: 'stopped', plan, message: 'Stopped' });
          return;
        }

        if (durationMs <= 0) {
          this.adapter.setCurrentJointValues(plan.goal);
          this.emit('done', 'Done', plan);
          resolve({ status: 'done', plan, message: 'Done' });
          return;
        }

        const elapsedMs = performance.now() - startedAt;
        const trajectoryTime = Math.min(plan.duration, (elapsedMs / 1000) * speedScale);
        this.adapter.setCurrentJointValues(sampleTrajectory(this.jointSpecs, plan.trajectory, trajectoryTime));

        if (elapsedMs >= durationMs) {
          this.adapter.setCurrentJointValues(plan.goal);
          this.emit('done', 'Done', plan);
          resolve({ status: 'done', plan, message: 'Done' });
          return;
        }

        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    });
  }

  async go(options: MoveGroupPlanOptions & MoveGroupExecuteOptions = {}) {
    const plan = await this.plan(options);
    return this.execute(plan, options);
  }

  stop() {
    this.executionToken += 1;
    this.adapter.holdCurrentState();
    this.emit('stopped', 'Stopped');
  }

  private sampleCollisions(trajectory: MoveGroupTrajectoryPoint[]) {
    if (!this.adapter.checkCollisionsForState || trajectory.length === 0) {
      return [];
    }

    const collisions = new Set<string>();
    const stride = Math.max(1, Math.floor(trajectory.length / 30));
    for (let index = 0; index < trajectory.length; index += stride) {
      for (const pair of this.adapter.checkCollisionsForState(trajectory[index].positions)) {
        collisions.add(pair);
      }
    }
    for (const pair of this.adapter.checkCollisionsForState(trajectory[trajectory.length - 1].positions)) {
      collisions.add(pair);
    }

    return [...collisions];
  }

  private emit(state: MoveGroupExecutionState, message: string, plan?: MoveGroupPlan) {
    this.adapter.onStatusChange?.({
      groupName: this.name,
      state,
      message,
      plan,
    });
  }
}

function buildTrajectory(
  jointSpecs: JointSpec[],
  start: JointValues,
  goal: JointValues,
  jointNames: JointName[],
  maxVelocityScalingFactor: number,
  stepsPerSecond: number,
) {
  let duration = 0;
  const specsByName = new Map(jointSpecs.map(spec => [spec.name, spec]));
  for (const jointName of jointNames) {
    const spec = specsByName.get(jointName);
    if (!spec) {
      continue;
    }
    const delta = Math.abs(goal[jointName] - start[jointName]);
    duration = Math.max(duration, delta / (spec.velocity * maxVelocityScalingFactor));
  }

  if (duration < 0.001) {
    return [{ timeFromStart: 0, positions: cloneJointValues(jointSpecs, goal) }];
  }

  duration = Math.max(0.25, duration);
  const steps = Math.max(2, Math.ceil(duration * stepsPerSecond));
  const trajectory: MoveGroupTrajectoryPoint[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const blend = ratio * ratio * (3 - 2 * ratio);
    const positions = cloneJointValues(jointSpecs, start);
    for (const jointName of jointNames) {
      positions[jointName] = start[jointName] + (goal[jointName] - start[jointName]) * blend;
    }
    trajectory.push({
      timeFromStart: duration * ratio,
      positions,
    });
  }

  return trajectory;
}

function sampleTrajectory(jointSpecs: JointSpec[], trajectory: MoveGroupTrajectoryPoint[], timeFromStart: number) {
  if (trajectory.length === 0) {
    throw new Error('Cannot sample an empty trajectory.');
  }
  if (trajectory.length === 1 || timeFromStart <= 0) {
    return cloneJointValues(jointSpecs, trajectory[0].positions);
  }

  const last = trajectory[trajectory.length - 1];
  if (timeFromStart >= last.timeFromStart) {
    return cloneJointValues(jointSpecs, last.positions);
  }

  let upperIndex = 1;
  while (upperIndex < trajectory.length && trajectory[upperIndex].timeFromStart < timeFromStart) {
    upperIndex += 1;
  }

  const lower = trajectory[upperIndex - 1];
  const upper = trajectory[upperIndex];
  const span = upper.timeFromStart - lower.timeFromStart;
  const ratio = span <= 0 ? 1 : (timeFromStart - lower.timeFromStart) / span;
  const positions = cloneJointValues(jointSpecs, lower.positions);

  for (const spec of jointSpecs) {
    positions[spec.name] = lower.positions[spec.name] + (upper.positions[spec.name] - lower.positions[spec.name]) * ratio;
  }

  return positions;
}

function mergeGroupJoints(start: JointValues, values: PartialJointValues, jointNames: JointName[]) {
  const merged = { ...start };
  for (const jointName of jointNames) {
    if (values[jointName] !== undefined) {
      merged[jointName] = values[jointName];
    }
  }
  return merged;
}

function clampJointValues(jointSpecs: JointSpec[], values: JointValues) {
  const clamped = cloneJointValues(jointSpecs, values);
  for (const spec of jointSpecs) {
    clamped[spec.name] = clamp(clamped[spec.name], spec.lower, spec.upper);
  }
  return clamped;
}

function pickJoints(values: JointValues, jointNames: JointName[]) {
  const picked = {} as PartialJointValues;
  for (const jointName of jointNames) {
    picked[jointName] = values[jointName];
  }
  return picked;
}

function cloneJointValues(jointSpecs: JointSpec[], values: JointValues) {
  return Object.fromEntries(jointSpecs.map(spec => [spec.name, values[spec.name]])) as JointValues;
}
