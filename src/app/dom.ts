export function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Robot UI missing required element: ${selector}`);
  }
  return element;
}

export interface AppElements {
  canvas: HTMLCanvasElement;
  robotSelector: HTMLSelectElement;
  brandName: HTMLSpanElement;
  brandSubtitle: HTMLElement;
  jointControls: HTMLDivElement;
  torqueReadout: HTMLDivElement;
  collisionReadout: HTMLDivElement;
  assetState: HTMLSpanElement;
  collisionState: HTMLSpanElement;
  poseHud: HTMLDivElement;
  motionState: HTMLOutputElement;
  massOutput: HTMLElement;
  reachOutput: HTMLElement;
  comOutput: HTMLElement;
  meshOutput: HTMLElement;
  readyBadge: HTMLElement;
  targetControls: HTMLDivElement;
  speedScaleInput: HTMLInputElement;
  speedScaleOutput: HTMLOutputElement;
  collisionToggle: HTMLInputElement;
  comToggle: HTMLInputElement;
  framesToggle: HTMLInputElement;
  moveGroupState: HTMLOutputElement;
  assetDescription: HTMLParagraphElement;
}

export function queryAppElements(): AppElements {
  return {
    canvas: queryRequired<HTMLCanvasElement>('#scene'),
    robotSelector: queryRequired<HTMLSelectElement>('#robot-selector'),
    brandName: queryRequired<HTMLSpanElement>('#brand-name'),
    brandSubtitle: queryRequired<HTMLElement>('#brand-subtitle'),
    jointControls: queryRequired<HTMLDivElement>('#joint-controls'),
    torqueReadout: queryRequired<HTMLDivElement>('#torque-readout'),
    collisionReadout: queryRequired<HTMLDivElement>('#collision-readout'),
    assetState: queryRequired<HTMLSpanElement>('#asset-state'),
    collisionState: queryRequired<HTMLSpanElement>('#collision-state'),
    poseHud: queryRequired<HTMLDivElement>('#pose-hud'),
    motionState: queryRequired<HTMLOutputElement>('#motion-state'),
    massOutput: queryRequired<HTMLElement>('#mass-output'),
    reachOutput: queryRequired<HTMLElement>('#reach-output'),
    comOutput: queryRequired<HTMLElement>('#com-output'),
    meshOutput: queryRequired<HTMLElement>('#mesh-output'),
    readyBadge: queryRequired<HTMLElement>('#robot-ready'),
    targetControls: queryRequired<HTMLDivElement>('#target-controls'),
    speedScaleInput: queryRequired<HTMLInputElement>('#speed-scale'),
    speedScaleOutput: queryRequired<HTMLOutputElement>('#speed-scale-output'),
    collisionToggle: queryRequired<HTMLInputElement>('#collision-toggle'),
    comToggle: queryRequired<HTMLInputElement>('#com-toggle'),
    framesToggle: queryRequired<HTMLInputElement>('#frames-toggle'),
    moveGroupState: queryRequired<HTMLOutputElement>('#move-group-state'),
    assetDescription: queryRequired<HTMLParagraphElement>('#asset-description'),
  };
}
