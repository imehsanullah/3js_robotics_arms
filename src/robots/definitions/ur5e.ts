import type { JointSpec, RobotDefinition } from '../types';
import { DEG2RAD, TAU, action, downstream, group, joint, values } from '../helpers';

const joints: JointSpec[] = [
  joint('shoulder_pan_joint', 'Shoulder pan', -TAU, TAU, Math.PI, 150),
  joint('shoulder_lift_joint', 'Shoulder lift', -TAU, TAU, Math.PI, 150),
  joint('elbow_joint', 'Elbow', -Math.PI, Math.PI, Math.PI, 150),
  joint('wrist_1_joint', 'Wrist 1', -TAU, TAU, Math.PI, 28),
  joint('wrist_2_joint', 'Wrist 2', -TAU, TAU, Math.PI, 28),
  joint('wrist_3_joint', 'Wrist 3', -TAU, TAU, Math.PI, 28),
];

const presets = {
  zero: values(joints, [0, 0, 0, 0, 0, 0]),
  ready: values(joints, [-28 * DEG2RAD, -92 * DEG2RAD, 104 * DEG2RAD, -104 * DEG2RAD, -90 * DEG2RAD, 0]),
  folded: values(joints, [0, -128 * DEG2RAD, 132 * DEG2RAD, -96 * DEG2RAD, -90 * DEG2RAD, 0]),
  reach: values(joints, [34 * DEG2RAD, -72 * DEG2RAD, 88 * DEG2RAD, -112 * DEG2RAD, -88 * DEG2RAD, 42 * DEG2RAD]),
};

export const ur5e: RobotDefinition = {
  id: 'ur5e',
  name: 'Universal Robots UR5e',
  shortName: 'UR5e',
  description: 'Official UR ROS2 meshes and URDF-derived kinematics',
  packageName: 'ur_description',
  packagePath: '/ur_description',
  urdfPath: '/ur_description/urdf/ur5e.urdf',
  rootLink: 'base_link_inertia',
  jointSpecs: joints,
  groups: {
    manipulator: group('manipulator', 'Manipulator', joints, 'tool'),
    arm: group('arm', 'Arm', joints, 'tool'),
  },
  defaultGroup: 'manipulator',
  toolFrames: {
    tool: 'tool0',
  },
  defaultToolFrame: 'tool',
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
  presets,
  actions: {
    ready: action('ready', 'Ready', 1.2, [
      { time: 0, joints: presets.folded },
      { time: 1.2, joints: presets.ready },
    ]),
    reach: action('reach', 'Reach', 1.2, [
      { time: 0, joints: presets.ready },
      { time: 1.2, joints: presets.reach },
    ]),
    wave_preview: action(
      'wave_preview',
      'Wave Preview',
      3.0,
      [
        { time: 0, joints: presets.ready },
        { time: 0.75, joints: { ...presets.reach, wrist_3_joint: -0.9 } },
        { time: 1.5, joints: { ...presets.reach, wrist_3_joint: 0.9 } },
        { time: 2.25, joints: { ...presets.reach, wrist_3_joint: -0.7 } },
        { time: 3.0, joints: presets.ready },
      ],
      true,
    ),
  },
  defaultAction: 'wave_preview',
  capabilities: {
    fixedBase: true,
    supportsCollision: true,
    supportsInertials: true,
    supportsGravityTorques: true,
    supportsIk: true,
    supportsActions: true,
  },
  initialTarget: { x: -0.48, y: -0.34, z: 0.46 },
  camera: {
    position: { x: 1.35, y: -1.65, z: 1.12 },
    target: { x: -0.22, y: 0, z: 0.46 },
  },
};
