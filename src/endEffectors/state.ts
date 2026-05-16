import * as THREE from 'three';
import type { URDFRobot } from 'urdf-loader';
import { clamp } from '../robots';
import type { EndEffectorGripMotionMode, RobotEndEffectorDefinition } from '../robots';
import {
  getEffectiveEndEffectorTarget,
  getGripWidth,
  isAtParallelGripContact,
  setParallelGripContactEnabled,
  createParallelGripVisual,
  updateParallelGripVisual,
} from './contact';
import type { ParallelGripContactRuntime, ParallelGripVisualRuntime } from './contact';

export interface EndEffectorRuntime {
  definition: RobotEndEffectorDefinition;
  model: URDFRobot;
  tcpFrame: THREE.Object3D;
  contact: ParallelGripContactRuntime | null;
  parallelVisual: ParallelGripVisualRuntime | null;
  motionMode: EndEffectorGripMotionMode;
  current: number;
  target: number;
}

export function createEndEffectorRuntime(
  definition: RobotEndEffectorDefinition,
  model: URDFRobot,
  contact: ParallelGripContactRuntime | null = null,
) {
  const tcpFrame = new THREE.Object3D();
  tcpFrame.name = `${definition.id}_tcp`;
  tcpFrame.position.set(definition.tcpOffset.x, definition.tcpOffset.y, definition.tcpOffset.z);
  model.add(tcpFrame);

  const initial = clamp(definition.command.open, definition.command.lower, definition.command.upper);
  const parallelVisual = createParallelGripVisual(definition, model);
  const runtime: EndEffectorRuntime = {
    definition,
    model,
    tcpFrame,
    contact,
    parallelVisual,
    motionMode: definition.parallelGrip?.motionMode ?? 'adaptive-linkage',
    current: initial,
    target: initial,
  };
  setParallelGripContactEnabled(contact, contact?.enabled ?? false, definition.parallelGrip?.showContactObject ?? false);
  applyEndEffectorValue(runtime, initial);
  return runtime;
}

export function setEndEffectorTarget(runtime: EndEffectorRuntime, value: number) {
  runtime.target = clamp(value, runtime.definition.command.lower, runtime.definition.command.upper);
}

export function applyEndEffectorStep(runtime: EndEffectorRuntime, speedScale: number, delta: number, force = false) {
  const effectiveTarget = getEffectiveEndEffectorTarget(runtime.definition, runtime.target, runtime.contact);
  const maxStep = runtime.definition.command.velocity * speedScale * delta;
  const diff = effectiveTarget - runtime.current;
  const next = force ? effectiveTarget : runtime.current + clamp(diff, -maxStep, maxStep);
  const moving = Math.abs(diff) > 0.0005;
  applyEndEffectorValue(runtime, next);
  return moving;
}

export function applyEndEffectorValue(runtime: EndEffectorRuntime, value: number) {
  runtime.current = clamp(value, runtime.definition.command.lower, runtime.definition.command.upper);
  runtime.model.setJointValue(runtime.definition.command.jointName, runtime.current);
  updateParallelGripVisual(runtime.parallelVisual, runtime.definition, runtime.current, runtime.motionMode);
}

export function formatEndEffectorOpenPercent(definition: RobotEndEffectorDefinition, value: number) {
  const { open, close } = definition.command;
  const span = close - open;
  if (Math.abs(span) < 0.000001) {
    return 'Open';
  }

  const openRatio = 1 - (value - open) / span;
  return `${(clamp(openRatio, 0, 1) * 100).toFixed(0)}% open`;
}

export function formatEndEffectorRuntimeState(runtime: EndEffectorRuntime) {
  const width = getGripWidth(runtime.definition, runtime.current);
  if (isAtParallelGripContact(runtime.definition, runtime.current, runtime.target, runtime.contact)) {
    return `Contact ${formatGripWidth(width ?? runtime.contact?.contactWidth ?? null)}`;
  }

  if (width !== null) {
    return `Gap ${formatGripWidth(width)}`;
  }

  const openPercent = formatEndEffectorOpenPercent(runtime.definition, runtime.current);
  return openPercent;
}

export function getEndEffectorOpening(runtime: EndEffectorRuntime) {
  return getGripWidth(runtime.definition, runtime.current);
}

export function setEndEffectorMotionMode(runtime: EndEffectorRuntime, motionMode: EndEffectorGripMotionMode) {
  runtime.motionMode = motionMode;
  if (motionMode === 'parallel-pinch') {
    setEndEffectorContactPreview(runtime, false);
  }
  updateParallelGripVisual(runtime.parallelVisual, runtime.definition, runtime.current, runtime.motionMode);
}

export function setEndEffectorContactPreview(runtime: EndEffectorRuntime, enabled: boolean, showObject = enabled) {
  setParallelGripContactEnabled(runtime.contact, enabled, showObject);
}

function formatGripWidth(width: number | null) {
  return width === null ? '' : `${(width * 1000).toFixed(0)} mm`;
}
