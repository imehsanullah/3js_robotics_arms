import type { EndEffectorRuntime } from '../endEffectors/state';
import { getEndEffectorOpening } from '../endEffectors/state';
import type { MoveGroup, MoveGroupLite } from '../motion/moveGroup';

interface GripperApi {
  open(): void;
  close(): void;
  set(value: number): void;
  get(): number | null;
  getOpening(): number | null;
}

declare global {
  interface Window {
    moveIt?: MoveGroupLite;
    robotMoveGroup?: MoveGroup;
    gripper?: GripperApi;
  }
}

interface BrowserApiOptions {
  moveIt: MoveGroupLite;
  moveGroup: MoveGroup;
  getEndEffector(): EndEffectorRuntime | null;
  setEndEffectorCommand(value: number): void;
}

export function installBrowserApis(options: BrowserApiOptions) {
  window.moveIt = options.moveIt;
  window.robotMoveGroup = options.moveGroup;
  const runtime = options.getEndEffector();
  window.gripper = runtime
    ? {
        open: () => options.setEndEffectorCommand(options.getEndEffector()?.definition.command.open ?? 0),
        close: () => options.setEndEffectorCommand(options.getEndEffector()?.definition.command.close ?? 0),
        set: value => options.setEndEffectorCommand(value),
        get: () => options.getEndEffector()?.current ?? null,
        getOpening: () => {
          const current = options.getEndEffector();
          return current ? getEndEffectorOpening(current) : null;
        },
      }
    : undefined;
}

export function clearBrowserApis() {
  window.moveIt = undefined;
  window.robotMoveGroup = undefined;
  window.gripper = undefined;
}
