import './styles.css';

import * as THREE from 'three';
import { clearBrowserApis, installBrowserApis } from './app/browserApi';
import { queryAppElements } from './app/dom';
import type { LoadedRobotRuntime } from './app/robotRuntime';
import { buildEndEffectorControls } from './endEffectors/controls';
import type { EndEffectorControlHandles } from './endEffectors/controls';
import {
  applyEndEffectorStep,
  formatEndEffectorRuntimeState,
  setEndEffectorTarget,
} from './endEffectors/state';
import { ActionPlayer } from './motion/actionPlayer';
import { solveCcdIk } from './motion/ccdIk';
import { createMotionCoordinator } from './motion/coordinator';
import { createJointStateStore } from './motion/jointState';
import type { OutputMap, SliderMap } from './motion/jointState';
import type { CartesianPoseTarget, MoveGroup, MoveGroupLite, MoveGroupStatus } from './motion/moveGroup';
import { MoveGroupLite as MoveGroupController } from './motion/moveGroup';
import { setInertialVisibility, updateCenterOfMass } from './physics/inertials';
import {
  cloneJointValues,
  getDefaultPreset,
  getFrameName,
  loadRobotRegistry,
} from './robots';
import type { JointName, JointValues, PoseName, RobotDefinition } from './robots';
import { createRobotMaterials } from './rendering/materials';
import { createRobotOverlays } from './rendering/overlays';
import { createRobotScene } from './rendering/scene';
import { installTargetDrag } from './rendering/targetDrag';
import { renderIcons, updatePlayIcon } from './ui/icons';
import { buildJointControls } from './ui/jointControls';
import {
  markRobotLoadFailed,
  markRobotReady,
  resetRobotReadouts,
  updateMoveGroupStatus as renderMoveGroupStatus,
  updatePhysicsReadoutText,
  updateRobotMetadata,
} from './ui/readouts';
import { populateRobotSelector } from './ui/robotSelector';
import { buildTargetControls, setTargetPositionFromPose } from './ui/targetControls';
import type { TargetControlMaps } from './ui/targetControls';

const PHYSICS_UPDATE_INTERVAL_MS = 100;

const elements = queryAppElements();
const robotScene = createRobotScene(elements.canvas);
const materials = createRobotMaterials();
const overlays = createRobotOverlays(robotScene.scene, materials);
const actionPlayer = new ActionPlayer();
const protectedMaterials = new Set<THREE.Material>([
  materials.visualFallback,
  materials.collision,
  materials.collisionHit,
  materials.target,
  materials.com,
  materials.totalCom,
]);

const jointSliders: SliderMap = {};
const jointOutputs: OutputMap = {};
const jointState = createJointStateStore(jointSliders, jointOutputs);
const targetControlMaps: TargetControlMaps = {
  inputs: {} as Record<'x' | 'y' | 'z', HTMLInputElement>,
  outputs: {} as Record<'x' | 'y' | 'z', HTMLOutputElement>,
};
const motion = createMotionCoordinator({
  actionPlayer,
  onActionPlayingChanged: updatePlayIcon,
});

let robots: RobotDefinition[] = [];
let robotById: Record<string, RobotDefinition> = {};
let activeRobot!: RobotDefinition;
let runtime: LoadedRobotRuntime | null = null;
let moveIt: MoveGroupLite | null = null;
let activeMoveGroup: MoveGroup | null = null;
let endEffectorControls: EndEffectorControlHandles = { slider: null, output: null };
let loadToken = 0;
let speedScale = Number(elements.speedScaleInput.value);
let previousFrameTime = performance.now();
let lastPhysicsUpdate = Number.NEGATIVE_INFINITY;
let physicsDirty = false;
let runtimeModule!: typeof import('./app/robotRuntime');

const toolPosition = new THREE.Vector3();
const toolQuaternion = new THREE.Quaternion();
const emptyCom = new THREE.Vector3();

