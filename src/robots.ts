export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export type JointName = string;
export type JointValues = Record<JointName, number>;
export type PoseName = string;

export interface JointSpec {
  name: JointName;
  label: string;
  lower: number;
  upper: number;
  velocity: number;
  effort: number;
}

export interface RobotDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  packageName: string;
  packagePath: string;
  urdfPath: string;
  toolFrame: string;
  rootLink: string;
  jointSpecs: JointSpec[];
  linkChain: string[];
  downstreamLinks: Record<JointName, string[]>;
  presets: Record<PoseName, JointValues>;
  initialTarget: { x: number; y: number; z: number };
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
  };
}

const TAU = Math.PI * 2;

const ur5eJoints: JointSpec[] = [
  joint('shoulder_pan_joint', 'Shoulder pan', -TAU, TAU, Math.PI, 150),
  joint('shoulder_lift_joint', 'Shoulder lift', -TAU, TAU, Math.PI, 150),
  joint('elbow_joint', 'Elbow', -Math.PI, Math.PI, Math.PI, 150),
  joint('wrist_1_joint', 'Wrist 1', -TAU, TAU, Math.PI, 28),
  joint('wrist_2_joint', 'Wrist 2', -TAU, TAU, Math.PI, 28),
  joint('wrist_3_joint', 'Wrist 3', -TAU, TAU, Math.PI, 28),
];

const pandaJoints: JointSpec[] = [
  joint('joint1', 'Joint 1', -2.9007, 2.9007, 2.62, 87),
  joint('joint2', 'Joint 2', -1.8361, 1.8361, 2.62, 87),
  joint('joint3', 'Joint 3', -2.9007, 2.9007, 2.62, 87),
  joint('joint4', 'Joint 4', -3.077, -0.1169, 2.62, 87),
  joint('joint5', 'Joint 5', -2.8763, 2.8763, 5.26, 12),
  joint('joint6', 'Joint 6', 0.4398, 4.6216, 4.18, 12),
  joint('joint7', 'Joint 7', -3.0508, 3.0508, 5.26, 12),
];

const xarm7Joints: JointSpec[] = [
  joint('joint1', 'Joint 1', -TAU, TAU, 3.14, 50),
  joint('joint2', 'Joint 2', -2.059, 2.0944, 3.14, 50),
  joint('joint3', 'Joint 3', -TAU, TAU, 3.14, 30),
  joint('joint4', 'Joint 4', -0.19198, 3.927, 3.14, 30),
  joint('joint5', 'Joint 5', -TAU, TAU, 3.14, 30),
  joint('joint6', 'Joint 6', -1.69297, Math.PI, 3.14, 20),
  joint('joint7', 'Joint 7', -TAU, TAU, 3.14, 20),
];

