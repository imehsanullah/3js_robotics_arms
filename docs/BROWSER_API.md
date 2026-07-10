# Browser API

The globals below are installed after the selected robot reaches **Ready** and are cleared during a robot switch or failed load. These are the only supported browser globals; there is no separate browser Action API.

## Move groups

`window.moveIt` is the active `MoveGroupLite` controller. `window.robotMoveGroup` is its configured default group. Every checked-in robot currently exposes only `manipulator`:

```js
const arm = window.robotMoveGroup;
// Equivalent:
const sameArm = window.moveIt.group('manipulator');

window.moveIt.getGroupNames();   // ['manipulator']
window.moveIt.getNamedTargets(); // ['zero', 'ready', 'folded', 'reach']
```

Target setters validate immediately, clear the cached plan, return the group for chaining, and throw for unknown joints/targets, non-finite values, or out-of-range joints:

```js
arm.setNamedTarget('ready');

const current = arm.getCurrentJointValues();
arm.setJointValueTarget({ ...current });
arm.setJointTarget({ ...current }); // alias

const pose = arm.getCurrentPose();
arm.setPoseTarget({
  position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
});

arm.clearPoseTargets();
arm.getCurrentPose(); // { position, quaternion, rpy } or null while unavailable
```

`plan()` returns a promise for a plan. Planning requires an explicit target; there is no implicit Ready target:

```js
const plan = await arm.setNamedTarget('reach').plan({
  avoidCollisions: true,
  maxVelocityScalingFactor: 0.7, // > 0 and <= 1
  stepsPerSecond: 60,            // 1 through 240
});

plan.success;
plan.failureReasons; // not-ready, invalid-target, ik, and/or collision
plan.warnings;
plan.collisions;
plan.trajectory;
```

`execute(plan?, options?)` resolves to `{ status, plan, message }`, where status is `done`, `stopped`, or `failed`. Omitting the plan uses the currently cached plan or plans the current target. A plan retained before any target change is stale and fails rather than executing.

```js
const result = await arm.execute(plan, { speedScale: 1 }); // > 0 and <= 5
const combined = await arm.setNamedTarget('ready').go({
  avoidCollisions: true,
  speedScale: 1,
});

arm.stop(); // holds the current joint state and stops active execution
```

`allowCollisionExecution: true` may bypass a collision-only rejection. It never bypasses not-ready, missing/invalid-target, or failed-IK plans.

Pose planning uses the mounted gripper TCP when present. CCD IK is position-only. Supplying `rpy` or `quaternion` preserves the position request and adds an orientation-not-solved warning; it does not perform orientation IK. Collision avoidance samples the interpolated joint trajectory and is not full MoveIt or continuous collision detection.

## Robotiq gripper

`window.gripper` exists when the selected robot's Robotiq model is ready:

```js
window.gripper.close();      // void; sets the configured close target
window.gripper.open();       // void; sets the configured open target
window.gripper.set(0.4);     // void; finite radians, clamped to the command range
window.gripper.get();        // current animated command in radians, or null
window.gripper.getOpening(); // estimated jaw opening in metres, or null
```

Commands animate the real URDF command joint and its upstream mimic-joint linkage. The API has no synthetic motion-mode, contact-object, or parallel-pinch methods.

The toolbar Play button remains the only public way to start the configured default keyframe action. Actions and all arm motions are kinematic previews.
