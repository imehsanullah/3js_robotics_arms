# Three.js Robot Physics

Interactive Three.js robot visualization and kinematic action platform. The current registry includes UR5e, Franka Research 3, and UFACTORY xArm7.

## Run

With Docker:

```bash
docker compose up --build
```

Then open `http://localhost:5174`. To use a different host port:

```bash
APP_PORT=5175 docker compose up --build
```

Stop it with:

```bash
docker compose down
```

Local Node:

```bash
npm install
npm run dev
```

The app serves browser-ready URDFs and meshes from `public/*_description`.

## What Is Implemented

- Robot picker for UR5e, Franka Research 3, and xArm7.
- Static browser-ready URDFs generated from upstream ROS xacro/config data.
- Official visual and collision meshes under `public/`.
- Config-driven Robotiq 2F-85 gripper mounting using the upstream ROS2 description, mimic-joint close kinematics, and optional gripper-object contact preview.
- Revolute joint hierarchy, limits, effort limits, and max-velocity constrained motion.
- Forward kinematics with live tool-frame or gripper TCP pose.
- CCD inverse kinematics for a movable tool target.
- Mouse-draggable pose target in the 3D viewport.
- Browser-only `MoveGroupLite` API for named targets, joint targets, pose targets, planning, execution, and stop.
- Keyframe action playback for preview motions such as `wave_preview`.
- Collision checking between non-adjacent official collision meshes using BVH mesh intersection.
- Inertial mass properties, per-link center of mass markers, total center of mass, and gravity torque estimates per joint.
- Robot definitions are loaded from JSON configs under `public/robots/` and describe groups, frames, capabilities, presets, and actions.
- Config-driven robot metadata keeps arm-style manipulators extendable without robot-specific runtime code.
- A `SimulationBackend` interface is in place so a real physics backend can be added later without replacing the UI/control layer.

## Browser APIs

Move groups, gripper helpers, and keyframe actions are exposed on `window` in devtools. See [docs/BROWSER_API.md](docs/BROWSER_API.md).

## Code Structure

- `src/main.ts`: app orchestration only.
- `src/endEffectors/`: configurable end-effector controls and runtime state.
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
4. Optionally add `endEffectors` entries that point to browser-ready end-effector URDF packages and define mount frames, TCP offsets, command joints, and parallel-grip contact previews.
5. Add that config path to `public/robots/index.json`.
6. The selector, controls, action playback, physics overlays, gripper controls, and `MoveGroupLite` groups are built from that config automatically.

## Asset Source

See [docs/ASSETS.md](docs/ASSETS.md). Copied upstream licenses are kept under each package directory in `public/`.
