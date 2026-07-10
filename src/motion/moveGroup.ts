import * as THREE from 'three';
import { clamp } from '../robots';
import type { JointName, JointSpec, JointValues, PoseName } from '../robots';

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
export type MoveGroupFailureReason = 'not-ready' | 'invalid-target' | 'ik' | 'collision';

export interface MoveGroupPlan {
  groupName: string;
  jointNames: JointName[];
  targetType: MoveGroupTargetType | null;
  start: JointValues;
  goal: JointValues;
  duration: number;
  trajectory: MoveGroupTrajectoryPoint[];
  success: boolean;
  failureReasons: MoveGroupFailureReason[];
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
  private readonly groups: Record<string, JointName[]>;
  private readonly defaultGroupName: string;
  private readonly groupInstances = new Map<string, MoveGroup>();

  constructor(
    private readonly adapter: MoveGroupAdapter,
    private readonly options: MoveGroupLiteOptions,
  ) {
    const defaultJointNames = options.jointSpecs.map(spec => spec.name);
    this.groups = options.groups ?? { manipulator: defaultJointNames };
    this.defaultGroupName = options.defaultGroupName ?? Object.keys(this.groups)[0] ?? 'manipulator';
    if (!this.groups[this.defaultGroupName]) {
      throw new Error(`Unknown default MoveGroupLite group: ${this.defaultGroupName}`);
    }
    const knownJoints = new Set(defaultJointNames);
    for (const [name, jointNames] of Object.entries(this.groups)) {
      if (jointNames.length === 0 || new Set(jointNames).size !== jointNames.length) {
        throw new Error(`MoveGroupLite group ${name} must contain unique joints.`);
      }
      for (const jointName of jointNames) {
        if (!knownJoints.has(jointName)) {
          throw new Error(`MoveGroupLite group ${name} references unknown joint: ${jointName}`);
        }
      }
    }
  }

  group(name = this.defaultGroupName) {
    const jointNames = this.groups[name];
    if (!jointNames) {
      throw new Error(`Unknown MoveGroupLite group: ${name}`);
    }
    let group = this.groupInstances.get(name);
    if (!group) {
      group = new MoveGroup(
        name,
        jointNames,
        this.options.jointSpecs,
        this.options.namedTargets ?? {},
        this.adapter,
      );
      this.groupInstances.set(name, group);
    }
    return group;
  }

  getGroupNames() {
    return Object.keys(this.groups);
  }

  getNamedTargets() {
    return Object.keys(this.options.namedTargets ?? {});
  }
}

export class MoveGroup {
  private target: TargetSpec | null = null;
  private latestPlan: MoveGroupPlan | null = null;
  private targetRevision = 0;
  private executionToken = 0;
  private readonly planRevisions = new WeakMap<MoveGroupPlan, number>();
  private readonly specsByName: Map<string, JointSpec>;

  constructor(
    readonly name: string,
    readonly jointNames: JointName[],
    private readonly jointSpecs: JointSpec[],
    private readonly namedTargets: Record<string, JointValues>,
    private readonly adapter: MoveGroupAdapter,
  ) {
    this.specsByName = new Map(jointSpecs.map(spec => [spec.name, spec]));
  }

  setNamedTarget(name: PoseName | string) {
    const values = this.namedTargets[name];
    if (!values) {
      throw new Error(`Unknown named target: ${name}`);
    }
    this.validateJointTarget(values);
    this.target = { type: 'named', name };
    this.invalidatePlan();
    this.emit('idle', `Target: ${name}`);
    return this;
  }

  setJointValueTarget(joints: PartialJointValues) {
    this.validateJointTarget(joints);
    this.target = { type: 'joint', joints: { ...joints } };
    this.invalidatePlan();
    this.emit('idle', 'Joint target set');
    return this;
  }

  setJointTarget(joints: PartialJointValues) {
    return this.setJointValueTarget(joints);
  }

  setPoseTarget(pose: CartesianPoseTarget) {
    validatePose(pose);
    this.target = {
      type: 'pose',
      pose: {
        position: { ...pose.position },
        rpy: pose.rpy ? { ...pose.rpy } : undefined,
        quaternion: pose.quaternion ? { ...pose.quaternion } : undefined,
      },
    };
    this.invalidatePlan();
    this.adapter.setPoseTargetVisual?.(this.target.pose);
    this.emit('idle', 'Pose target set');
    return this;
  }

