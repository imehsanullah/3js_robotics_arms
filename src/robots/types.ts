export type JointName = string;
export type JointValues = Record<JointName, number>;
export type PoseName = string;
export type RobotGroupName = string;
export type RobotFrameName = string;
export type RobotActionName = string;

export interface JointSpec {
  name: JointName;
  label: string;
  lower: number;
  upper: number;
  velocity: number;
  effort: number;
}

export interface RobotGroupDefinition {
  name: RobotGroupName;
  label: string;
  jointNames: JointName[];
  defaultFrame?: RobotFrameName;
  supportsIk?: boolean;
}

export interface RobotCapabilities {
  fixedBase: boolean;
  supportsCollision: boolean;
  supportsInertials: boolean;
  supportsGravityTorques: boolean;
  supportsIk: boolean;
  supportsActions: boolean;
}

export interface RobotActionKeyframe {
  time: number;
  joints: Partial<JointValues>;
}

export interface RobotActionDefinition {
  name: RobotActionName;
  label: string;
  duration: number;
  loop?: boolean;
  keyframes: RobotActionKeyframe[];
}

export interface RobotCollisionMetadata {
  adjacentLinkChains: string[][];
  disabledPairs: Array<[string, string]>;
}

export interface RobotDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  packageName: string;
  packagePath: string;
  urdfPath: string;
  rootLink: string;
  jointSpecs: JointSpec[];
  groups: Record<RobotGroupName, RobotGroupDefinition>;
  defaultGroup: RobotGroupName;
  toolFrames: Record<RobotFrameName, string>;
  defaultToolFrame: RobotFrameName;
  linkChain: string[];
  collision: RobotCollisionMetadata;
  downstreamLinks: Record<JointName, string[]>;
  presets: Record<PoseName, JointValues>;
  actions: Record<RobotActionName, RobotActionDefinition>;
  defaultAction?: RobotActionName;
  capabilities: RobotCapabilities;
  initialTarget: { x: number; y: number; z: number };
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
  };
}

export interface RobotRegistry {
  robots: RobotDefinition[];
  robotById: Record<string, RobotDefinition>;
}
