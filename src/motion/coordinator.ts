import type { ActionPlayer } from './actionPlayer';
import type { MoveGroup } from './moveGroup';

interface MotionCoordinatorOptions {
  actionPlayer: ActionPlayer;
  onActionPlayingChanged(playing: boolean): void;
}

export function createMotionCoordinator(options: MotionCoordinatorOptions) {
  let moveGroup: MoveGroup | null = null;

  function setMoveGroup(next: MoveGroup | null) {
    moveGroup = next;
  }

  function cancelAndHold() {
    options.actionPlayer.stop();
    options.onActionPlayingChanged(false);
    moveGroup?.stop();
  }

  function startAction(actionName: string) {
    cancelAndHold();
    options.actionPlayer.play(actionName, true);
    options.onActionPlayingChanged(true);
  }

  return { setMoveGroup, cancelAndHold, startAction };
}