installTargetDrag({
  canvas: elements.canvas,
  camera: robotScene.camera,
  controls: robotScene.controls,
  targetMesh: overlays.targetMesh,
  targetPosition: overlays.targetPosition,
  targetControls: targetControlMaps,
  onDragStart: motion.cancelAndHold,
  onDrag: () => {
    physicsDirty = true;
  },
});

void bootstrap().catch(error => {
  elements.assetState.textContent = 'Robot config failed';
  elements.readyBadge.textContent = 'Error';
  console.error(error);
});

async function bootstrap() {
  elements.assetState.textContent = 'Loading robot configs';
  const [registry, loadedRuntimeModule] = await Promise.all([
    loadRobotRegistry(`${import.meta.env.BASE_URL}robots/index.json`, import.meta.env.BASE_URL),
    import('./app/robotRuntime'),
  ]);
  runtimeModule = loadedRuntimeModule;
  robots = registry.robots;
  robotById = registry.robotById;
  activeRobot = robots[0];

  populateRobotSelector(elements.robotSelector, robots, activeRobot, robotId => {
    void loadRobot(robotId);
  });
  bindControls();
  renderIcons();
  window.addEventListener('pagehide', robotScene.dispose, { once: true });
  robotScene.resize();
  robotScene.renderer.setAnimationLoop(render);
  await loadRobot(activeRobot.id);
}

async function loadRobot(robotId: string) {
  const nextRobot = robotById[robotId] ?? robots[0];
  const token = ++loadToken;
  motion.cancelAndHold();
  motion.setMoveGroup(null);
  actionPlayer.reset();
  updatePlayIcon(false);
  clearBrowserApis();
  runtime?.dispose();
  runtime = null;

  activeRobot = nextRobot;
  elements.robotSelector.value = activeRobot.id;
  elements.motionState.textContent = 'Loading';
  elements.gripperState.textContent = activeRobot.endEffector ? 'Loading' : 'None';
  jointState.syncRobot(activeRobot, getDefaultPreset(activeRobot));
  overlays.targetPosition.set(activeRobot.initialTarget.x, activeRobot.initialTarget.y, activeRobot.initialTarget.z);
  overlays.targetMesh.position.copy(overlays.targetPosition);

  setupMoveGroup();
  rebuildControls();
  robotScene.resetCamera(activeRobot);
  updateRobotMetadata(elements, activeRobot, 'Loading URDF');
  resetRobotReadouts(elements);
  updateVisibility();

  try {
    const loaded = await runtimeModule.loadRobotRuntime({
      definition: activeRobot,
      registry: robots,
      scene: robotScene.scene,
      materials,
      protectedMaterials,
      collisionVisible: elements.collisionToggle.checked,
      inertialsVisible: elements.comToggle.checked,
    });
    if (token !== loadToken) {
      loaded.dispose();
      return;
    }
    runtime = loaded;
    applyJointState(true);
    applyEndEffector(true);
    rebuildEndEffectorControls();
    installCurrentBrowserApis();
    markRobotReady(
      elements,
      activeRobot,
      runtime.visualCount,
      runtime.collisionMeshes.length,
      runtime.totalMass,
    );
    updateVisibility();
    updateMoveGroupStatus({ groupName: activeRobot.defaultGroup, state: 'idle', message: 'Ready' });
    physicsDirty = true;
    updatePhysicsReadouts(performance.now(), true);
    robotScene.resize();
    requestAnimationFrame(robotScene.resize);
  } catch (error) {
    if (token !== loadToken) return;
    markRobotLoadFailed(elements);
    console.error(error);
  }
}

function setupMoveGroup() {
  const groups = Object.fromEntries(
    Object.entries(activeRobot.groups).map(([name, definition]) => [name, definition.jointNames]),
  );
  moveIt = new MoveGroupController(
    {
      isReady: () => Boolean(runtime),
      getCurrentJointValues: () => jointState.getCurrent(activeRobot),
      setCurrentJointValues: values =>
        setJointState(values, { syncTarget: true, updateControls: true, forceRobot: true }),
      holdCurrentState: () => jointState.setTargets(activeRobot, jointState.getCurrent(activeRobot), true),
      getCurrentPose,
      solveIk: solveIkForPose,
      checkCollisionsForState,
      setPoseTargetVisual,
      onStatusChange: updateMoveGroupStatus,
    },
    {
      jointSpecs: activeRobot.jointSpecs,
      defaultGroupName: activeRobot.defaultGroup,
      groups,
      namedTargets: activeRobot.presets,
    },
  );
  activeMoveGroup = moveIt.group();
  motion.setMoveGroup(activeMoveGroup);
}

