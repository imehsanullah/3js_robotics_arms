import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { setTargetPositionFromPose } from '../ui/targetControls';
import type { TargetControlMaps } from '../ui/targetControls';

interface TargetDragOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  controls: OrbitControls;
  targetMesh: THREE.Object3D;
  targetPosition: THREE.Vector3;
  targetControls: TargetControlMaps;
  onDragStart?: () => void;
  onDrag?: () => void;
}

export function installTargetDrag(options: TargetDragOptions) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const planeHit = new THREE.Vector3();
  const dragOffset = new THREE.Vector3();
  const targetWorldPosition = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();

  let activePointerId: number | null = null;
  let isDragging = false;

  function updatePointer(event: PointerEvent) {
    const rect = options.canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, options.camera);
  }

  function targetIsHit(event: PointerEvent) {
    if (!options.targetMesh.visible) {
      return false;
    }
    updatePointer(event);
    return raycaster.intersectObject(options.targetMesh, true).length > 0;
  }

  function setTargetFromWorldPosition(worldPosition: THREE.Vector3) {
    const parent = options.targetMesh.parent;
    const localPosition = parent ? parent.worldToLocal(worldPosition.clone()) : worldPosition;
    if (!options.targetControls.inputs.x || !options.targetControls.inputs.y || !options.targetControls.inputs.z) {
      options.targetPosition.copy(localPosition);
      options.targetMesh.position.copy(options.targetPosition);
      return;
    }

    setTargetPositionFromPose(localPosition, options.targetPosition, options.targetMesh, options.targetControls);
  }

  function updateHoverCursor(event: PointerEvent) {
    if (isDragging) {
      return;
    }
    options.canvas.style.cursor = targetIsHit(event) ? 'grab' : '';
  }

  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || !targetIsHit(event)) {
      return;
    }

    event.preventDefault();
    activePointerId = event.pointerId;
    isDragging = true;
    options.canvas.setPointerCapture(activePointerId);
    options.canvas.style.cursor = 'grabbing';
    options.controls.enabled = false;
    options.onDragStart?.();

    options.targetMesh.getWorldPosition(targetWorldPosition);
    options.camera.getWorldDirection(cameraDirection);
    dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, targetWorldPosition);
    if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      dragOffset.copy(targetWorldPosition).sub(planeHit);
    } else {
      dragOffset.set(0, 0, 0);
    }
  }

  function drag(event: PointerEvent) {
    if (!isDragging || event.pointerId !== activePointerId) {
      updateHoverCursor(event);
      return;
    }

    event.preventDefault();
    updatePointer(event);
    if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      setTargetFromWorldPosition(planeHit.add(dragOffset));
      options.onDrag?.();
    }
  }

  function stopDrag(event: PointerEvent) {
    if (!isDragging || event.pointerId !== activePointerId) {
      return;
    }

    if (options.canvas.hasPointerCapture(activePointerId)) {
      options.canvas.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    isDragging = false;
    options.controls.enabled = true;
    updateHoverCursor(event);
  }

  options.canvas.addEventListener('pointerdown', startDrag, { capture: true });
  options.canvas.addEventListener('pointermove', drag, { capture: true });
  options.canvas.addEventListener('pointerup', stopDrag, { capture: true });
  options.canvas.addEventListener('pointercancel', stopDrag, { capture: true });
}
