import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RobotDefinition } from '../robots';

interface RobotScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  resize: () => void;
  resetCamera: (robot: RobotDefinition) => void;
  dispose: () => void;
}

export function createRobotScene(canvas: HTMLCanvasElement): RobotScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0xe9edf1, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

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

  setupSceneLightsAndFloor(scene);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function resetCamera(robot: RobotDefinition) {
    camera.position.set(robot.camera.position.x, robot.camera.position.y, robot.camera.position.z);
    controls.target.set(robot.camera.target.x, robot.camera.target.y, robot.camera.target.z);
    controls.update();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener('resize', resize);

  function dispose() {
    resizeObserver.disconnect();
    window.removeEventListener('resize', resize);
    controls.dispose();
    renderer.dispose();
  }

  return { renderer, scene, camera, controls, resize, resetCamera, dispose };
}

function setupSceneLightsAndFloor(scene: THREE.Scene) {
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
