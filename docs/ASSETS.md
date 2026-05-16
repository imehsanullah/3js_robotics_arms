# Robot Asset Sources

The viewer uses upstream robot description packages copied into `public/` with static browser-ready URDFs generated from their xacro/config files.

## Universal Robots UR5e

- Source package: `ur_description` from `UniversalRobots/Universal_Robots_ROS2_Description`
- Visual meshes: `meshes/ur5e/visual/*.dae`
- Collision meshes: `meshes/ur5e/collision/*.stl`
- Kinematics, inertial, joint-limit, and mesh-offset values: `config/ur5e/*.yaml` plus `urdf/ur_macro.xacro`
- Local copy: `public/ur_description`
- Browser URDF: `public/ur_description/urdf/ur5e.urdf`

## Franka Panda / FP3

- Source package: `franka_description` from `frankarobotics/franka_description`
- Visual meshes: `meshes/robots/fp3/visual/*.dae`
- Collision meshes: `meshes/robots/fp3/collision/*.stl`
- Kinematics, inertial, dynamics, accelerometer, and joint-limit values: `robots/fp3/*.yaml`
- Local copy: `public/franka_description`
- Browser URDF: `public/franka_description/urdf/fp3.urdf`

## UFACTORY xArm7

- Source package: `xarm_description` from `xArm-Developer/xarm_ros2`
- Visual meshes: `meshes/xarm7_1305/visual/*.dae`
- Collision meshes: `meshes/xarm7_1305/collision/*.obj`
- Kinematics and inertial values: `config/kinematics/default/xarm7_default_kinematics.yaml` and `config/link_inertial/xarm7_type7_HT_BR2.yaml`
- Local copy: `public/xarm_description`
- Browser URDF: `public/xarm_description/urdf/xarm7.urdf`

The generated URDFs keep `package://...` mesh references so `urdf-loader` can resolve meshes through the package map in `src/robots.ts`.

Runtime robot metadata is config-driven:

- Registry index: `public/robots/index.json`
- Per-robot configs: `public/robots/<robot_id>/robot.json`

Those configs define package paths, URDF paths, joints, groups, frames, presets, actions, capabilities, and collision/inertial metadata used by the TypeScript runtime.