function installCurrentBrowserApis() {
  if (!moveIt || !activeMoveGroup) return;
  installBrowserApis({
    moveIt,
    moveGroup: activeMoveGroup,
    getEndEffector: () => runtime?.endEffector ?? null,
    setEndEffectorCommand,
  });
}

function bindControls() {
  document.querySelector<HTMLButtonElement>('#zero-button')?.addEventListener('click', () => setPreset('zero'));
  document.querySelector<HTMLButtonElement>('#home-button')?.addEventListener('click', () => setPreset('ready'));
  document.querySelector<HTMLButtonElement>('#fold-button')?.addEventListener('click', () => setPreset('folded'));
  document.querySelector<HTMLButtonElement>('#camera-button')?.addEventListener('click', () => robotScene.resetCamera(activeRobot));
  document.querySelector<HTMLButtonElement>('#play-button')?.addEventListener('click', toggleDefaultAction);
  document.querySelector<HTMLButtonElement>('#solve-ik-button')?.addEventListener('click', solveIkToTarget);
  document.querySelector<HTMLButtonElement>('#move-ready-button')?.addEventListener('click', () => moveToNamedTarget('ready'));
  document.querySelector<HTMLButtonElement>('#move-reach-button')?.addEventListener('click', () => moveToNamedTarget('reach'));
  document.querySelector<HTMLButtonElement>('#move-target-button')?.addEventListener('click', moveToCartesianTarget);
  document.querySelector<HTMLButtonElement>('#move-stop-button')?.addEventListener('click', motion.cancelAndHold);
  elements.speedScaleInput.addEventListener('input', () => {
    speedScale = Number(elements.speedScaleInput.value);
    elements.speedScaleOutput.textContent = `${speedScale.toFixed(2)}x`;
  });
  elements.collisionToggle.addEventListener('change', updateVisibility);
  elements.comToggle.addEventListener('change', updateVisibility);
  elements.framesToggle.addEventListener('change', updateVisibility);
}

function rebuildControls() {
  buildJointControls(
    elements.jointControls,
    activeRobot,
    jointState.targetJoints,
    jointSliders,
    jointOutputs,
    (jointName, value) => {
      motion.cancelAndHold();
      jointState.setTargets(activeRobot, { [jointName]: value });
    },
  );
  buildTargetControls(elements.targetControls, overlays.targetPosition, overlays.targetMesh, targetControlMaps);
  rebuildEndEffectorControls();
}

function rebuildEndEffectorControls() {
  const definition = activeRobot.endEffector ?? null;
  const value = runtime?.endEffector?.current ?? definition?.command.open ?? 0;
  endEffectorControls = buildEndEffectorControls(
    elements.gripperControls,
    definition,
    value,
    setEndEffectorCommand,
  );
  renderIcons();
  updateEndEffectorReadout();
}

function toggleDefaultAction() {
  if (actionPlayer.state.playing) {
    motion.cancelAndHold();
    elements.motionState.textContent = 'Manual';
    return;
  }
  const actionName = activeRobot.defaultAction;
  if (!actionName || !activeRobot.actions[actionName]) return;
  motion.startAction(actionName);
  elements.motionState.textContent = activeRobot.actions[actionName].label;
}

function setPreset(name: PoseName) {
  const preset = activeRobot.presets[name];
  if (!preset) return;
  motion.cancelAndHold();
  elements.motionState.textContent = 'Manual';
  jointState.setTargets(activeRobot, preset, true);
}

