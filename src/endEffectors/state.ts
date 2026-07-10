import * as THREE from 'three';
import type { URDFRobot } from 'urdf-loader';
import { clamp } from '../robots';
import type { RobotEndEffectorDefinition } from '../robots';

const ROBOTIQ_2F85_OPENING = 0.085;
const ROBOTIQ_2F85_CLOSED_OPENING = 0.008;

export interface EndEffectorRuntime {
  definition: RobotEndEffectorDefinition;
  model: URDFRobot;
  tcpFrame: THREE.Object3D;
  current: number;
  target: number;
}

export function createEndEffectorRuntime(definition: RobotEndEffectorDefinition, model: URDFRobot) {
  const tcpFrame = new THREE.Object3D();
  tcpFrame.name = `${definition.id}_tcp`;
  tcpFrame.position.set(definition.tcpOffset.x, definition.tcpOffset.y, definition.tcpOffset.z);
  model.add(tcpFrame);

  const initial = clamp(definition.command.open, definition.command.lower, definition.command.upper);
  const runtime: EndEffectorRuntime = { definition, model, tcpFrame, current: initial, target: initial };
  applyEndEffectorValue(runtime, initial);
  return runtime;
}

export function setEndEffectorTarget(runtime: EndEffectorRuntime, value: number) {
  if (!Number.isFinite(value)) {
    throw new Error('End-effector target must be finite.');
  }
  runtime.target = clamp(value, runtime.definition.command.lower, runtime.definition.command.upper);
}

export function applyEndEffectorStep(runtime: EndEffectorRuntime, speedScale: number, delta: number, force = false) {
  const maxStep = runtime.definition.command.velocity * speedScale * delta;
  const diff = runtime.target - runtime.current;
  if (!force && Math.abs(diff) <= 0.0005) {
    return false;
  }
  const next = force ? runtime.target : runtime.current + clamp(diff, -maxStep, maxStep);
  const moving = Math.abs(diff) > 0.0005;
  applyEndEffectorValue(runtime, next);
  return moving;
}

function applyEndEffectorValue(runtime: EndEffectorRuntime, value: number) {
  runtime.current = clamp(value, runtime.definition.command.lower, runtime.definition.command.upper);
  runtime.model.setJointValue(runtime.definition.command.jointName, runtime.current);
  runtime.model.updateMatrixWorld(true);
}

export function formatEndEffectorOpenPercent(definition: RobotEndEffectorDefinition, value: number) {
  const progress = getClosingProgress(definition, value);
  return `${((1 - progress) * 100).toFixed(0)}% open`;
}

export function formatEndEffectorRuntimeState(runtime: EndEffectorRuntime) {
  return `Gap ${(getEndEffectorOpening(runtime) * 1000).toFixed(0)} mm`;
}

export function getEndEffectorOpening(runtime: EndEffectorRuntime) {
  const progress = getClosingProgress(runtime.definition, runtime.current);
  return ROBOTIQ_2F85_OPENING + (ROBOTIQ_2F85_CLOSED_OPENING - ROBOTIQ_2F85_OPENING) * progress;
}

function getClosingProgress(definition: RobotEndEffectorDefinition, value: number) {
  const { open, close } = definition.command;
  const span = close - open;
  return Math.abs(span) < 1e-9 ? 0 : clamp((value - open) / span, 0, 1);
}
