import './styles.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import URDFLoader, { URDFCollider, URDFJoint, URDFLink, URDFRobot } from 'urdf-loader';
import {
  Activity,
  Camera,
  CircleStop,
  Crosshair,
  Home,
  Layers,
  Pause,
  Play,
  Route,
  RotateCcw,
  Send,
  Target,
  createIcons,
} from 'lucide';
import {
  DEG2RAD,
  RAD2DEG,
  ROBOTS,
  ROBOT_BY_ID,
  clamp,
  cloneJointValues,
  formatDeg,
  formatMeters,
  getDefaultPreset,
} from './robots';
import type { JointName, JointValues, PoseName, RobotDefinition } from './robots';
import { CartesianPoseTarget, MoveGroupLite, MoveGroupStatus } from './moveGroupLite';

(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
  computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree =
  disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

type SliderMap = Record<JointName, HTMLInputElement>;
type OutputMap = Record<JointName, HTMLOutputElement>;

interface CollisionMesh {
  name: string;
  linkName: string;
  mesh: THREE.Mesh;
}

interface InertialLink {
  link: URDFLink;
  name: string;
  mass: number;
  localCog: THREE.Vector3;
  marker: THREE.Mesh;
}

interface TorqueSample {
  jointName: JointName;
  torque: number;
  effort: number;
}

interface UrdfVisualLike {
  isURDFVisual?: boolean;
}

declare global {
  interface Window {
    moveIt?: MoveGroupLite;
    robotMoveGroup?: ReturnType<MoveGroupLite['group']>;
    ur5eMoveGroup?: ReturnType<MoveGroupLite['group']>;
  }
}

const canvas = queryRequired<HTMLCanvasElement>('#scene');
const robotSelector = queryRequired<HTMLSelectElement>('#robot-selector');
const brandName = queryRequired<HTMLSpanElement>('#brand-name');
const brandSubtitle = queryRequired<HTMLElement>('#brand-subtitle');
const jointControls = queryRequired<HTMLDivElement>('#joint-controls');
const torqueReadout = queryRequired<HTMLDivElement>('#torque-readout');
const collisionReadout = queryRequired<HTMLDivElement>('#collision-readout');
const assetState = queryRequired<HTMLSpanElement>('#asset-state');
const collisionState = queryRequired<HTMLSpanElement>('#collision-state');
const poseHud = queryRequired<HTMLDivElement>('#pose-hud');
const motionState = queryRequired<HTMLOutputElement>('#motion-state');
const massOutput = queryRequired<HTMLElement>('#mass-output');
const reachOutput = queryRequired<HTMLElement>('#reach-output');
const comOutput = queryRequired<HTMLElement>('#com-output');
const meshOutput = queryRequired<HTMLElement>('#mesh-output');
const readyBadge = queryRequired<HTMLElement>('#robot-ready');
const targetControls = queryRequired<HTMLDivElement>('#target-controls');
const speedScaleInput = queryRequired<HTMLInputElement>('#speed-scale');
const speedScaleOutput = queryRequired<HTMLOutputElement>('#speed-scale-output');
const collisionToggle = queryRequired<HTMLInputElement>('#collision-toggle');
const comToggle = queryRequired<HTMLInputElement>('#com-toggle');
const framesToggle = queryRequired<HTMLInputElement>('#frames-toggle');
const moveGroupState = queryRequired<HTMLOutputElement>('#move-group-state');
const assetDescription = queryRequired<HTMLParagraphElement>('#asset-description');

function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Robot UI missing required element: ${selector}`);
  }
  return element;
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0xe9edf1, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9edf1);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
camera.up.set(0, 0, 1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.45;
controls.maxDistance = 4.5;
controls.screenSpacePanning = false;

const visualMaterialFallback = new THREE.MeshStandardMaterial({
  color: 0xd7dde1,
  metalness: 0.12,
  roughness: 0.52,
});
const collisionMaterial = new THREE.MeshBasicMaterial({
  color: 0xd97706,
  wireframe: true,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
});
const collisionHitMaterial = new THREE.MeshBasicMaterial({
  color: 0xdc2626,
  wireframe: true,
  transparent: true,
  opacity: 0.58,
  depthWrite: false,
});
const targetMaterial = new THREE.MeshStandardMaterial({
  color: 0x0f766e,
  emissive: 0x063d39,
  roughness: 0.4,
  metalness: 0.1,
});
const comMaterial = new THREE.MeshStandardMaterial({
  color: 0xf59e0b,
  emissive: 0x4a2a03,
  roughness: 0.35,
});
const totalComMaterial = new THREE.MeshStandardMaterial({
  color: 0x16a34a,
  emissive: 0x063a18,
  roughness: 0.35,
});

const currentJoints: JointValues = {};
const targetJoints: JointValues = {};
const jointSliders: SliderMap = {};
const jointOutputs: OutputMap = {};
const targetPosition = new THREE.Vector3();
const targetInputs: Record<'x' | 'y' | 'z', HTMLInputElement> = {} as Record<'x' | 'y' | 'z', HTMLInputElement>;
const targetOutputs: Record<'x' | 'y' | 'z', HTMLOutputElement> = {} as Record<'x' | 'y' | 'z', HTMLOutputElement>;

let activeRobot: RobotDefinition = ROBOTS[0];
let robot: URDFRobot | null = null;
let robotAssetsReady = false;
let isPlaying = false;
let elapsedMotion = 0;
let speedScale = Number(speedScaleInput.value);
let totalMass = 0;
let visualCount = 0;
let loadToken = 0;
let lastCollisionPairs: string[] = [];
let moveIt: MoveGroupLite | null = null;
let manipulatorGroup: ReturnType<MoveGroupLite['group']> | null = null;

const collisionMeshes: CollisionMesh[] = [];
const inertialLinks: InertialLink[] = [];
const collisionPairSet = new Set<string>();

const targetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.025, 24, 16), targetMaterial);
const toolFrame = new THREE.AxesHelper(0.12);
const totalComMesh = new THREE.Mesh(new THREE.SphereGeometry(0.025, 24, 16), totalComMaterial);
const toolToTargetLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.62 }),
);

scene.add(targetMesh, toolFrame, totalComMesh, toolToTargetLine);

setupScene();
populateRobotSelector();
bindButtons();
createIcons({
  icons: {
    Activity,
    Camera,
    CircleStop,
    Crosshair,
    Home,
    Layers,
    Play,
    Pause,
    Route,
    RotateCcw,
    Send,
    Target,
  },
});

void loadRobot(activeRobot.id);

window.addEventListener('resize', resizeRenderer);
resizeRenderer();
renderer.setAnimationLoop(render);

function setupScene() {
  const ambient = new THREE.HemisphereLight(0xffffff, 0xb8c0c8, 2.4);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 3.3);
  key.position.set(1.6, -2.4, 2.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 8;
  key.shadow.camera.left = -2;
  key.shadow.camera.right = 2;
  key.shadow.camera.top = 2;
  key.shadow.camera.bottom = -2;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xcad8e8, 1.1);
  fill.position.set(-1.8, 1.4, 1.6);
  scene.add(fill);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.ShadowMaterial({ opacity: 0.18 }));
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(2.6, 26, 0x9aa5ad, 0xc4ccd2);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = 0.001;
  scene.add(grid);

  const axes = new THREE.AxesHelper(0.22);
  axes.position.set(0, 0, 0.002);
  scene.add(axes);
}

function populateRobotSelector() {
  robotSelector.replaceChildren(
    ...ROBOTS.map(robotDefinition => {
      const option = document.createElement('option');
      option.value = robotDefinition.id;
      option.textContent = robotDefinition.shortName;
      return option;
    }),
  );
  robotSelector.value = activeRobot.id;
  robotSelector.addEventListener('change', () => {
    void loadRobot(robotSelector.value);
  });
}

async function loadRobot(robotId: string) {
  const nextRobot = ROBOT_BY_ID[robotId] ?? ROBOTS[0];
  const token = ++loadToken;

  manipulatorGroup?.stop();
  disposeLoadedRobot();

  activeRobot = nextRobot;
  robotSelector.value = activeRobot.id;
  isPlaying = false;
  elapsedMotion = 0;
  motionState.textContent = 'Loading';
  robotAssetsReady = false;
  visualCount = 0;
  totalMass = 0;
  lastCollisionPairs = [];

  const preset = getDefaultPreset(activeRobot);
  syncJointStores(preset);
  targetPosition.set(activeRobot.initialTarget.x, activeRobot.initialTarget.y, activeRobot.initialTarget.z);
  targetMesh.position.copy(targetPosition);
  setupMoveGroup();
  buildJointControls();
  buildTargetControls();
  resetCamera();
  updateRobotMetadata('Loading URDF');
  updateVisibility();

  const manager = new THREE.LoadingManager();
  const loader = createUrdfLoader(manager);

  manager.onLoad = () => {
    if (token !== loadToken || !robot) {
      return;
    }

    robotAssetsReady = true;
    collectCollisionMeshes(robot);
    collectInertialLinks(robot);
    collisionPairSet.clear();
    buildCollisionPairs();
    visualCount = countUrdfVisuals(robot);

    meshOutput.textContent = `${visualCount} visual / ${collisionMeshes.length} collision`;
    massOutput.textContent = `${totalMass.toFixed(3)} kg`;
    assetState.textContent = `${activeRobot.shortName} meshes loaded`;
    readyBadge.textContent = 'Ready';
    readyBadge.classList.add('is-ready');
    collisionState.textContent = 'Collision: clear';
    applyJointState(true);
    updateVisibility();
    updateMoveGroupStatus({ groupName: 'manipulator', state: 'idle', message: 'Ready' });
  };

  loader.load(
    activeRobot.urdfPath,
    loadedRobot => {
      if (token !== loadToken) {
        disposeObjectTree(loadedRobot);
        return;
      }
      robot = loadedRobot;
      robot.name = activeRobot.name;
      scene.add(robot);
      applyJointState(true);
      configureRobotMaterials(robot);
      assetState.textContent = 'URDF loaded';
    },
    undefined,
    error => {
      if (token !== loadToken) {
        return;
      }
      assetState.textContent = 'URDF failed';
      readyBadge.textContent = 'Error';
      readyBadge.classList.remove('is-ready');
      console.error(error);
    },
  );
}

function createUrdfLoader(manager: THREE.LoadingManager) {
  const loader = new URDFLoader(manager);
  loader.packages = Object.fromEntries(ROBOTS.map(robotDefinition => [robotDefinition.packageName, robotDefinition.packagePath]));
  loader.parseCollision = true;
  loader.parseVisual = true;

  const defaultMeshLoader = loader.defaultMeshLoader.bind(loader);
  loader.loadMeshCb = (path, meshManager, done) => {
    if (!/\.obj$/i.test(path)) {
      defaultMeshLoader(path, meshManager, done);
      return;
    }

    new OBJLoader(meshManager).load(
      path,
      object => done(object),
      undefined,
      error => done(new THREE.Group(), error instanceof Error ? error : new Error(String(error))),
    );
  };

  return loader;
}

function disposeLoadedRobot() {
  if (robot) {
    scene.remove(robot);
    disposeObjectTree(robot);
    robot = null;
  }

  for (const item of inertialLinks) {
    scene.remove(item.marker);
    disposeObjectTree(item.marker);
  }

  collisionMeshes.length = 0;
  inertialLinks.length = 0;
  collisionPairSet.clear();
  lastCollisionPairs = [];
  readyBadge.classList.remove('is-ready');
  readyBadge.textContent = 'Pending';
  meshOutput.textContent = '--';
  massOutput.textContent = '-- kg';
  reachOutput.textContent = '-- m';
  comOutput.textContent = '-- m';
  poseHud.textContent = 'Tool pose unavailable';
  collisionState.textContent = 'Collision: pending';
}

function disposeObjectTree(object: THREE.Object3D) {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const geometry = mesh.geometry as THREE.BufferGeometry & { disposeBoundsTree?: () => void };
    geometry.disposeBoundsTree?.();
    geometry.dispose();

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (
        material === visualMaterialFallback ||
        material === collisionMaterial ||
        material === collisionHitMaterial ||
        material === targetMaterial ||
        material === comMaterial ||
        material === totalComMaterial
      ) {
        continue;
      }
      material.dispose();
    }
  });
}

function updateRobotMetadata(assetStatus: string) {
  brandName.textContent = activeRobot.shortName;
  brandSubtitle.textContent = 'Browser robot physics';
  assetDescription.textContent = activeRobot.description;
  assetState.textContent = assetStatus;
}

function setupMoveGroup() {
  const jointNames = activeRobot.jointSpecs.map(spec => spec.name);
  moveIt = new MoveGroupLite(
    {
      isReady: () => robotAssetsReady && Boolean(robot),
      getCurrentJointValues,
      setCurrentJointValues: values => setJointState(values, { syncTarget: true, updateControls: true, forceRobot: true }),
      holdCurrentState: () => setTargetJointState(getCurrentJointValues(), true),
      getCurrentPose,
      solveIk: (pose, seed) => solveIkForPose(pose, seed),
      checkCollisionsForState,
      setPoseTargetVisual,
      onStatusChange: updateMoveGroupStatus,
    },
    {
      jointSpecs: activeRobot.jointSpecs,
      groups: {
        manipulator: jointNames,
        arm: jointNames,
      },
      namedTargets: activeRobot.presets,
    },
  );
  manipulatorGroup = moveIt.group('manipulator');
  window.moveIt = moveIt;
  window.robotMoveGroup = manipulatorGroup;
  window.ur5eMoveGroup = manipulatorGroup;
}

function buildJointControls() {
  jointControls.replaceChildren();
  for (const key of Object.keys(jointSliders)) {
    delete jointSliders[key];
    delete jointOutputs[key];
  }

  for (const spec of activeRobot.jointSpecs) {
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
      targetJoints[spec.name] = clamp(Number(input.value) * DEG2RAD, spec.lower, spec.upper);
      output.textContent = formatDeg(targetJoints[spec.name]);
    });

    const meta = document.createElement('div');
    meta.className = 'joint-meta';
    meta.textContent = `${(spec.lower * RAD2DEG).toFixed(0)} to ${(spec.upper * RAD2DEG).toFixed(0)} deg | ${(
      spec.velocity * RAD2DEG
    ).toFixed(0)} deg/s | ${spec.effort.toFixed(0)} Nm`;

    heading.append(label, output);
    row.append(heading, input, meta);
    jointControls.append(row);
    jointSliders[spec.name] = input;
    jointOutputs[spec.name] = output;
  }
}

function buildTargetControls() {
  targetControls.replaceChildren();
  for (const key of Object.keys(targetInputs) as Array<'x' | 'y' | 'z'>) {
    delete targetInputs[key];
    delete targetOutputs[key];
  }

  const specs = [
    { key: 'x' as const, label: 'X', min: -0.92, max: 0.92, step: 0.005 },
    { key: 'y' as const, label: 'Y', min: -0.92, max: 0.92, step: 0.005 },
    { key: 'z' as const, label: 'Z', min: 0.02, max: 1.05, step: 0.005 },
  ];

  for (const spec of specs) {
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
    targetControls.append(row);
    targetInputs[spec.key] = input;
    targetOutputs[spec.key] = output;
  }
}

function bindButtons() {
  document.querySelector<HTMLButtonElement>('#zero-button')?.addEventListener('click', () => setPreset('zero'));
  document.querySelector<HTMLButtonElement>('#home-button')?.addEventListener('click', () => setPreset('ready'));
  document.querySelector<HTMLButtonElement>('#fold-button')?.addEventListener('click', () => setPreset('folded'));
  document.querySelector<HTMLButtonElement>('#camera-button')?.addEventListener('click', resetCamera);
  document.querySelector<HTMLButtonElement>('#play-button')?.addEventListener('click', () => {
    isPlaying = !isPlaying;
    motionState.textContent = isPlaying ? 'Demo' : 'Manual';
    const icon = document.querySelector<HTMLButtonElement>('#play-button i');
    if (icon) {
      icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
      createIcons({ icons: { Play, Pause } });
    }
  });
  document.querySelector<HTMLButtonElement>('#solve-ik-button')?.addEventListener('click', solveIkToTarget);
  document.querySelector<HTMLButtonElement>('#move-ready-button')?.addEventListener('click', () => moveToNamedTarget('ready'));
  document.querySelector<HTMLButtonElement>('#move-reach-button')?.addEventListener('click', () => moveToNamedTarget('reach'));
  document.querySelector<HTMLButtonElement>('#move-target-button')?.addEventListener('click', () => {
    void manipulatorGroup
      ?.setPoseTarget({
        position: { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z },
      })
      .go({ avoidCollisions: true });
  });
  document.querySelector<HTMLButtonElement>('#move-stop-button')?.addEventListener('click', () => manipulatorGroup?.stop());
  speedScaleInput.addEventListener('input', () => {
    speedScale = Number(speedScaleInput.value);
    speedScaleOutput.textContent = `${speedScale.toFixed(2)}x`;
  });
  collisionToggle.addEventListener('change', updateVisibility);
  comToggle.addEventListener('change', updateVisibility);
  framesToggle.addEventListener('change', updateVisibility);
}

function setPreset(name: PoseName) {
  const preset = activeRobot.presets[name];
  if (!preset) {
    return;
  }

  isPlaying = false;
  manipulatorGroup?.stop();
  motionState.textContent = 'Manual';
  setTargetJointState(preset, true);
}

function moveToNamedTarget(name: PoseName) {
  if (!manipulatorGroup || !activeRobot.presets[name]) {
    return;
  }
  void manipulatorGroup.setNamedTarget(name).go({ avoidCollisions: true });
}

function syncJointStores(values: JointValues) {
  for (const key of Object.keys(currentJoints)) {
    delete currentJoints[key];
    delete targetJoints[key];
  }

  for (const spec of activeRobot.jointSpecs) {
    const value = clamp(values[spec.name] ?? 0, spec.lower, spec.upper);
    currentJoints[spec.name] = value;
    targetJoints[spec.name] = value;
  }
}

function getCurrentJointValues(): JointValues {
  return cloneJointValues(activeRobot, currentJoints);
}

function setTargetJointState(values: Partial<Record<JointName, number>>, updateControls: boolean) {
  for (const spec of activeRobot.jointSpecs) {
    const next = values[spec.name];
    if (next === undefined) {
      continue;
    }
    targetJoints[spec.name] = clamp(next, spec.lower, spec.upper);
    if (updateControls && jointSliders[spec.name] && jointOutputs[spec.name]) {
      jointSliders[spec.name].value = String(targetJoints[spec.name] * RAD2DEG);
      jointOutputs[spec.name].textContent = formatDeg(targetJoints[spec.name]);
    }
  }
}

function setJointState(
  values: Partial<Record<JointName, number>>,
  options: { syncTarget: boolean; updateControls: boolean; forceRobot: boolean },
) {
  for (const spec of activeRobot.jointSpecs) {
    const next = values[spec.name];
    if (next === undefined) {
      continue;
    }
    const clamped = clamp(next, spec.lower, spec.upper);
    currentJoints[spec.name] = clamped;
    if (options.syncTarget) {
      targetJoints[spec.name] = clamped;
    }
    if (robot && options.forceRobot) {
      robot.setJointValue(spec.name, clamped);
    }
    if (options.updateControls && jointSliders[spec.name] && jointOutputs[spec.name]) {
      jointSliders[spec.name].value = String(clamped * RAD2DEG);
      jointOutputs[spec.name].textContent = formatDeg(clamped);
    }
  }
  robot?.updateMatrixWorld(true);
}

function setRobotJointValues(values: Partial<Record<JointName, number>>) {
  if (!robot) {
    return;
  }
  for (const spec of activeRobot.jointSpecs) {
    const next = values[spec.name];
    if (next !== undefined) {
      robot.setJointValue(spec.name, clamp(next, spec.lower, spec.upper));
    }
  }
  robot.updateMatrixWorld(true);
}

function getToolFrameObject() {
  if (!robot) {
    return null;
  }
  return (robot.getFrame(activeRobot.toolFrame) as THREE.Object3D | undefined) ?? null;
}

function getCurrentPose() {
  if (!robot || !robotAssetsReady) {
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

function setPoseTargetVisual(pose: CartesianPoseTarget) {
  const clamped = {
    x: clamp(pose.position.x, Number(targetInputs.x.min), Number(targetInputs.x.max)),
    y: clamp(pose.position.y, Number(targetInputs.y.min), Number(targetInputs.y.max)),
    z: clamp(pose.position.z, Number(targetInputs.z.min), Number(targetInputs.z.max)),
  };
  targetPosition.set(clamped.x, clamped.y, clamped.z);
  targetMesh.position.copy(targetPosition);
  for (const key of ['x', 'y', 'z'] as const) {
    targetInputs[key].value = String(clamped[key]);
    targetOutputs[key].textContent = formatMeters(clamped[key]);
  }
}

function updateMoveGroupStatus(status: MoveGroupStatus) {
  moveGroupState.textContent = `${status.state}: ${status.message}`;
}

function resetCamera() {
  camera.position.set(activeRobot.camera.position.x, activeRobot.camera.position.y, activeRobot.camera.position.z);
  controls.target.set(activeRobot.camera.target.x, activeRobot.camera.target.y, activeRobot.camera.target.z);
  controls.update();
}

function configureRobotMaterials(model: URDFRobot) {
  model.traverse(object => {
    object.castShadow = true;
    object.receiveShadow = true;

    const maybeCollider = object as Partial<URDFCollider>;
    if (maybeCollider.isURDFCollider) {
      object.visible = collisionToggle.checked;
      object.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = collisionMaterial;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
      });
      return;
    }

    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material) && !mesh.material) {
      mesh.material = visualMaterialFallback;
    }
  });
}

function collectCollisionMeshes(model: URDFRobot) {
  collisionMeshes.length = 0;
  let fallbackIndex = 0;
  model.traverse(object => {
    const maybeCollider = object as Partial<URDFCollider>;
    if (!maybeCollider.isURDFCollider) {
      return;
    }

    const collider = object as URDFCollider;
    const link = findParentLink(collider);
    const name = collider.urdfName || collider.name || `collision_${fallbackIndex}`;
    fallbackIndex += 1;

    collider.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
        return;
      }
      mesh.geometry.computeBoundsTree();
      mesh.material = collisionMaterial;
      collisionMeshes.push({
        name,
        linkName: link?.urdfName ?? link?.name ?? name,
        mesh,
      });
    });
  });
}

function collectInertialLinks(model: URDFRobot) {
  inertialLinks.length = 0;
  totalMass = 0;
  for (const [name, link] of Object.entries(model.links)) {
    if (!link.inertial || link.inertial.mass <= 0) {
      continue;
    }
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), comMaterial);
    marker.visible = comToggle.checked;
    scene.add(marker);
    const localCog = new THREE.Vector3(...link.inertial.origin.xyz);
    inertialLinks.push({
      link,
      name,
      mass: link.inertial.mass,
      localCog,
      marker,
    });
    totalMass += link.inertial.mass;
  }
}

function countUrdfVisuals(model: URDFRobot) {
  let count = 0;
  model.traverse(object => {
    if ((object as UrdfVisualLike).isURDFVisual) {
      count += 1;
    }
  });
  return count;
}

function findParentLink(object: THREE.Object3D): URDFLink | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const maybeLink = current as Partial<URDFLink>;
    if (maybeLink.isURDFLink) {
      return current as URDFLink;
    }
    current = current.parent;
  }
  return null;
}

function buildCollisionPairs() {
  collisionPairSet.clear();
  for (let i = 0; i < collisionMeshes.length; i += 1) {
    for (let j = i + 1; j < collisionMeshes.length; j += 1) {
      const a = collisionMeshes[i];
      const b = collisionMeshes[j];
      if (shouldSkipCollisionPair(a.linkName, b.linkName)) {
        continue;
      }
      collisionPairSet.add(`${i}:${j}`);
    }
  }
}

function shouldSkipCollisionPair(a: string, b: string) {
  const linkIndex = new Map(activeRobot.linkChain.map((linkName, index) => [linkName, index]));
  const indexA = linkIndex.get(a);
  const indexB = linkIndex.get(b);
  if (indexA === undefined || indexB === undefined) {
    return false;
  }
  return Math.abs(indexA - indexB) <= 1;
}

function render() {
  const delta = Math.min(clock.getDelta(), 0.05);
  elapsedMotion += delta;
  if (isPlaying) {
    updateDemoTarget(elapsedMotion);
  }
  applyJointState(false, delta);
  controls.update();
  updatePhysicsReadouts();
  renderer.render(scene, camera);
}

const clock = new THREE.Clock();

function updateDemoTarget(time: number) {
  const demo = getDefaultPreset(activeRobot);
  activeRobot.jointSpecs.forEach((spec, index) => {
    const range = spec.upper - spec.lower;
    const amplitude = Math.min(0.55, Math.max(0.08, range * 0.14));
    targetJoints[spec.name] = clamp(
      demo[spec.name] + Math.sin(time * (0.55 + index * 0.09) + index * 0.7) * amplitude,
      spec.lower,
      spec.upper,
    );
    if (jointSliders[spec.name]) {
      jointSliders[spec.name].value = String(targetJoints[spec.name] * RAD2DEG);
    }
  });
}

function applyJointState(force: boolean, delta = 1 / 60) {
  if (!robot) {
    return;
  }
  let moving = false;
  for (const spec of activeRobot.jointSpecs) {
    const current = currentJoints[spec.name];
    const target = clamp(targetJoints[spec.name], spec.lower, spec.upper);
    const diff = target - current;
    if (Math.abs(diff) > 0.0005) {
      moving = true;
    }
    const maxStep = spec.velocity * speedScale * delta;
    currentJoints[spec.name] = force ? target : current + clamp(diff, -maxStep, maxStep);
    robot.setJointValue(spec.name, currentJoints[spec.name]);
    if (jointOutputs[spec.name]) {
      jointOutputs[spec.name].textContent = formatDeg(currentJoints[spec.name]);
    }
  }
  robot.updateMatrixWorld(true);
  motionState.textContent = isPlaying ? 'Demo' : moving ? 'Moving' : 'Manual';
}

function updatePhysicsReadouts() {
  if (!robot || !robotAssetsReady) {
    return;
  }

  const tool = getToolFrameObject();
  if (!tool) {
    poseHud.textContent = `${activeRobot.toolFrame} frame unavailable`;
    return;
  }

  const toolPosition = new THREE.Vector3();
  const toolQuaternion = new THREE.Quaternion();
  tool.getWorldPosition(toolPosition);
  tool.getWorldQuaternion(toolQuaternion);

  toolFrame.position.copy(toolPosition);
  toolFrame.quaternion.copy(toolQuaternion);

  const totalCom = updateCenterOfMass();
  const torques = computeGravityTorques();
  const collisions = detectCollisions();
  updateToolLine(toolPosition);
  updateReadoutText(toolPosition, toolQuaternion, totalCom, torques, collisions);
}

function updateCenterOfMass() {
  const total = new THREE.Vector3();
  const linkCog = new THREE.Vector3();
  for (const sample of inertialLinks) {
    linkCog.copy(sample.localCog);
    sample.link.localToWorld(linkCog);
    sample.marker.position.copy(linkCog);
    total.addScaledVector(linkCog, sample.mass);
  }
  if (totalMass > 0) {
    total.multiplyScalar(1 / totalMass);
  }
  totalComMesh.position.copy(total);
  return total;
}

function computeGravityTorques(): TorqueSample[] {
  if (!robot) {
    return [];
  }
  const gravity = new THREE.Vector3(0, 0, -9.80665);
  const torqueSamples: TorqueSample[] = [];
  const jointPosition = new THREE.Vector3();
  const axisWorld = new THREE.Vector3();
  const jointQuaternion = new THREE.Quaternion();
  const cog = new THREE.Vector3();
  const radius = new THREE.Vector3();
  const force = new THREE.Vector3();
  const moment = new THREE.Vector3();

  for (const spec of activeRobot.jointSpecs) {
    const joint = robot.joints[spec.name] as URDFJoint | undefined;
    if (!joint) {
      continue;
    }
    joint.getWorldPosition(jointPosition);
    joint.getWorldQuaternion(jointQuaternion);
    axisWorld.copy(joint.axis).applyQuaternion(jointQuaternion).normalize();

    let torque = 0;
    const downstream = activeRobot.downstreamLinks[spec.name] ?? [];
    for (const linkSample of inertialLinks) {
      if (!downstream.includes(linkSample.name)) {
        continue;
      }
      cog.copy(linkSample.localCog);
      linkSample.link.localToWorld(cog);
      radius.subVectors(cog, jointPosition);
      force.copy(gravity).multiplyScalar(linkSample.mass);
      moment.crossVectors(radius, force);
      torque += axisWorld.dot(moment);
    }
    torqueSamples.push({ jointName: spec.name, torque, effort: spec.effort });
  }

  return torqueSamples;
}

function detectCollisions() {
  lastCollisionPairs = [];
  for (const item of collisionMeshes) {
    item.mesh.material = collisionMaterial;
  }

  const matrix = new THREE.Matrix4();
  for (const key of collisionPairSet) {
    const [aIndex, bIndex] = key.split(':').map(Number);
    const a = collisionMeshes[aIndex];
    const b = collisionMeshes[bIndex];
    a.mesh.updateWorldMatrix(true, false);
    b.mesh.updateWorldMatrix(true, false);
    matrix.copy(a.mesh.matrixWorld).invert().multiply(b.mesh.matrixWorld);
    const boundsTree = (a.mesh.geometry as THREE.BufferGeometry & {
      boundsTree?: { intersectsGeometry: (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => boolean };
    }).boundsTree;
    if (boundsTree?.intersectsGeometry(b.mesh.geometry, matrix)) {
      lastCollisionPairs.push(`${a.linkName} / ${b.linkName}`);
      a.mesh.material = collisionHitMaterial;
      b.mesh.material = collisionHitMaterial;
    }
  }
  return lastCollisionPairs;
}

function updateToolLine(toolPosition: THREE.Vector3) {
  const geometry = toolToTargetLine.geometry as THREE.BufferGeometry;
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  positions.setXYZ(0, toolPosition.x, toolPosition.y, toolPosition.z);
  positions.setXYZ(1, targetPosition.x, targetPosition.y, targetPosition.z);
  positions.needsUpdate = true;
}

function updateReadoutText(
  toolPosition: THREE.Vector3,
  toolQuaternion: THREE.Quaternion,
  totalCom: THREE.Vector3,
  torques: TorqueSample[],
  collisions: string[],
) {
  const euler = new THREE.Euler().setFromQuaternion(toolQuaternion, 'XYZ');
  poseHud.textContent = `${activeRobot.toolFrame} xyz ${toolPosition.x.toFixed(3)}, ${toolPosition.y.toFixed(
    3,
  )}, ${toolPosition.z.toFixed(3)} m | rpy ${(euler.x * RAD2DEG).toFixed(1)}, ${(euler.y * RAD2DEG).toFixed(
    1,
  )}, ${(euler.z * RAD2DEG).toFixed(1)} deg`;
  reachOutput.textContent = formatMeters(toolPosition.length());
  comOutput.textContent = formatMeters(totalCom.z);
  collisionState.textContent = collisions.length ? `Collision: ${collisions.length}` : 'Collision: clear';
  collisionState.classList.toggle('is-alert', collisions.length > 0);

  torqueReadout.replaceChildren(
    ...torques.map(sample => {
      const spec = activeRobot.jointSpecs.find(item => item.name === sample.jointName);
      const row = document.createElement('div');
      row.className = 'torque-row';
      const label = document.createElement('span');
      label.textContent = spec?.label ?? sample.jointName;
      const bar = document.createElement('span');
      bar.className = 'torque-bar';
      const fill = document.createElement('span');
      const ratio = clamp(Math.abs(sample.torque) / sample.effort, 0, 1);
      fill.style.width = `${(ratio * 100).toFixed(1)}%`;
      fill.className = ratio > 0.85 ? 'is-hot' : ratio > 0.6 ? 'is-warm' : '';
      bar.append(fill);
      const value = document.createElement('output');
      value.textContent = `${sample.torque.toFixed(2)} Nm`;
      row.append(label, bar, value);
      return row;
    }),
  );

  if (collisions.length === 0) {
    const clear = document.createElement('p');
    clear.className = 'quiet';
    clear.textContent = 'No active mesh intersections.';
    collisionReadout.replaceChildren(clear);
  } else {
    collisionReadout.replaceChildren(
      ...collisions.map(pair => {
        const item = document.createElement('p');
        item.className = 'collision-pair';
        item.textContent = pair;
        return item;
      }),
    );
  }
}

function solveIkToTarget() {
  const result = solveIkForPose(
    { position: { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z } },
    getCurrentJointValues(),
  );
  if (!result.success) {
    updateMoveGroupStatus({ groupName: 'manipulator', state: 'failed', message: result.message ?? 'IK failed' });
  }
  setJointState(result.joints, { syncTarget: true, updateControls: true, forceRobot: true });
}

function solveIkForPose(pose: CartesianPoseTarget, seed: JointValues) {
  if (!robot || !robotAssetsReady) {
    return {
      success: false,
      joints: cloneJointValues(activeRobot, seed),
      error: Number.POSITIVE_INFINITY,
      iterations: 0,
      message: 'Robot is not ready yet.',
    };
  }

  const savedCurrent = getCurrentJointValues();
  const solution = cloneJointValues(activeRobot, seed);
  const requestedTarget = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
  setRobotJointValues(solution);

  const result = solveCcdPositionTarget(requestedTarget, solution);
  setRobotJointValues(savedCurrent);
  return result;
}

function solveCcdPositionTarget(requestedTarget: THREE.Vector3, solution: JointValues) {
  if (!robot) {
    return {
      success: false,
      joints: cloneJointValues(activeRobot, solution),
      error: Number.POSITIVE_INFINITY,
      iterations: 0,
      message: 'Robot is not available.',
    };
  }

  const tool = getToolFrameObject();
  if (!tool) {
    return {
      success: false,
      joints: cloneJointValues(activeRobot, solution),
      error: Number.POSITIVE_INFINITY,
      iterations: 0,
      message: `${activeRobot.toolFrame} frame is not available.`,
    };
  }

  const chain = [...activeRobot.jointSpecs].reverse();
  const toolPosition = new THREE.Vector3();
  const jointPosition = new THREE.Vector3();
  const axisWorld = new THREE.Vector3();
  const jointQuaternion = new THREE.Quaternion();
  const toTool = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const projectedTool = new THREE.Vector3();
  const projectedTarget = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let iterations = 0;

  for (let iteration = 0; iteration < 60; iteration += 1) {
    iterations = iteration + 1;
    robot.updateMatrixWorld(true);
    tool.getWorldPosition(toolPosition);
    if (toolPosition.distanceTo(requestedTarget) < 0.006) {
      break;
    }

    for (const spec of chain) {
      const joint = robot.joints[spec.name] as URDFJoint | undefined;
      if (!joint) {
        continue;
      }
      joint.getWorldPosition(jointPosition);
      joint.getWorldQuaternion(jointQuaternion);
      axisWorld.copy(joint.axis).applyQuaternion(jointQuaternion).normalize();
      tool.getWorldPosition(toolPosition);

      toTool.subVectors(toolPosition, jointPosition);
      toTarget.subVectors(requestedTarget, jointPosition);
      projectedTool.copy(toTool).addScaledVector(axisWorld, -toTool.dot(axisWorld));
      projectedTarget.copy(toTarget).addScaledVector(axisWorld, -toTarget.dot(axisWorld));
      if (projectedTool.lengthSq() < 0.000001 || projectedTarget.lengthSq() < 0.000001) {
        continue;
      }

      projectedTool.normalize();
      projectedTarget.normalize();
      cross.crossVectors(projectedTool, projectedTarget);
      const angle = Math.atan2(axisWorld.dot(cross), clamp(projectedTool.dot(projectedTarget), -1, 1));
      const limitedAngle = clamp(angle * 0.72, -0.24, 0.24);
      solution[spec.name] = clamp(solution[spec.name] + limitedAngle, spec.lower, spec.upper);
      robot.setJointValue(spec.name, solution[spec.name]);
    }
  }

  robot.updateMatrixWorld(true);
  tool.getWorldPosition(toolPosition);
  const error = toolPosition.distanceTo(requestedTarget);
  return {
    success: error < 0.012,
    joints: cloneJointValues(activeRobot, solution),
    error,
    iterations,
    message: error < 0.012 ? undefined : `IK ended ${error.toFixed(4)} m from the target.`,
  };
}

function checkCollisionsForState(values: JointValues) {
  if (!robot || !robotAssetsReady) {
    return [];
  }
  const savedCurrent = getCurrentJointValues();
  setRobotJointValues(values);
  const collisions = detectCollisions().slice();
  setRobotJointValues(savedCurrent);
  detectCollisions();
  return collisions;
}

function updateVisibility() {
  for (const item of collisionMeshes) {
    let object: THREE.Object3D | null = item.mesh;
    while (object && !(object as Partial<URDFCollider>).isURDFCollider) {
      object = object.parent;
    }
    if (object) {
      object.visible = collisionToggle.checked;
    }
  }
  for (const item of inertialLinks) {
    item.marker.visible = comToggle.checked;
  }
  totalComMesh.visible = comToggle.checked;
  toolFrame.visible = framesToggle.checked;
  toolToTargetLine.visible = framesToggle.checked;
  targetMesh.visible = framesToggle.checked;
}

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
