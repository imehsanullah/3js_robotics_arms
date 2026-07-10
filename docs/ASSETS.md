# Robot asset sources

The workbench vendors only the files needed at runtime plus upstream license texts. Git blob comparisons were performed against the revisions below; generated browser URDFs are local build products and are documented separately.

## Verified upstream revisions

### Universal Robots UR5e

- Repository: [`UniversalRobots/Universal_Robots_ROS2_Description`](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description)
- Verified revision: [`ae333289875f9ba5a9ea6649a54036efb5ccabee`](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description/commit/ae333289875f9ba5a9ea6649a54036efb5ccabee), tag `4.3.1`
- Local package: `public/ur_description`
- Retained upstream files: UR5e visual DAE, collision STL, `config/ur5e/*.yaml`, and `LICENSE`
- Browser URDF: `public/ur_description/urdf/ur5e.urdf`

Every retained non-generated UR file byte-matches tag `4.3.1`. The local URDF header records `config/ur5e` plus `urdf/ur_macro.xacro` as its inputs.

### Franka Research 3

- Repository: [`frankarobotics/franka_description`](https://github.com/frankarobotics/franka_description)
- Verified revision: [`02afaae282d4a8e10d7d2f781b23b3515c303ce5`](https://github.com/frankarobotics/franka_description/commit/02afaae282d4a8e10d7d2f781b23b3515c303ce5), tag `2.8.1`
- Local package: `public/franka_description`
- Retained upstream files: `meshes/robots/fr3/{visual,collision}`, `robots/fr3/*.yaml`, and `LICENSE`
- Browser URDF: `public/franka_description/urdf/fr3.urdf`

Every retained non-generated Franka file byte-matches this revision. The unregistered FP3 meshes, YAML, and URDF were removed; the package Apache-2.0 license remains untouched.

### UFACTORY xArm7

- Repository: [`xArm-Developer/xarm_ros2`](https://github.com/xArm-Developer/xarm_ros2)
- Verified revision: [`d0b95117dabd3883f41155125aa3f67d37901c18`](https://github.com/xArm-Developer/xarm_ros2/commit/d0b95117dabd3883f41155125aa3f67d37901c18), `humble` branch at verification time
- Local package: `public/xarm_description`
- Retained upstream files: xArm7 visual DAE, collision OBJ, the default kinematics/inertial YAML, and repository `LICENSE`
- Browser URDF: `public/xarm_description/urdf/xarm7.urdf`

Every retained non-generated xArm file byte-matches this revision. Duplicate visual STL files were removed because the URDF references the DAE visuals.

### Robotiq 2F-85

- Repository: [`PickNikRobotics/ros2_robotiq_gripper`](https://github.com/PickNikRobotics/ros2_robotiq_gripper)
- Verified revision: [`3b6cf8ff9106384e72c23de7d3ba989fb6b41141`](https://github.com/PickNikRobotics/ros2_robotiq_gripper/commit/3b6cf8ff9106384e72c23de7d3ba989fb6b41141), `main` branch at verification time
- Local package: `public/robotiq_description`
- Retained upstream files: 2F-85 visual DAE and collision STL (flattened locally from each upstream `2f_85` directory) plus repository `LICENSE`
- Browser URDF: `public/robotiq_description/urdf/robotiq_gripper.urdf`

The retained meshes and BSD-3-Clause license byte-match this revision. The unused UR-to-Robotiq adapter visual/collision meshes were removed. The reduced local `package.xml` and generated URDF do not byte-match the cited revision and are not claimed as pristine upstream files.

## Static browser URDF generation

The checked-in URDFs contain no xacro expressions and keep `package://...` mesh URLs so `urdf-loader` can resolve them from the runtime package map.

The recoverable generation process is:

1. Check out the verified revision and install ROS `xacro`.
2. Resolve the model entry file and its YAML dependencies in a temporary package workspace.
3. Expand to XML, retaining visual, collision, inertial, joint limit, mimic, and fixed-frame elements.
4. Preserve package URLs, add a fixed browser root when required, and copy the result to `public/<package>/urdf/`.
5. Serve the repository and verify every referenced mesh returns successfully.

Recorded entry inputs are:

- UR5e: `urdf/ur_macro.xacro` plus the 4.3.1 UR5e config YAML (the local file is a purpose-built static expansion rather than direct `xacro` output).
- FR3: `robots/fr3/fr3.urdf.xacro`; its generated header records the temporary YAML paths.
- xArm7: `xarm_description/urdf/xarm_device.urdf.xacro`; its header records the temporary resolved workspace.
- Robotiq: the generated header records `/tmp/robotiq_xacro_browser/urdf/robotiq_gripper.urdf.xacro`. That historical path existed in earlier upstream history, but the exact checkout and command were not preserved, so no more specific revision is asserted for the generated URDF.

The original shell invocations and arguments were not committed. Reproducers should compare generated link/joint names and browser smoke results rather than assuming an undocumented invocation.

## Licenses and local changes

Retained upstream licenses are:

- `public/ur_description/LICENSE`
- `public/franka_description/LICENSE`
- `public/xarm_description/LICENSE`
- `public/robotiq_description/LICENSE`

These files were not edited. The repository's own TypeScript, HTML, CSS, tests, and documentation use the root BSD-3-Clause [LICENSE](../LICENSE).

Local modifications are limited to static browser URDF generation, Robotiq mesh-directory flattening, the reduced Robotiq package metadata, robot-binding JSON, and removal of confirmed unused FP3, xArm STL-visual, and adapter assets. Runtime configuration lives under `public/robots`; its schema is documented in [ROBOT_CONFIG.md](ROBOT_CONFIG.md).