  clearPoseTargets() {
    if (this.target?.type === 'pose') {
      this.target = null;
      this.invalidatePlan();
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
    const validatedOptions = validatePlanOptions(options);
    this.emit('planning', 'Planning');

    const start = normalizeCurrentState(this.jointSpecs, this.adapter.getCurrentJointValues());
    const warnings: string[] = [];
    const failureReasons: MoveGroupFailureReason[] = [];
    let goal = cloneJointValues(this.jointSpecs, start);
    const target = this.target;

    if (!this.adapter.isReady()) {
      failureReasons.push('not-ready');
      warnings.push('Robot is not ready yet.');
    }
    if (!target) {
      failureReasons.push('invalid-target');
      warnings.push('No target has been set.');
    } else if (failureReasons.length === 0 && target.type === 'named') {
      goal = mergeGroupJoints(start, this.namedTargets[target.name], this.jointNames);
    } else if (failureReasons.length === 0 && target.type === 'joint') {
      goal = mergeGroupJoints(start, target.joints, this.jointNames);
    } else if (failureReasons.length === 0 && target.type === 'pose') {
      const ik = this.adapter.solveIk(target.pose, start);
      goal = mergeGroupJoints(start, ik.joints, this.jointNames);
      if (!ik.success) {
        failureReasons.push('ik');
        warnings.push(ik.message ?? `IK ended ${ik.error.toFixed(4)} m from the target.`);
      }
      if (target.pose.rpy || target.pose.quaternion) {
        warnings.push('Orientation target was accepted but current CCD IK solves position only.');
      }
    }

    goal = clampJointValues(this.jointSpecs, goal);
    const trajectory = buildTrajectory(
      this.jointSpecs,
      start,
      goal,
      this.jointNames,
      validatedOptions.maxVelocityScalingFactor,
      validatedOptions.stepsPerSecond,
    );
    const collisions =
      failureReasons.length === 0 && validatedOptions.avoidCollisions ? this.sampleCollisions(trajectory) : [];
    if (collisions.length > 0) {
      failureReasons.push('collision');
      warnings.push(`Collision check found ${collisions.length} intersecting pair(s).`);
    }

    const plan: MoveGroupPlan = {
      groupName: this.name,
      jointNames: [...this.jointNames],
      targetType: this.target?.type ?? null,
      start,
      goal,
      duration: trajectory.at(-1)?.timeFromStart ?? 0,
      trajectory,
      success: failureReasons.length === 0,
      failureReasons,
      warnings,
      collisions,
    };
    this.latestPlan = plan;
    this.planRevisions.set(plan, this.targetRevision);
    this.emit(plan.success ? 'planned' : 'failed', plan.success ? `Plan: ${trajectory.length} points` : 'Plan failed', plan);
    return plan;
  }

  async execute(plan = this.latestPlan, options: MoveGroupExecuteOptions = {}): Promise<MoveGroupExecutionResult> {
    const validatedOptions = validateExecuteOptions(options);
    if (!plan) {
      plan = await this.plan();
    }
    if (this.planRevisions.get(plan) !== this.targetRevision) {
      return this.failExecution(plan, 'Plan is stale because the target changed.');
    }
    const collisionOnlyFailure =
      plan.failureReasons.length > 0 && plan.failureReasons.every(reason => reason === 'collision');
    if (!plan.success && !(validatedOptions.allowCollisionExecution && collisionOnlyFailure)) {
      return this.failExecution(plan, plan.warnings[0] ?? 'Plan was not successful.');
    }

    const token = ++this.executionToken;
    const durationMs = (plan.duration * 1000) / validatedOptions.speedScale;
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
        const trajectoryTime = Math.min(plan.duration, (elapsedMs / 1000) * validatedOptions.speedScale);
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

  private validateJointTarget(values: PartialJointValues) {
    if (Object.keys(values).length === 0) {
      throw new Error('Joint target must contain at least one joint.');
    }
    for (const [jointName, value] of Object.entries(values)) {
      if (!this.jointNames.includes(jointName) || !this.specsByName.has(jointName)) {
        throw new Error(`Unknown joint in target: ${jointName}`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Joint target must be finite: ${jointName}`);
      }
      const spec = this.specsByName.get(jointName)!;
      if (value < spec.lower || value > spec.upper) {
        throw new Error(`Joint target is outside the valid range: ${jointName}`);
      }
    }
  }

  private invalidatePlan() {
    this.targetRevision += 1;
    this.latestPlan = null;
  }

  private failExecution(plan: MoveGroupPlan, message: string): MoveGroupExecutionResult {
    this.emit('failed', message, plan);
    return { status: 'failed', plan, message };
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
    this.adapter.onStatusChange?.({ groupName: this.name, state, message, plan });
  }
}

function validatePlanOptions(options: MoveGroupPlanOptions) {
  const maxVelocityScalingFactor = options.maxVelocityScalingFactor ?? 1;
  if (!Number.isFinite(maxVelocityScalingFactor) || maxVelocityScalingFactor <= 0 || maxVelocityScalingFactor > 1) {
    throw new Error('maxVelocityScalingFactor must be finite and in the range (0, 1].');
  }
  const stepsPerSecond = options.stepsPerSecond ?? 60;
  if (!Number.isFinite(stepsPerSecond) || stepsPerSecond < 1 || stepsPerSecond > 240) {
    throw new Error('stepsPerSecond must be finite and in the range [1, 240].');
  }
  if (options.avoidCollisions !== undefined && typeof options.avoidCollisions !== 'boolean') {
    throw new Error('avoidCollisions must be a boolean.');
  }
  return { maxVelocityScalingFactor, stepsPerSecond, avoidCollisions: options.avoidCollisions !== false };
}

function validateExecuteOptions(options: MoveGroupExecuteOptions) {
  const speedScale = options.speedScale ?? 1;
  if (!Number.isFinite(speedScale) || speedScale <= 0 || speedScale > 5) {
    throw new Error('speedScale must be finite and in the range (0, 5].');
  }
  if (options.allowCollisionExecution !== undefined && typeof options.allowCollisionExecution !== 'boolean') {
    throw new Error('allowCollisionExecution must be a boolean.');
  }
  return { speedScale, allowCollisionExecution: options.allowCollisionExecution === true };
}

function validatePose(pose: CartesianPoseTarget) {
  validateFiniteRecord(pose.position, ['x', 'y', 'z'], 'position');
  if (pose.rpy) {
    validateFiniteRecord(pose.rpy, ['roll', 'pitch', 'yaw'], 'rpy');
  }
  if (pose.quaternion) {
    validateFiniteRecord(pose.quaternion, ['x', 'y', 'z', 'w'], 'quaternion');
    const { x, y, z, w } = pose.quaternion;
    if (x * x + y * y + z * z + w * w < 1e-12) {
      throw new Error('Pose quaternion must not be zero length.');
    }
  }
}

function validateFiniteRecord(record: Record<string, number>, keys: string[], label: string) {
  for (const key of keys) {
    if (!Number.isFinite(record[key])) {
      throw new Error(`Pose ${label}.${key} must be finite.`);
    }
  }
}

function normalizeCurrentState(jointSpecs: JointSpec[], values: JointValues) {
  const normalized: JointValues = {};
  for (const spec of jointSpecs) {
    const value = values[spec.name];
    if (!Number.isFinite(value)) {
      throw new Error(`Current joint state must be finite: ${spec.name}`);
    }
    normalized[spec.name] = clamp(value, spec.lower, spec.upper);
  }
  return normalized;
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
    const spec = specsByName.get(jointName)!;
    duration = Math.max(duration, Math.abs(goal[jointName] - start[jointName]) / (spec.velocity * maxVelocityScalingFactor));
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
    trajectory.push({ timeFromStart: duration * ratio, positions });
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
  while (trajectory[upperIndex].timeFromStart < timeFromStart) {
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
  return Object.fromEntries(jointNames.map(jointName => [jointName, values[jointName]])) as PartialJointValues;
}

function cloneJointValues(jointSpecs: JointSpec[], values: JointValues) {
  return Object.fromEntries(jointSpecs.map(spec => [spec.name, values[spec.name]])) as JointValues;
}
