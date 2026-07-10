import * as THREE from 'three';
import type { RobotMaterials } from './materials';

interface RobotOverlays {
  targetMesh: THREE.Mesh;
  toolFrame: THREE.AxesHelper;
  totalComMesh: THREE.Mesh;
  toolToTargetLine: THREE.Line;
  targetPosition: THREE.Vector3;
  updateToolLine: (toolPosition: THREE.Vector3) => void;
  setFrameVisibility: (visible: boolean) => void;
}

export function createRobotOverlays(scene: THREE.Scene, materials: RobotMaterials): RobotOverlays {
  const targetPosition = new THREE.Vector3();
  const targetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.025, 24, 16), materials.target);
  const targetHitMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  targetMesh.add(targetHitMesh);
  const toolFrame = new THREE.AxesHelper(0.12);
  const totalComMesh = new THREE.Mesh(new THREE.SphereGeometry(0.025, 24, 16), materials.totalCom);
  const toolToTargetLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.62 }),
  );

  scene.add(targetMesh, toolFrame, totalComMesh, toolToTargetLine);

  function updateToolLine(toolPosition: THREE.Vector3) {
    const geometry = toolToTargetLine.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(0, toolPosition.x, toolPosition.y, toolPosition.z);
    positions.setXYZ(1, targetPosition.x, targetPosition.y, targetPosition.z);
    positions.needsUpdate = true;
  }

  function setFrameVisibility(visible: boolean) {
    toolFrame.visible = visible;
    toolToTargetLine.visible = visible;
    targetMesh.visible = visible;
  }

  return {
    targetMesh,
    toolFrame,
    totalComMesh,
    toolToTargetLine,
    targetPosition,
    updateToolLine,
    setFrameVisibility,
  };
}
