# Browser APIs

## Browser Move Group API

Open browser devtools on the running app and use the exposed group:

```js
const arm = window.moveIt.group('manipulator');

await arm.setNamedTarget('ready').go();
await arm.setNamedTarget('reach').go();

await arm
  .setJointValueTarget({
    joint1: 0.4,
    joint2: -0.7,
    joint4: 1.2,
  })
  .go();

await arm
  .setPoseTarget({
    position: { x: -0.48, y: -0.34, z: 0.46 },
  })
  .go();

arm.stop();
```

The browser implementation is intentionally MoveIt-like, not full MoveIt. It uses joint-space interpolation, the existing CCD IK for pose targets, velocity limits, and optional mesh collision checks.

## Browser Gripper API

The active end effector is exposed separately from the arm move group:

```js
window.gripper.close();
window.gripper.open();
window.gripper.set(0.4);
window.gripper.get();
window.gripper.getOpening();
window.gripper.getMotionMode();
window.gripper.setMotionMode('adaptive-linkage');
window.gripper.setMotionMode('parallel-pinch');
window.gripper.setContactEnabled(true);
```

The current Robotiq configs default to the upstream adaptive-linkage mimic joints from `robotiq_description`, while the readout reports the estimated jaw gap. Enable contact preview from code when you want `close()` to stop at the configured object width and report contact. For pose targets, `MoveGroupLite` uses the gripper TCP when a gripper is mounted, so `setPoseTarget()` moves the grasp point rather than the bare arm flange.

## Browser Action API

Robot definitions can expose named keyframe actions. The current app plays the robot's `defaultAction` from the play button, and actions can also be sampled from code:

```js
const actionName = 'wave_preview';
// See src/motion/actionPlayer.ts for reusable action sampling/playback.
```

Actions are kinematic previews, not dynamic simulations.
