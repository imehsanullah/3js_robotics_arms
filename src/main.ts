import './styles.css';

import * as THREE from 'three';
import type { URDFRobot } from 'urdf-loader';
import { queryAppElements } from './app/dom';
import { CartesianPoseTarget, MoveGroupLite, MoveGroupStatus } from './moveGroupLite';
import { buildEndEffectorControls } from './endEffectors/controls';
import type { EndEffectorControlHandles } from './endEffectors/controls';
import {
  collectParallelGripCollisionMeshes,
  createParallelGripContact,
  setParallelGripCollisionVisibility,
} from './endEffectors/contact';
import {
  applyEndEffectorStep,
  createEndEffectorRuntime,
  formatEndEffectorRuntimeState,
  getEndEffectorOpening,
  setEndEffectorContactPreview,
  setEndEffectorMotionMode,
  setEndEffectorTarget,
} from './endEffectors/state';
import type { EndEffectorRuntime } from './endEffectors/state';
import { ActionPlayer } from './motion/actionPlayer';
import { solveCcdIk } from './motion/ccdIk';
import { createJointStateStore } from './motion/jointState';
import type { OutputMap, SliderMap } from './motion/jointState';
import {
  cloneJointValues,
  getDefaultGroup,
  getDefaultPreset,
  getFrameName,
  loadRobotRegistry,
} from './robots';
import type { EndEffectorGripMotionMode, JointName, JointValues, PoseName, RobotDefinition } from './robots';
import { collectCollisionMeshes, buildCollisionPairs, detectCollisions, setCollisionVisibility } from './physics/collisions';
import { computeGravityTorques } from './physics/gravityTorques';
import { collectInertialLinks, setInertialVisibility, updateCenterOfMass } from './physics/inertials';
import type { CollisionMesh, InertialLink } from './physics/types';
import { installBvhExtensions } from './rendering/bvh';
import { disposeObjectTree } from './rendering/dispose';
import { createRobotMaterials } from './rendering/materials';
import { createRobotOverlays } from './rendering/overlays';
import { configureRobotMaterials, countUrdfVisuals, getRobotFrame, loadUrdfWithAssets } from './rendering/robotLoader';
import { createRobotScene } from './rendering/scene';
import { KinematicBackend } from './simulation/kinematicBackend';
import { updatePlayIcon, renderIcons } from './ui/icons';
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

declare global {
  interface Window {
    moveIt?: MoveGroupLite;
    robotMoveGroup?: ReturnType<MoveGroupLite['group']>;
    ur5eMoveGroup?: ReturnType<MoveGroupLite['group']>;
    gripper?: {
      open(): void;
      close(): void;
      set(value: number): void;
      get(): number | null;
      getOpening(): number | null;
      getMotionMode(): EndEffectorGripMotionMode | null;
      setMotionMode(mode: EndEffectorGripMotionMode): void;
      setContactEnabled(enabled: boolean, showObject?: boolean): void;
    };
  }
}

installBvhExtensions();

const elements = queryAppElements();
const robotScene = createRobotScene(elements.canvas);
const materials = createRobotMaterials();
const overlays = createRobotOverlays(robotScene.scene, materials);
const backend = new KinematicBackend();
const actionPlayer = new ActionPlayer();

const protectedMaterials = new Set<THREE.Material>([
  materials.visualFallback,
  materials.collision,
  materials.collisionHit,
  materials.target,
  materials.com,
  materials.totalCom,
  materials.graspObject,
]);

const jointSliders: SliderMap = {};
const jointOutputs: OutputMap = {};
const jointState = createJointStateStore(jointSliders, jointOutputs);
const targetControlMaps: TargetControlMaps = {
  inputs: {} as Record<'x' | 'y' | 'z', HTMLInputElement>,
  outputs: {} as Record<'x' | 'y' | 'z', HTMLOutputElement>,
};

