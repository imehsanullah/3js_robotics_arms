# Three.js Robot Physics

Interactive Three.js robot-arm viewer built from official robot description assets. The current robot registry includes UR5e, Franka Panda / FP3, and UFACTORY xArm7.

## Run

```bash
npm install
npm run dev
```

The app serves browser-ready URDFs and meshes from `public/*_description`.

## What Is Implemented

- Robot picker for UR5e, Panda / FP3, and xArm7.
- Static browser-ready URDFs generated from upstream ROS xacro/config data.
- Official visual and collision meshes copied under `public/`.
- Revolute joint hierarchy, limits, effort limits, and max-velocity constrained motion.
- Forward kinematics with live tool-frame pose.
- CCD inverse kinematics for a movable tool target.
- Browser-only `MoveGroupLite` API for named targets, joint targets, pose targets, planning, execution, and stop.
- Collision checking between non-adjacent official collision meshes using BVH mesh intersection.
- Inertial mass properties, per-link center of mass markers, total center of mass, and gravity torque estimates per joint.
- Robot definitions are centralized in `src/robots.ts` so new arms can be added without threading constants through the viewer.

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

## Adding Another Robot

1. Copy the upstream robot description assets into `public/<package_name>`.
2. Generate a static URDF that keeps `package://<package_name>/...` mesh references.
3. Add a `RobotDefinition` entry in `src/robots.ts` with joint specs, presets, link chain, downstream link map, tool frame, and camera defaults.
4. The selector, controls, physics overlays, and `MoveGroupLite` groups are built from that definition automatically.

## Asset Source

See [docs/ASSETS.md](docs/ASSETS.md). Copied upstream licenses are kept under each package directory in `public/`.
