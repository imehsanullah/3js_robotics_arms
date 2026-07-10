import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionPlayer, sampleAction } from '../../src/motion/actionPlayer.ts';
import type { RobotActionDefinition, RobotDefinition } from '../../src/robots/types.ts';

const robot = {
  jointSpecs: [
    { name: 'joint1', label: 'Joint 1', lower: -1, upper: 1, velocity: 1, effort: 1 },
    { name: 'joint2', label: 'Joint 2', lower: -2, upper: 2, velocity: 1, effort: 1 },
  ],
  actions: {},
} as RobotDefinition;

const action: RobotActionDefinition = {
  label: 'Test',
  duration: 2,
  keyframes: [
    { time: 0, joints: { joint1: -1, joint2: 0 } },
    { time: 2, joints: { joint1: 1, joint2: 2 } },
  ],
};

test('action sampling clamps endpoints and smoothly interpolates all joints', () => {
  assert.deepEqual(sampleAction(robot, action, -1), { joint1: -1, joint2: 0 });
  assert.deepEqual(sampleAction(robot, action, 1), { joint1: 0, joint2: 1 });
  assert.deepEqual(sampleAction(robot, action, 3), { joint1: 1, joint2: 2 });
});

test('action playback stops at the end of a non-looping action', () => {
  const player = new ActionPlayer();
  robot.actions.test = action;
  player.play('test');
  assert.deepEqual(player.update(robot, 3), { joint1: 1, joint2: 2 });
  assert.equal(player.state.playing, false);
  assert.equal(player.state.elapsed, 2);
});

test('action playback resets when an action is unknown', () => {
  const player = new ActionPlayer();
  player.play('missing');
  assert.equal(player.update(robot, 0.1), null);
  assert.deepEqual(player.state, { actionName: null, elapsed: 0, playing: false });
});