function moveToNamedTarget(name: PoseName) {
  if (!activeMoveGroup || !activeRobot.presets[name]) return;
  motion.cancelAndHold();
  void activeMoveGroup.setNamedTarget(name).go({ avoidCollisions: true, speedScale });
}

function moveToCartesianTarget() {
  if (!activeMoveGroup) return;
  motion.cancelAndHold();
  void activeMoveGroup
    .setPoseTarget({
      position: {
        x: overlays.targetPosition.x,
        y: overlays.targetPosition.y,
        z: overlays.targetPosition.z,
      },
    })
    .go({ avoidCollisions: true, speedScale });
}

function getCurrentPose() {
  const tool = runtimeModule.getRuntimeToolFrame(runtime);
  if (!tool) return null;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  tool.getWorldPosition(position);
  tool.getWorldQuaternion(quaternion);
  return { position, quaternion, rpy: new THREE.Euler().setFromQuaternion(quaternion, 'XYZ') };
}

function setPoseTargetVisual(pose: CartesianPoseTarget) {
  setTargetPositionFromPose(pose.position, overlays.targetPosition, overlays.targetMesh, targetControlMaps);
  physicsDirty = true;
}

function updateMoveGroupStatus(status: MoveGroupStatus) {
  renderMoveGroupStatus(elements, status);
}

function setJointState(
  values: Partial<Record<JointName, number>>,
  options: { syncTarget: boolean; updateControls: boolean; forceRobot: boolean },
) {
  jointState.setCurrent(activeRobot, values, {
    syncTarget: options.syncTarget,
    updateControls: options.updateControls,
  });
  if (options.forceRobot && runtime) {
    runtimeModule.applyRobotJointValues(runtime, jointState.currentJoints);
    physicsDirty = true;
  }
}

function solveIkToTarget() {
  motion.cancelAndHold();
  const result = solveIkForPose(
    { position: { x: overlays.targetPosition.x, y: overlays.targetPosition.y, z: overlays.targetPosition.z } },
    jointState.getCurrent(activeRobot),
  );
  if (!result.success) {
    updateMoveGroupStatus({ groupName: activeRobot.defaultGroup, state: 'failed', message: result.message ?? 'IK failed' });
    return;
  }
  setJointState(result.joints, { syncTarget: true, updateControls: true, forceRobot: true });
}

function solveIkForPose(pose: CartesianPoseTarget, seed: JointValues) {
  if (!runtime || !activeRobot.capabilities.supportsIk) {
    return {
      success: false,
      joints: cloneJointValues(activeRobot, seed),
      error: Number.POSITIVE_INFINITY,
      iterations: 0,
      message: 'IK is not enabled for this robot.',
    };
  }
  return solveCcdIk({
    robot: activeRobot,
    model: runtime.model,
    toolFrameName: runtime.endEffector?.tcpFrame.name ?? getFrameName(activeRobot),
    toolFrameObject: runtimeModule.getRuntimeToolFrame(runtime),
    pose,
    seed,
    getCurrentJointValues: () => jointState.getCurrent(activeRobot),
    setRobotJointValues: values => runtimeModule.applyRobotJointValues(runtime!, values),
  });
}

function checkCollisionsForState(values: JointValues) {
  if (!runtime || !activeRobot.capabilities.supportsCollision) return [];
  const saved = jointState.getCurrent(activeRobot);
  runtimeModule.applyRobotJointValues(runtime, values);
  const collisions = runtimeModule.detectRuntimeCollisions(runtime, materials.collision, materials.collisionHit).slice();
  runtimeModule.applyRobotJointValues(runtime, saved);
  runtimeModule.detectRuntimeCollisions(runtime, materials.collision, materials.collisionHit);
  physicsDirty = true;
  return collisions;
}

function setEndEffectorCommand(value: number) {
  const endEffector = runtime?.endEffector;
  if (!endEffector) return;
  setEndEffectorTarget(endEffector, value);
  if (endEffectorControls.slider) {
    endEffectorControls.slider.value = String(endEffector.target);
  }
  updateEndEffectorReadout();
}