let robots: RobotDefinition[] = [];
let robotById: Record<string, RobotDefinition> = {};
let activeRobot: RobotDefinition;
let robotModel: URDFRobot | null = null;
let robotAssetsReady = false;
let loadToken = 0;
let speedScale = Number(elements.speedScaleInput.value);
let totalMass = 0;
let visualCount = 0;
let collisionMeshes: CollisionMesh[] = [];
let endEffectorCollisionMeshes: CollisionMesh[] = [];
let parallelEndEffectorCollisionMeshes: CollisionMesh[] = [];
let collisionPairSet = new Set<string>();
let inertialLinks: InertialLink[] = [];
let moveIt: MoveGroupLite | null = null;
let activeMoveGroup: ReturnType<MoveGroupLite['group']> | null = null;
let activeEndEffectorRuntime: EndEffectorRuntime | null = null;
let endEffectorControlHandles: EndEffectorControlHandles = { slider: null, output: null };

void bootstrap().catch(error => {
  elements.assetState.textContent = 'Robot config failed';
  elements.readyBadge.textContent = 'Error';
  console.error(error);
});

async function bootstrap() {
  elements.assetState.textContent = 'Loading robot configs';
  const registry = await loadRobotRegistry();
  robots = registry.robots;
  robotById = registry.robotById;
  activeRobot = robots[0];

  populateRobotSelector(elements.robotSelector, robots, activeRobot, robotId => {
    void loadRobot(robotId);
  });
  bindControls();
  renderIcons();

  void loadRobot(activeRobot.id);

  window.addEventListener('resize', robotScene.resize);
  robotScene.resize();
  robotScene.renderer.setAnimationLoop(render);
}

async function loadRobot(robotId: string) {
  const nextRobot = robotById[robotId] ?? robots[0];
  const token = ++loadToken;

  activeMoveGroup?.stop();
  actionPlayer.reset();
  updatePlayIcon(false);
  disposeLoadedRobot();

  activeRobot = nextRobot;
  elements.robotSelector.value = activeRobot.id;
  elements.motionState.textContent = 'Loading';
  robotAssetsReady = false;
  visualCount = 0;
  totalMass = 0;
  collisionMeshes = [];
  endEffectorCollisionMeshes = [];
  parallelEndEffectorCollisionMeshes = [];
  inertialLinks = [];
  collisionPairSet = new Set<string>();

  backend.loadRobot(activeRobot);
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
    const loadedRobot = await loadUrdfWithAssets(activeRobot.urdfPath, robots);
    if (token !== loadToken) {
      disposeObjectTree(loadedRobot, protectedMaterials);
      return;
    }

    robotModel = loadedRobot;
    robotModel.name = activeRobot.name;
    robotScene.scene.add(robotModel);
    backend.attachModel(robotModel);
    applyJointState(true);
    configureRobotMaterials(robotModel, materials, elements.collisionToggle.checked);
    elements.assetState.textContent = 'Arm loaded';

    await loadActiveEndEffector(token);
    if (token !== loadToken || !robotModel) {
      return;
    }

    configureRobotMaterials(robotModel, materials, elements.collisionToggle.checked);
    robotAssetsReady = true;
    const allCollisionMeshes = activeRobot.capabilities.supportsCollision
      ? collectCollisionMeshes(robotModel, materials.collision)
      : [];
    const endEffectorLinkNames = getEndEffectorLinkNames();
    collisionMeshes = allCollisionMeshes.filter(item => !endEffectorLinkNames.has(item.linkName));
    endEffectorCollisionMeshes = allCollisionMeshes.filter(item => endEffectorLinkNames.has(item.linkName));
    parallelEndEffectorCollisionMeshes = collectParallelGripCollisionMeshes(
      activeEndEffectorRuntime?.parallelVisual ?? null,
      materials.collision,
    );
    inertialLinks = activeRobot.capabilities.supportsInertials
      ? collectInertialLinks(robotModel, robotScene.scene, materials.com, elements.comToggle.checked).inertialLinks
      : [];
    totalMass = inertialLinks.reduce((sum, item) => sum + item.mass, 0);
    collisionPairSet = buildCollisionPairs(activeRobot, collisionMeshes);
    visualCount = countUrdfVisuals(robotModel);

    markRobotReady(
      elements,
      activeRobot,
      visualCount,
      collisionMeshes.length + endEffectorCollisionMeshes.length + parallelEndEffectorCollisionMeshes.length,
      totalMass,
    );
    applyJointState(true);
    applyEndEffectorRuntime(true);
    updateVisibility();
    updateMoveGroupStatus({ groupName: activeRobot.defaultGroup, state: 'idle', message: 'Ready' });
  } catch (error) {
    if (token !== loadToken) {
      return;
    }
    markRobotLoadFailed(elements);
    console.error(error);
  }
}

