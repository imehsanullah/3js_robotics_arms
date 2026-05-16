import type { RobotDefinition } from './types';
import { panda } from './definitions/panda';
import { ur5e } from './definitions/ur5e';
import { xarm7 } from './definitions/xarm7';

export const ROBOTS: RobotDefinition[] = [ur5e, panda, xarm7];

export const ROBOT_BY_ID = Object.fromEntries(ROBOTS.map(robot => [robot.id, robot])) as Record<string, RobotDefinition>;

export * from './helpers';
export * from './types';