function updateEndEffectorReadout() {
  const endEffector = runtime?.endEffector;
  if (!endEffector) {
    elements.gripperState.textContent = activeRobot?.endEffector ? 'Loading' : 'None';
    return;
  }
  const label = formatEndEffectorRuntimeState(endEffector);
  elements.gripperState.textContent = label;
  if (endEffectorControls.slider) endEffectorControls.slider.value = String(endEffector.current);
  if (endEffectorControls.output) endEffectorControls.output.textContent = label;
}

function applyJointState(force: boolean, delta = 1 / 60) {
  if (!runtime) return false;
  const state = jointState.applyStep(activeRobot, speedScale, delta, force);
  if (force || state.changed) {
    runtimeModule.applyRobotJointValues(runtime, jointState.currentJoints);
    physicsDirty = true;
  }
  if (actionPlayer.state.playing && actionPlayer.state.actionName) {
    setText(elements.motionState, activeRobot.actions[actionPlayer.state.actionName]?.label ?? 'Action');
  } else {
    setText(elements.motionState, state.moving ? 'Moving' : 'Manual');
  }
  return state.moving || state.changed;
}

function applyEndEffector(force: boolean, delta = 1 / 60) {
  const endEffector = runtime?.endEffector;
  if (!endEffector) return false;
  const moving = applyEndEffectorStep(endEffector, speedScale, delta, force);
  if (force || moving) {
    physicsDirty = true;
    updateEndEffectorReadout();
  }
  return moving;
}

function render(time: number) {
  const delta = Math.min(Math.max((time - previousFrameTime) / 1000, 0), 0.05);
  previousFrameTime = time;
  if (activeRobot) {
    const actionTarget = actionPlayer.update(activeRobot, delta);
    if (actionTarget) jointState.setTargets(activeRobot, actionTarget, true);
    applyJointState(false, delta);
    applyEndEffector(false, delta);
  }
  robotScene.controls.update();
  if (physicsDirty && time - lastPhysicsUpdate >= PHYSICS_UPDATE_INTERVAL_MS) {
    updatePhysicsReadouts(time);
  }
  robotScene.renderer.render(robotScene.scene, robotScene.camera);
}

function updatePhysicsReadouts(time: number, force = false) {
  if (!runtime || (!force && !physicsDirty)) return;
  const tool = runtimeModule.getRuntimeToolFrame(runtime);
  if (!tool) {
    elements.poseHud.textContent = `${getFrameName(activeRobot)} frame unavailable`;
    return;
  }
  performance.mark('robot-workbench:physics-update');
  tool.getWorldPosition(toolPosition);
  tool.getWorldQuaternion(toolQuaternion);
  overlays.toolFrame.position.copy(toolPosition);
  overlays.toolFrame.quaternion.copy(toolQuaternion);
  overlays.updateToolLine(toolPosition);

  const totalCom = activeRobot.capabilities.supportsInertials
    ? updateCenterOfMass(runtime.inertialLinks, runtime.totalMass, overlays.totalComMesh)
    : emptyCom.set(0, 0, 0);
  const collisions = activeRobot.capabilities.supportsCollision
    ? runtimeModule.detectRuntimeCollisions(runtime, materials.collision, materials.collisionHit)
    : [];
  updatePhysicsReadoutText({
    elements,
    toolFrameName: runtime.endEffector ? `${runtime.endEffector.definition.shortName} TCP` : getFrameName(activeRobot),
    toolPosition,
    toolQuaternion,
    totalCom,
    collisions,
  });
  physicsDirty = false;
  lastPhysicsUpdate = time;
}

function updateVisibility() {
  if (runtime) {
    runtimeModule.setRuntimeCollisionVisibility(runtime, elements.collisionToggle.checked);
    setInertialVisibility(runtime.inertialLinks, overlays.totalComMesh, elements.comToggle.checked);
  } else {
    overlays.totalComMesh.visible = false;
  }
  overlays.setFrameVisibility(elements.framesToggle.checked);
}

function setText(node: Node, value: string) {
  if (node.textContent !== value) node.textContent = value;
}
