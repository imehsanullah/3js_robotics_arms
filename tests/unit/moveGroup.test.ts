import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  MoveGroupLite,
  type CartesianPoseTarget,
  type IkResult,
  type MoveGroupAdapter,
  type MoveGroupStatus,
} from '../../src/motion/moveGroup.ts';
import type { JointSpec, JointValues } from '../../src/robots/types.ts';

const jointSpecs: JointSpec[] = [
  { name: 'joint1', label: 'Joint 1', lower: -2, upper: 2, velocity: 2, effort: 10 },
  { name: 'joint2', label: 'Joint 2', lower: -2, upper: 2, velocity: 2, effort: 10 },
];

interface HarnessOptions {
  ready?: boolean;
  collisions?: string[];
  ik?: Partial<IkResult>;
}

function createHarness(options: HarnessOptions = {}) {
  let state: JointValues = { joint1: 0, joint2: 0 };
  let held = 0;
  const statuses: MoveGroupStatus[] = [];
  const adapter: MoveGroupAdapter = {
    isReady: () => options.ready ?? true,
    getCurrentJointValues: () => ({ ...state }),
    setCurrentJointValues: values => { state = { ...values }; },
    holdCurrentState: () => { held += 1; },
    getCurrentPose: () => ({
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      rpy: new THREE.Euler(),
    }),
    solveIk: (_pose: CartesianPoseTarget, seed: JointValues) => ({
      success: true,
      joints: { ...seed, joint1: 0.5 },
      error: 0,
      iterations: 1,
      ...options.ik,
    }),
    checkCollisionsForState: () => options.collisions ?? [],
    onStatusChange: status => { statuses.push(status); },
  };
  const moveIt = new MoveGroupLite(adapter, {
    jointSpecs,
    defaultGroupName: 'manipulator',
    groups: { manipulator: ['joint1', 'joint2'] },
    namedTargets: {
      ready: { joint1: 0.5, joint2: 0 },
      reach: { joint1: 1, joint2: -0.5 },
    },
  });
  return {
    group: moveIt.group(),
    state: () => ({ ...state }),
    held: () => held,
    statuses,
  };
}

globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;

test('planning requires an explicit target and has no implicit ready pose', async () => {
  const { group } = createHarness();
  const plan = await group.plan({ avoidCollisions: false });
  assert.equal(plan.success, false);
  assert.match(plan.warnings.join(' '), /target/i);
});

test('named and joint targets produce executable trajectories', async () => {
  const harness = createHarness();
  const named = await harness.group.setNamedTarget('reach').plan({ avoidCollisions: false });
  assert.equal(named.success, true);
  assert.deepEqual(named.goal, { joint1: 1, joint2: -0.5 });

  const joint = await harness.group.setJointTarget({ joint1: -0.25 }).plan({ avoidCollisions: false });
  assert.equal(joint.success, true);
  assert.deepEqual(joint.goal, { joint1: -0.25, joint2: 0 });
  const result = await harness.group.execute(joint, { speedScale: 5 });
  assert.equal(result.status, 'done');
  assert.deepEqual(harness.state(), joint.goal);
});

test('changing a target invalidates cached and explicitly retained stale plans', async () => {
  const harness = createHarness();
  const oldPlan = await harness.group.setNamedTarget('ready').plan({ avoidCollisions: false });
  harness.group.setNamedTarget('reach');

  const staleResult = await harness.group.execute(oldPlan, { speedScale: 5 });
  assert.equal(staleResult.status, 'failed');
  assert.deepEqual(harness.state(), { joint1: 0, joint2: 0 });

  const currentResult = await harness.group.execute(undefined, { speedScale: 5 });
  assert.equal(currentResult.status, 'done');
  assert.deepEqual(harness.state(), { joint1: 1, joint2: -0.5 });
});

test('collision override bypasses collision-only rejection', async () => {
  const harness = createHarness({ collisions: ['link1 / link3'] });
  const plan = await harness.group.setNamedTarget('ready').plan();
  assert.equal(plan.success, false);
  assert.ok(plan.collisions.length > 0);
  const result = await harness.group.execute(plan, { allowCollisionExecution: true, speedScale: 5 });
  assert.equal(result.status, 'done');
});

test('collision override cannot bypass IK failure or not-ready failure', async () => {
  const failedIk = createHarness({ ik: { success: false, error: 1, message: 'IK failed' } });
  const ikPlan = await failedIk.group.setPoseTarget({ position: { x: 1, y: 0, z: 0 } }).plan({ avoidCollisions: false });
  assert.equal((await failedIk.group.execute(ikPlan, { allowCollisionExecution: true })).status, 'failed');

  const notReady = createHarness({ ready: false });
  const notReadyPlan = await notReady.group.setNamedTarget('ready').plan({ avoidCollisions: false });
  assert.equal((await notReady.group.execute(notReadyPlan, { allowCollisionExecution: true })).status, 'failed');
});

test('targets reject unknown joints and non-finite values', () => {
  const { group } = createHarness();
  assert.throws(() => group.setJointTarget({}), /at least one joint/i);
  assert.throws(() => group.setJointTarget({ missing: 1 }), /unknown joint/i);
  assert.throws(() => group.setJointTarget({ joint1: Number.NaN }), /finite/i);
  assert.throws(() => group.setPoseTarget({ position: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } }), /finite/i);
});

test('planning and execution reject non-finite or unreasonable options', async () => {
  const { group } = createHarness();
  group.setNamedTarget('ready');
  await assert.rejects(group.plan({ maxVelocityScalingFactor: 0 }), /maxVelocityScalingFactor/i);
  await assert.rejects(group.plan({ maxVelocityScalingFactor: Number.NaN }), /maxVelocityScalingFactor/i);
  await assert.rejects(group.plan({ stepsPerSecond: 0 }), /stepsPerSecond/i);
  const plan = await group.plan({ avoidCollisions: false });
  await assert.rejects(group.execute(plan, { speedScale: Number.POSITIVE_INFINITY }), /speedScale/i);
});

test('stop holds the current state and resolves an active execution as stopped', async () => {
  const harness = createHarness();
  const plan = await harness.group.setNamedTarget('reach').plan({ avoidCollisions: false });
  const execution = harness.group.execute(plan, { speedScale: 0.05 });
  harness.group.stop();
  const result = await execution;
  assert.equal(result.status, 'stopped');
  assert.ok(harness.held() >= 1);
  assert.equal(harness.statuses.at(-1)?.state, 'stopped');
});
