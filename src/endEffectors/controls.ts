import type { RobotEndEffectorDefinition } from '../robots';
import { clamp } from '../robots';
import { formatEndEffectorOpenPercent } from './state';

export interface EndEffectorControlHandles {
  slider: HTMLInputElement | null;
  output: HTMLOutputElement | null;
}

export function buildEndEffectorControls(
  container: HTMLDivElement,
  definition: RobotEndEffectorDefinition | null,
  value: number,
  onTargetChanged: (value: number) => void,
) {
  container.replaceChildren();

  if (!definition) {
    const message = document.createElement('p');
    message.className = 'quiet';
    message.textContent = 'No end effector configured.';
    container.append(message);
    return { slider: null, output: null };
  }

  const heading = document.createElement('div');
  heading.className = 'joint-heading';

  const label = document.createElement('label');
  label.htmlFor = `${definition.id}-command`;
  label.textContent = definition.command.label;

  const output = document.createElement('output');
  output.htmlFor = `${definition.id}-command`;
  output.textContent = formatEndEffectorOpenPercent(definition, value);

  const input = document.createElement('input');
  input.id = `${definition.id}-command`;
  input.type = 'range';
  input.min = String(definition.command.lower);
  input.max = String(definition.command.upper);
  input.step = '0.001';
  input.value = String(value);
  input.addEventListener('input', () => {
    const next = clamp(Number(input.value), definition.command.lower, definition.command.upper);
    output.textContent = formatEndEffectorOpenPercent(definition, next);
    onTargetChanged(next);
  });

  const actions = document.createElement('div');
  actions.className = 'gripper-actions';
  actions.append(
    createButton('Open', 'unfold-horizontal', () => onTargetChanged(definition.command.open)),
    createButton('Close', 'fold-horizontal', () => onTargetChanged(definition.command.close)),
  );

  const meta = document.createElement('div');
  meta.className = 'joint-meta';
  meta.textContent = `${definition.shortName} | adaptive linkage | ${definition.command.velocity.toFixed(1)} rad/s`;

  heading.append(label, output);
  container.append(heading, input, actions, meta);
  return { slider: input, output };
}

function createButton(label: string, icon: string, onClick: () => void) {
  const button = document.createElement('button');
  button.className = 'text-button';
  button.type = 'button';
  button.title = label;
  button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  button.addEventListener('click', onClick);
  return button;
}
