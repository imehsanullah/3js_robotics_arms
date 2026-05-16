import type { JointSpec, RobotDefinition } from '../types';
import { action, group, joint, serialDownstream, values } from '../helpers';

const joints: JointSpec[] = [
  joint('joint1', 'Joint 1', -2.9007, 2.9007, 2.62, 87),
  joint('joint2', 'Joint 2', -1.8361, 1.8361, 2.62, 87),
  joint('joint3', 'Joint 3', -2.9007, 2.9007, 2.62, 87),
  joint('joint4', 'Joint 4', -3.077, -0.1169, 2.62, 87),
  joint('joint5', 'Joint 5', -2.8763, 2.8763, 5.26, 12),
  joint('joint6', 'Joint 6', 0.4398, 4.6216, 4.18, 12),
  joint('joint7', 'Joint 7', -3.0508, 3.0508, 5.26, 12),
];

const presets = {
  zero: values(joints, [0, 0, 0, -1.57, 0, 1.87, 0]),
  ready: values(joints, [0, -0.55, 0, -2.35, 0, 2.0, 0.78]),
  folded: values(joints, [0, -1.2, 0, -2.75, 0, 2.05, 0.78]),
  reach: values(joints, [0.42, -0.25, 0.18, -1.95, 0.28, 2.22, 1.1]),
};

export const panda: RobotDefinition = {
  id: 'panda',
  name: 'Franka Panda / FP3',
  shortName: 'Panda',
  description: 'Official Franka FP3 model with Panda-style 7-DOF arm',
  packageName: 'franka_description',
  packagePath: '/franka_description',
  urdfPath: '/franka_description/urdf/fp3.urdf',
  rootLink: 'link0',
  jointSpecs: joints,
  groups: {
    manipulator: group('manipulator', 'Manipulator', joints, 'tool'),
    arm: group('arm', 'Arm', joints, 'tool'),
  },
  defaultGroup: 'manipulator',
  toolFrames: {
    tool: 'link8',
  },
  defaultToolFrame: 'tool',
  linkChain: ['link0', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7', 'link8'],
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
        { time: 0.75, joints: { ...presets.reach, joint7: -0.7 } },
        { time: 1.5, joints: { ...presets.reach, joint7: 1.4 } },
        { time: 2.25, joints: { ...presets.reach, joint7: -0.4 } },
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
  initialTarget: { x: 0.34, y: -0.28, z: 0.48 },
  camera: {
    position: { x: 1.25, y: -1.45, z: 1.15 },
    target: { x: 0.1, y: 0, z: 0.55 },
  },
};
