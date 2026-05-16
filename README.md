# Three.js Robot Physics

Interactive Three.js robot visualization and kinematic action platform built from official robot description assets. The current registry includes UR5e, Franka Panda / FP3, and UFACTORY xArm7.

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
- Keyframe action playback for preview motions such as `wave_preview`.
- Collision checking between non-adjacent official collision meshes using BVH mesh intersection.
- Inertial mass properties, per-link center of mass markers, total center of mass, and gravity torque estimates per joint.
- Robot definitions are loaded from JSON configs under `public/robots/` and describe groups, frames, capabilities, presets, and actions.
- Config-driven robot metadata keeps arm-style manipulators extendable without robot-specific runtime code.
- A `SimulationBackend` interface is in place so a real physics backend can be added later without replacing the UI/control layer.

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

## Browser Action API

Robot definitions can expose named keyframe actions. The current app plays the robot's `defaultAction` from the play button, and actions can also be sampled from code:

```js
const actionName = 'wave_preview';
// See src/motion/actionPlayer.ts for reusable action sampling/playback.
```

Actions are kinematic previews, not dynamic simulations.

## Code Structure

- `src/main.ts`: app orchestration only.
- `public/robots/`: robot registry index and per-robot JSON configs.
- `src/robots/`: generic robot types, config loading, validation, normalization, and helpers.
- `src/rendering/`: scene setup, URDF loading, materials, overlays, disposal.
- `src/physics/`: collision collection/checks, inertials/COM, gravity torque readouts.
- `src/motion/`: joint state, CCD IK, and keyframe action playback.
- `src/simulation/`: backend interface and current kinematic backend.
- `src/ui/`: DOM bindings, robot selector, controls, and readouts.

## Adding Another Robot

1. Copy the upstream robot description assets into `public/<package_name>` and preserve the upstream license.
2. Generate a static URDF that keeps `package://<package_name>/...` mesh references.
3. Add `public/robots/<robot_id>/robot.json` with joint specs, groups, frame aliases, presets, actions, capabilities, collision metadata, downstream link map, and camera defaults.
4. Add that config path to `public/robots/index.json`.
5. The selector, controls, action playback, physics overlays, and `MoveGroupLite` groups are built from that config automatically.

## Asset Source

See [docs/ASSETS.md](docs/ASSETS.md). Copied upstream licenses are kept under each package directory in `public/`.
