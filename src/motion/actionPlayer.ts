import { clamp, cloneJointValues } from '../robots';
import type { JointValues, RobotActionDefinition, RobotDefinition } from '../robots';

export interface ActionPlayerState {
  actionName: string | null;
  elapsed: number;
  playing: boolean;
}

export class ActionPlayer {
  readonly state: ActionPlayerState = {
    actionName: null,
    elapsed: 0,
    playing: false,
  };

  play(actionName: string, restart = true) {
    if (restart || this.state.actionName !== actionName) {
      this.state.actionName = actionName;
      this.state.elapsed = 0;
    }
    this.state.playing = true;
  }

  stop() {
    this.state.playing = false;
  }

  reset() {
    this.state.actionName = null;
    this.state.elapsed = 0;
    this.state.playing = false;
  }

  update(robot: RobotDefinition, delta: number) {
    if (!this.state.playing || !this.state.actionName) {
      return null;
    }

    const action = robot.actions[this.state.actionName];
    if (!action) {
      this.reset();
      return null;
    }

    this.state.elapsed += delta;
    if (this.state.elapsed > action.duration) {
      if (action.loop) {
        this.state.elapsed %= action.duration;
      } else {
        this.state.elapsed = action.duration;
        this.state.playing = false;
      }
    }

    return sampleAction(robot, action, this.state.elapsed);
  }
}

export function sampleAction(robot: RobotDefinition, action: RobotActionDefinition, time: number): JointValues {
  const sortedKeyframes = [...action.keyframes].sort((a, b) => a.time - b.time);
  if (sortedKeyframes.length === 0) {
    return cloneJointValues(robot, {});
  }

  const first = sortedKeyframes[0];
  if (time <= first.time || sortedKeyframes.length === 1) {
    return cloneJointValues(robot, first.joints);
  }

  const last = sortedKeyframes[sortedKeyframes.length - 1];
  if (time >= last.time) {
    return cloneJointValues(robot, last.joints);
  }

  let upperIndex = 1;
  while (upperIndex < sortedKeyframes.length && sortedKeyframes[upperIndex].time < time) {
    upperIndex += 1;
  }

  const lower = sortedKeyframes[upperIndex - 1];
  const upper = sortedKeyframes[upperIndex];
  const span = upper.time - lower.time;
  const ratio = span <= 0 ? 1 : clamp((time - lower.time) / span, 0, 1);
  const blend = ratio * ratio * (3 - 2 * ratio);
  const sampled: JointValues = {};

  for (const spec of robot.jointSpecs) {
    const start = lower.joints[spec.name] ?? 0;
    const goal = upper.joints[spec.name] ?? start;
    sampled[spec.name] = clamp(start + (goal - start) * blend, spec.lower, spec.upper);
  }

  return sampled;
}