function disposeLoadedRobot() {
  activeEndEffectorRuntime = null;
  endEffectorCollisionMeshes = [];
  parallelEndEffectorCollisionMeshes = [];
  window.gripper = undefined;

  if (robotModel) {
    robotScene.scene.remove(robotModel);
    disposeObjectTree(robotModel, protectedMaterials);
    robotModel = null;
  }

  for (const item of inertialLinks) {
    robotScene.scene.remove(item.marker);
    disposeObjectTree(item.marker, protectedMaterials);
  }

  backend.attachModel(null);
  collisionMeshes = [];
  endEffectorCollisionMeshes = [];
  parallelEndEffectorCollisionMeshes = [];
  inertialLinks = [];
  collisionPairSet.clear();
}

function rebuildControls() {
  buildJointControls(
    elements.jointControls,
    activeRobot,
    jointState.targetJoints,
    jointSliders,
    jointOutputs,
    (jointName, value) => {
      actionPlayer.stop();
      updatePlayIcon(false);
      jointState.setTargets(activeRobot, { [jointName]: value }, false);
    },
  );
  buildTargetControls(elements.targetControls, overlays.targetPosition, overlays.targetMesh, targetControlMaps);
  updateEndEffectorControls();
}

function setupMoveGroup() {
  const groups = Object.fromEntries(
    Object.values(activeRobot.groups).map(groupDefinition => [groupDefinition.name, groupDefinition.jointNames]),
  );
  const defaultGroup = getDefaultGroup(activeRobot);

  moveIt = new MoveGroupLite(
    {
      isReady: () => robotAssetsReady && Boolean(robotModel),
      getCurrentJointValues: () => jointState.getCurrent(activeRobot),
      setCurrentJointValues: values =>
        setJointState(values, { syncTarget: true, updateControls: true, forceRobot: true }),
      holdCurrentState: () => jointState.setTargets(activeRobot, jointState.getCurrent(activeRobot), true),
      getCurrentPose,
      solveIk: (pose, seed) => solveIkForPose(pose, seed),
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

  activeMoveGroup = moveIt.group(defaultGroup.name);
  window.moveIt = moveIt;
  window.robotMoveGroup = activeMoveGroup;
  window.ur5eMoveGroup = activeRobot.groups.manipulator ? moveIt.group('manipulator') : activeMoveGroup;
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
  document.querySelector<HTMLButtonElement>('#move-target-button')?.addEventListener('click', () => {
    void activeMoveGroup
      ?.setPoseTarget({
        position: { x: overlays.targetPosition.x, y: overlays.targetPosition.y, z: overlays.targetPosition.z },
      })
      .go({ avoidCollisions: true });
  });
  document.querySelector<HTMLButtonElement>('#move-stop-button')?.addEventListener('click', () => {
    actionPlayer.stop();
    updatePlayIcon(false);
    activeMoveGroup?.stop();
  });
  elements.speedScaleInput.addEventListener('input', () => {
    speedScale = Number(elements.speedScaleInput.value);
    elements.speedScaleOutput.textContent = `${speedScale.toFixed(2)}x`;
  });
  elements.collisionToggle.addEventListener('change', updateVisibility);
  elements.comToggle.addEventListener('change', updateVisibility);
  elements.framesToggle.addEventListener('change', updateVisibility);
}

function toggleDefaultAction() {
  if (actionPlayer.state.playing) {
    actionPlayer.stop();
    updatePlayIcon(false);
    elements.motionState.textContent = 'Manual';
    return;
  }

  const actionName = activeRobot.defaultAction;
  if (!actionName || !activeRobot.actions[actionName]) {
    return;
  }
  activeMoveGroup?.stop();
  actionPlayer.play(actionName, true);
  updatePlayIcon(true);
  elements.motionState.textContent = activeRobot.actions[actionName].label;
}

function setPreset(name: PoseName) {
  const preset = activeRobot.presets[name];
  if (!preset) {
    return;
  }

  actionPlayer.stop();
  updatePlayIcon(false);
  activeMoveGroup?.stop();
  elements.motionState.textContent = 'Manual';
  jointState.setTargets(activeRobot, preset, true);
}

function moveToNamedTarget(name: PoseName) {
  if (!activeMoveGroup || !activeRobot.presets[name]) {
    return;
  }
  actionPlayer.stop();
  updatePlayIcon(false);
  void activeMoveGroup.setNamedTarget(name).go({ avoidCollisions: true });
}

function getCurrentPose() {
  if (!robotModel || !robotAssetsReady) {
    return null;
  }

  const tool = getToolFrameObject();
  if (!tool) {
    return null;
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  tool.getWorldPosition(position);
  tool.getWorldQuaternion(quaternion);
  return {
    position,
    quaternion,
    rpy: new THREE.Euler().setFromQuaternion(quaternion, 'XYZ'),
  };
}

function getToolFrameObject() {
  return activeEndEffectorRuntime?.tcpFrame ?? getRobotFrame(robotModel, getFrameName(activeRobot));
}

function setPoseTargetVisual(pose: CartesianPoseTarget) {
  setTargetPositionFromPose(pose.position, overlays.targetPosition, overlays.targetMesh, targetControlMaps);
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
  if (options.forceRobot) {
    setRobotJointValues(jointState.currentJoints);
  }
}

function setRobotJointValues(values: Partial<Record<JointName, number>>) {
  backend.setJointValues(values);
}

function solveIkToTarget() {
  const result = solveIkForPose(
    { position: { x: overlays.targetPosition.x, y: overlays.targetPosition.y, z: overlays.targetPosition.z } },
    jointState.getCurrent(activeRobot),
  );
  if (!result.success) {
    updateMoveGroupStatus({ groupName: activeRobot.defaultGroup, state: 'failed', message: result.message ?? 'IK failed' });
  }
  setJointState(result.joints, { syncTarget: true, updateControls: true, forceRobot: true });
}

function solveIkForPose(pose: CartesianPoseTarget, seed: JointValues) {
  if (!activeRobot.capabilities.supportsIk || !robotAssetsReady) {
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
    model: robotModel,
    toolFrameName: activeEndEffectorRuntime?.tcpFrame.name ?? getFrameName(activeRobot),
    toolFrameObject: getToolFrameObject(),
    pose,
    seed,
    getCurrentJointValues: () => jointState.getCurrent(activeRobot),
    setRobotJointValues: values => setRobotJointValues(values),
  });
}

function checkCollisionsForState(values: JointValues) {
  if (!robotModel || !robotAssetsReady || !activeRobot.capabilities.supportsCollision) {
    return [];
  }
  const savedCurrent = jointState.getCurrent(activeRobot);
  setRobotJointValues(values);
  const collisions = detectActiveCollisions().slice();
  setRobotJointValues(savedCurrent);
  detectActiveCollisions();
  return collisions;
}

function render() {
  const delta = Math.min(clock.getDelta(), 0.05);

  const actionTarget = actionPlayer.update(activeRobot, delta);
  if (actionTarget) {
    jointState.setTargets(activeRobot, actionTarget, true);
  }

  applyJointState(false, delta);
  applyEndEffectorRuntime(false, delta);
  robotScene.controls.update();
  updatePhysicsReadouts();
  robotScene.renderer.render(robotScene.scene, robotScene.camera);
}

const clock = new THREE.Clock();

function applyJointState(force: boolean, delta = 1 / 60) {
  if (!robotModel) {
    return;
  }

  const moving = jointState.applyStep(activeRobot, speedScale, delta, force);
  setRobotJointValues(jointState.currentJoints);
  backend.step(delta);

  if (actionPlayer.state.playing && actionPlayer.state.actionName) {
    elements.motionState.textContent = activeRobot.actions[actionPlayer.state.actionName]?.label ?? 'Action';
  } else {
    elements.motionState.textContent = moving ? 'Moving' : 'Manual';
  }
}

function updatePhysicsReadouts() {
  if (!robotModel || !robotAssetsReady) {
    return;
  }

  const tool = getToolFrameObject();
  if (!tool) {
    elements.poseHud.textContent = `${getFrameName(activeRobot)} frame unavailable`;
    return;
  }

  const toolPosition = new THREE.Vector3();
  const toolQuaternion = new THREE.Quaternion();
  tool.getWorldPosition(toolPosition);
  tool.getWorldQuaternion(toolQuaternion);

  overlays.toolFrame.position.copy(toolPosition);
  overlays.toolFrame.quaternion.copy(toolQuaternion);

  const totalCom = activeRobot.capabilities.supportsInertials
    ? updateCenterOfMass(inertialLinks, totalMass, overlays.totalComMesh)
    : new THREE.Vector3();
  const torques = computeGravityTorques(activeRobot, robotModel, inertialLinks);
  const collisions = detectActiveCollisions();
  overlays.updateToolLine(toolPosition);
  updatePhysicsReadoutText({
    elements,
    robot: activeRobot,
    toolFrameName: activeEndEffectorRuntime ? `${activeEndEffectorRuntime.definition.shortName} TCP` : getFrameName(activeRobot),
    toolPosition,
    toolQuaternion,
    totalCom,
    torques,
    collisions,
  });
}

function detectActiveCollisions() {
  if (!activeRobot.capabilities.supportsCollision) {
    return [];
  }
  const endEffectorMeshes = getActiveEndEffectorCollisionMeshes();
  const activeCollisionMeshes = [...collisionMeshes, ...endEffectorMeshes];
  const activeCollisionPairSet = buildActiveCollisionPairSet(activeCollisionMeshes.length);
  return detectCollisions(activeCollisionMeshes, activeCollisionPairSet, materials.collision, materials.collisionHit);
}

function updateVisibility() {
  setCollisionVisibility(collisionMeshes, elements.collisionToggle.checked);
  setCollisionVisibility(endEffectorCollisionMeshes, elements.collisionToggle.checked);
  setCollisionVisibility(parallelEndEffectorCollisionMeshes, shouldShowParallelEndEffectorCollisionOverlay());
  setParallelGripCollisionVisibility(
    activeEndEffectorRuntime?.parallelVisual ?? null,
    shouldShowParallelEndEffectorCollisionOverlay(),
  );
  setInertialVisibility(inertialLinks, overlays.totalComMesh, elements.comToggle.checked);
  overlays.setFrameVisibility(elements.framesToggle.checked);
}

function shouldShowParallelEndEffectorCollisionOverlay() {
  if (!elements.collisionToggle.checked) {
    return false;
  }

  return activeEndEffectorRuntime?.motionMode === 'parallel-pinch' && Boolean(activeEndEffectorRuntime.parallelVisual);
}

function getActiveEndEffectorCollisionMeshes() {
  const runtime = activeEndEffectorRuntime;
  if (!runtime) {
    return [];
  }

  const rootLinkName = runtime.definition.rootLink;
  const activeEndEffectorMeshes = endEffectorCollisionMeshes.filter(item => (
    item.linkName !== rootLinkName &&
    item.linkName !== 'world'
  ));

  if (runtime.motionMode !== 'parallel-pinch' || !runtime.parallelVisual) {
    return activeEndEffectorMeshes;
  }

  const hiddenSourceLinkNames = runtime.parallelVisual.sourceLinkNames;
  return [
    ...activeEndEffectorMeshes.filter(item => !hiddenSourceLinkNames.has(item.linkName)),
    ...parallelEndEffectorCollisionMeshes,
  ];
}

function buildActiveCollisionPairSet(activeCollisionMeshCount: number) {
  const activeCollisionPairSet = new Set(collisionPairSet);
  for (let armIndex = 0; armIndex < collisionMeshes.length; armIndex += 1) {
    for (let endEffectorIndex = collisionMeshes.length; endEffectorIndex < activeCollisionMeshCount; endEffectorIndex += 1) {
      activeCollisionPairSet.add(`${armIndex}:${endEffectorIndex}`);
    }
  }
  return activeCollisionPairSet;
}

async function loadActiveEndEffector(token: number) {
  const definition = activeRobot.endEffectors[0] ?? null;
  activeEndEffectorRuntime = null;
  endEffectorCollisionMeshes = [];
  parallelEndEffectorCollisionMeshes = [];
  window.gripper = undefined;
  updateEndEffectorControls();

  if (!definition) {
    elements.gripperState.textContent = 'None';
    return;
  }

  elements.gripperState.textContent = 'Loading';
  const gripperModel = await loadUrdfWithAssets(definition.urdfPath, robots, {
    [definition.packageName]: definition.packagePath,
  });
  if (token !== loadToken || !robotModel) {
    disposeObjectTree(gripperModel, protectedMaterials);
    return;
  }

  const mountFrameName = getFrameName(activeRobot, definition.mountFrame);
  const mountFrame = getRobotFrame(robotModel, mountFrameName);
  if (!mountFrame) {
    disposeObjectTree(gripperModel, protectedMaterials);
    elements.gripperState.textContent = 'Mount missing';
    updateEndEffectorControls();
    return;
  }

  gripperModel.name = definition.name;
  gripperModel.position.set(definition.origin.position.x, definition.origin.position.y, definition.origin.position.z);
  gripperModel.rotation.set(definition.origin.rpy.x, definition.origin.rpy.y, definition.origin.rpy.z, 'XYZ');
  mountFrame.add(gripperModel);

  const contact = createParallelGripContact(definition, materials.graspObject);
  if (contact) {
    gripperModel.add(contact.object);
  }

  activeEndEffectorRuntime = createEndEffectorRuntime(definition, gripperModel, contact);
  configureRobotMaterials(gripperModel, materials, elements.collisionToggle.checked);
  setEndEffectorTarget(activeEndEffectorRuntime, definition.command.open);
  applyEndEffectorRuntime(true);
  installEndEffectorApi();
  updateEndEffectorControls();
}

function updateEndEffectorControls() {
  const definition = activeEndEffectorRuntime?.definition ?? activeRobot?.endEffectors[0] ?? null;
  const value = activeEndEffectorRuntime?.target ?? definition?.command.open ?? 0;
  endEffectorControlHandles = buildEndEffectorControls(
    elements.gripperControls,
    definition,
    value,
    value => setEndEffectorCommand(value),
  );
  renderIcons();
  updateEndEffectorReadout();
}

function setEndEffectorCommand(value: number) {
  if (!activeEndEffectorRuntime) {
    return;
  }
  setEndEffectorTarget(activeEndEffectorRuntime, value);
  updateEndEffectorReadout();
}

function applyEndEffectorRuntime(force: boolean, delta = 1 / 60) {
  if (!activeEndEffectorRuntime) {
    return false;
  }
  const moving = applyEndEffectorStep(activeEndEffectorRuntime, speedScale, delta, force);
  if (force || moving) {
    updateEndEffectorReadout();
  }
  return moving;
}

function updateEndEffectorReadout() {
  if (!activeEndEffectorRuntime) {
    if (!activeRobot?.endEffectors[0]) {
      elements.gripperState.textContent = 'None';
    }
    return;
  }

  const { current } = activeEndEffectorRuntime;
  const label = formatEndEffectorRuntimeState(activeEndEffectorRuntime);
  elements.gripperState.textContent = label;
  if (endEffectorControlHandles.slider) {
    endEffectorControlHandles.slider.value = String(current);
  }
  if (endEffectorControlHandles.output) {
    endEffectorControlHandles.output.textContent = label;
  }
}

function installEndEffectorApi() {
  if (!activeEndEffectorRuntime) {
    window.gripper = undefined;
    return;
  }

  window.gripper = {
    open: () => setEndEffectorCommand(activeEndEffectorRuntime?.definition.command.open ?? 0),
    close: () => setEndEffectorCommand(activeEndEffectorRuntime?.definition.command.close ?? 0),
    set: value => setEndEffectorCommand(value),
    get: () => activeEndEffectorRuntime?.current ?? null,
    getOpening: () => (activeEndEffectorRuntime ? getEndEffectorOpening(activeEndEffectorRuntime) : null),
    getMotionMode: () => activeEndEffectorRuntime?.motionMode ?? null,
    setMotionMode: mode => {
      if (!activeEndEffectorRuntime) {
        return;
      }
      setEndEffectorMotionMode(activeEndEffectorRuntime, mode);
      updateVisibility();
      updateEndEffectorReadout();
    },
    setContactEnabled: (enabled, showObject = enabled) => {
      if (activeEndEffectorRuntime) {
        setEndEffectorContactPreview(activeEndEffectorRuntime, enabled, showObject);
        updateEndEffectorReadout();
      }
    },
  };
}

function getEndEffectorLinkNames() {
  const linkNames = new Set<string>();
  if (!activeEndEffectorRuntime) {
    return linkNames;
  }

  for (const linkName of Object.keys(activeEndEffectorRuntime.model.links)) {
    linkNames.add(linkName);
  }
  return linkNames;
}
