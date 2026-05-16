import type { JointSpec, RobotDefinition } from '../types';
import { TAU, action, group, joint, serialDownstream, values } from '../helpers';

const joints: JointSpec[] = [
  joint('joint1', 'Joint 1', -TAU, TAU, 3.14, 50),
  joint('joint2', 'Joint 2', -2.059, 2.0944, 3.14, 50),
  joint('joint3', 'Joint 3', -TAU, TAU, 3.14, 30),
  joint('joint4', 'Joint 4', -0.19198, 3.927, 3.14, 30),
  joint('joint5', 'Joint 5', -TAU, TAU, 3.14, 30),
  joint('joint6', 'Joint 6', -1.69297, Math.PI, 3.14, 20),
  joint('joint7', 'Joint 7', -TAU, TAU, 3.14, 20),
];

const presets = {
  zero: values(joints, [0, 0, 0, 0, 0, 0, 0]),
  ready: values(joints, [0, -0.75, 0, 1.25, 0, 0.9, 0]),
  folded: values(joints, [0, -1.25, 0, 2.2, 0, 1.1, 0]),
  reach: values(joints, [0.48, -0.52, 0.25, 1.42, -0.2, 1.18, 0.55]),
};

export const xarm7: RobotDefinition = {
  id: 'xarm7',
  name: 'UFACTORY xArm7',
  shortName: 'xArm7',
  description: 'Official UFACTORY xArm7 ROS2 meshes and kinematics',
  packageName: 'xarm_description',
  packagePath: '/xarm_description',
  urdfPath: '/xarm_description/urdf/xarm7.urdf',
  rootLink: 'link_base',
  jointSpecs: joints,
  groups: {
    manipulator: group('manipulator', 'Manipulator', joints, 'tool'),
    arm: group('arm', 'Arm', joints, 'tool'),
  },
  defaultGroup: 'manipulator',
  toolFrames: {
    tool: 'link_eef',
  },
  defaultToolFrame: 'tool',
  linkChain: ['link_base', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7', 'link_eef'],
  downstreamLinks: serialDownstream(joints, ['link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7']),
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
        { time: 0.75, joints: { ...presets.reach, joint7: -0.85 } },
        { time: 1.5, joints: { ...presets.reach, joint7: 1.05 } },
        { time: 2.25, joints: { ...presets.reach, joint7: -0.55 } },
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
  initialTarget: { x: 0.42, y: -0.32, z: 0.48 },
  camera: {
    position: { x: 1.35, y: -1.55, z: 1.05 },
    target: { x: 0.12, y: 0, z: 0.45 },
  },
};
