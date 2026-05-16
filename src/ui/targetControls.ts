import * as THREE from 'three';
import { clamp, formatMeters } from '../robots';

export interface TargetControlMaps {
  inputs: Record<'x' | 'y' | 'z', HTMLInputElement>;
  outputs: Record<'x' | 'y' | 'z', HTMLOutputElement>;
}

const targetSpecs = [
  { key: 'x' as const, label: 'X', min: -0.92, max: 0.92, step: 0.005 },
  { key: 'y' as const, label: 'Y', min: -0.92, max: 0.92, step: 0.005 },
  { key: 'z' as const, label: 'Z', min: 0.02, max: 1.05, step: 0.005 },
];

export function buildTargetControls(
  container: HTMLDivElement,
  targetPosition: THREE.Vector3,
  targetMesh: THREE.Object3D,
  maps: TargetControlMaps,
) {
  container.replaceChildren();
  for (const key of Object.keys(maps.inputs) as Array<'x' | 'y' | 'z'>) {
    delete maps.inputs[key];
    delete maps.outputs[key];
  }

  for (const spec of targetSpecs) {
    const row = document.createElement('label');
    row.className = 'range-row target-row';
    const name = document.createElement('span');
    name.textContent = spec.label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(targetPosition[spec.key]);

    const output = document.createElement('output');
    output.textContent = formatMeters(targetPosition[spec.key]);
    input.addEventListener('input', () => {
      targetPosition[spec.key] = Number(input.value);
      output.textContent = formatMeters(targetPosition[spec.key]);
      targetMesh.position.copy(targetPosition);
    });

    row.append(name, input, output);
    container.append(row);
    maps.inputs[spec.key] = input;
    maps.outputs[spec.key] = output;
  }
}

export function setTargetPositionFromPose(
  position: { x: number; y: number; z: number },
  targetPosition: THREE.Vector3,
  targetMesh: THREE.Object3D,
  maps: TargetControlMaps,
) {
  const clamped = {
    x: clamp(position.x, Number(maps.inputs.x.min), Number(maps.inputs.x.max)),
    y: clamp(position.y, Number(maps.inputs.y.min), Number(maps.inputs.y.max)),
    z: clamp(position.z, Number(maps.inputs.z.min), Number(maps.inputs.z.max)),
  };
  targetPosition.set(clamped.x, clamped.y, clamped.z);
  targetMesh.position.copy(targetPosition);
  for (const key of ['x', 'y', 'z'] as const) {
    maps.inputs[key].value = String(clamped[key]);
    maps.outputs[key].textContent = formatMeters(clamped[key]);
  }
}