export const ROBOTS: RobotDefinition[] = [
  {
    id: 'ur5e',
    name: 'Universal Robots UR5e',
    shortName: 'UR5e',
    description: 'Official UR ROS2 meshes and URDF-derived kinematics',
    packageName: 'ur_description',
    packagePath: '/ur_description',
    urdfPath: '/ur_description/urdf/ur5e.urdf',
    toolFrame: 'tool0',
    rootLink: 'base_link_inertia',
    jointSpecs: ur5eJoints,
    linkChain: [
      'base_link_inertia',
      'shoulder_link',
      'upper_arm_link',
      'forearm_link',
      'wrist_1_link',
      'wrist_2_link',
      'wrist_3_link',
    ],
    downstreamLinks: downstream([
      ['shoulder_pan_joint', ['shoulder_link', 'upper_arm_link', 'forearm_link', 'wrist_1_link', 'wrist_2_link', 'wrist_3_link']],
      ['shoulder_lift_joint', ['upper_arm_link', 'forearm_link', 'wrist_1_link', 'wrist_2_link', 'wrist_3_link']],
      ['elbow_joint', ['forearm_link', 'wrist_1_link', 'wrist_2_link', 'wrist_3_link']],
      ['wrist_1_joint', ['wrist_1_link', 'wrist_2_link', 'wrist_3_link']],
      ['wrist_2_joint', ['wrist_2_link', 'wrist_3_link']],
      ['wrist_3_joint', ['wrist_3_link']],
    ]),
    presets: {
      zero: values(ur5eJoints, [0, 0, 0, 0, 0, 0]),
      ready: values(ur5eJoints, [-28 * DEG2RAD, -92 * DEG2RAD, 104 * DEG2RAD, -104 * DEG2RAD, -90 * DEG2RAD, 0]),
      folded: values(ur5eJoints, [0, -128 * DEG2RAD, 132 * DEG2RAD, -96 * DEG2RAD, -90 * DEG2RAD, 0]),
      reach: values(ur5eJoints, [34 * DEG2RAD, -72 * DEG2RAD, 88 * DEG2RAD, -112 * DEG2RAD, -88 * DEG2RAD, 42 * DEG2RAD]),
    },
    initialTarget: { x: -0.48, y: -0.34, z: 0.46 },
    camera: {
      position: { x: 1.35, y: -1.65, z: 1.12 },
      target: { x: -0.22, y: 0, z: 0.46 },
    },
  },
  {
    id: 'panda',
    name: 'Franka Panda / FP3',
    shortName: 'Panda',
    description: 'Official Franka FP3 model with Panda-style 7-DOF arm',
    packageName: 'franka_description',
    packagePath: '/franka_description',
    urdfPath: '/franka_description/urdf/fp3.urdf',
    toolFrame: 'link8',
    rootLink: 'link0',
    jointSpecs: pandaJoints,
    linkChain: ['link0', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7', 'link8'],
    downstreamLinks: serialDownstream(pandaJoints, ['link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7']),
    presets: {
      zero: values(pandaJoints, [0, 0, 0, -1.57, 0, 1.87, 0]),
      ready: values(pandaJoints, [0, -0.55, 0, -2.35, 0, 2.0, 0.78]),
      folded: values(pandaJoints, [0, -1.2, 0, -2.75, 0, 2.05, 0.78]),
      reach: values(pandaJoints, [0.42, -0.25, 0.18, -1.95, 0.28, 2.22, 1.1]),
    },
    initialTarget: { x: 0.34, y: -0.28, z: 0.48 },
    camera: {
      position: { x: 1.25, y: -1.45, z: 1.15 },
      target: { x: 0.1, y: 0, z: 0.55 },
    },
  },
  {
    id: 'xarm7',
    name: 'UFACTORY xArm7',
    shortName: 'xArm7',
    description: 'Official UFACTORY xArm7 ROS2 meshes and kinematics',
    packageName: 'xarm_description',
    packagePath: '/xarm_description',
    urdfPath: '/xarm_description/urdf/xarm7.urdf',
    toolFrame: 'link_eef',
    rootLink: 'link_base',
    jointSpecs: xarm7Joints,
    linkChain: ['link_base', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7', 'link_eef'],
    downstreamLinks: serialDownstream(xarm7Joints, ['link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7']),
    presets: {
      zero: values(xarm7Joints, [0, 0, 0, 0, 0, 0, 0]),
      ready: values(xarm7Joints, [0, -0.75, 0, 1.25, 0, 0.9, 0]),
      folded: values(xarm7Joints, [0, -1.25, 0, 2.2, 0, 1.1, 0]),
      reach: values(xarm7Joints, [0.48, -0.52, 0.25, 1.42, -0.2, 1.18, 0.55]),
    },
    initialTarget: { x: 0.42, y: -0.32, z: 0.48 },
    camera: {
      position: { x: 1.35, y: -1.55, z: 1.05 },
      target: { x: 0.12, y: 0, z: 0.45 },
    },
  },
];

export const ROBOT_BY_ID = Object.fromEntries(ROBOTS.map(robot => [robot.id, robot])) as Record<string, RobotDefinition>;

export function getDefaultPreset(robot: RobotDefinition) {
  return robot.presets.ready ?? robot.presets.zero;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clampJointValues(robot: RobotDefinition, jointValues: Partial<JointValues>) {
  const clamped: JointValues = {};
  for (const spec of robot.jointSpecs) {
    const value = jointValues[spec.name] ?? 0;
    clamped[spec.name] = clamp(value, spec.lower, spec.upper);
  }
  return clamped;
}

export function cloneJointValues(robot: RobotDefinition, valuesToClone: Partial<JointValues>) {
  return clampJointValues(robot, valuesToClone);
}

export function formatDeg(radians: number) {
  return `${(radians * RAD2DEG).toFixed(1)} deg`;
}

export function formatMeters(meters: number) {
  return `${meters.toFixed(3)} m`;
}

function joint(name: string, label: string, lower: number, upper: number, velocity: number, effort: number): JointSpec {
  return { name, label, lower, upper, velocity, effort };
}

function values(jointSpecs: JointSpec[], jointValues: number[]) {
  return Object.fromEntries(jointSpecs.map((spec, index) => [spec.name, jointValues[index] ?? 0])) as JointValues;
}

function downstream(pairs: [string, string[]][]) {
  return Object.fromEntries(pairs) as Record<string, string[]>;
}

function serialDownstream(jointSpecs: JointSpec[], childLinks: string[]) {
  return Object.fromEntries(
    jointSpecs.map((spec, index) => [spec.name, childLinks.slice(index)]),
  ) as Record<JointName, string[]>;
}
