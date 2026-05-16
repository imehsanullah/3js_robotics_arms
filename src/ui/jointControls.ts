import { RAD2DEG, clamp, formatDeg } from '../robots';
import type { JointValues, RobotDefinition } from '../robots';
import type { OutputMap, SliderMap } from '../motion/jointState';
import { readJointSliderRadians } from '../motion/jointState';

export function buildJointControls(
  container: HTMLDivElement,
  robot: RobotDefinition,
  targetJoints: JointValues,
  jointSliders: SliderMap,
  jointOutputs: OutputMap,
  onJointTargetChanged: (jointName: string, value: number) => void,
) {
  container.replaceChildren();
  for (const key of Object.keys(jointSliders)) {
    delete jointSliders[key];
    delete jointOutputs[key];
  }

  for (const spec of robot.jointSpecs) {
    const row = document.createElement('div');
    row.className = 'joint-row';

    const heading = document.createElement('div');
    heading.className = 'joint-heading';

    const label = document.createElement('label');
    label.htmlFor = spec.name;
    label.textContent = spec.label;

    const output = document.createElement('output');
    output.htmlFor = spec.name;
    output.textContent = formatDeg(targetJoints[spec.name]);

    const input = document.createElement('input');
    input.id = spec.name;
    input.type = 'range';
    input.min = String(spec.lower * RAD2DEG);
    input.max = String(spec.upper * RAD2DEG);
    input.step = '0.1';
    input.value = String(targetJoints[spec.name] * RAD2DEG);
    input.addEventListener('input', () => {
      const value = clamp(readJointSliderRadians(input), spec.lower, spec.upper);
      output.textContent = formatDeg(value);
      onJointTargetChanged(spec.name, value);
    });

    const meta = document.createElement('div');
    meta.className = 'joint-meta';
    meta.textContent = `${(spec.lower * RAD2DEG).toFixed(0)} to ${(spec.upper * RAD2DEG).toFixed(0)} deg | ${(
      spec.velocity * RAD2DEG
    ).toFixed(0)} deg/s | ${spec.effort.toFixed(0)} Nm`;

    heading.append(label, output);
    row.append(heading, input, meta);
    container.append(row);
    jointSliders[spec.name] = input;
    jointOutputs[spec.name] = output;
  }
}
