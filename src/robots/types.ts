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
  jointNames: JointName[];
}

export interface RobotCapabilities {
  supportsCollision: boolean;
  supportsInertials: boolean;
  supportsIk: boolean;
}

export interface RobotActionKeyframe {
  time: number;
  joints: Partial<JointValues>;
}

export interface RobotActionDefinition {
  label: string;
  duration: number;
  loop?: boolean;
  keyframes: RobotActionKeyframe[];
}

export interface Vector3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface EndEffectorTransform {
  position: Vector3Tuple;
  rpy: Vector3Tuple;
}

export interface EndEffectorCommandSpec {
  jointName: JointName;
  label: string;
  lower: number;
  upper: number;
  open: number;
  close: number;
  velocity: number;
}

export interface RobotEndEffectorDefinition {
  id: string;
  name: string;
  shortName: string;
  packageName: string;
  packagePath: string;
  urdfPath: string;
  mountFrame: RobotFrameName;
  origin: EndEffectorTransform;
  tcpOffset: Vector3Tuple;
  command: EndEffectorCommandSpec;
}

export interface RobotDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  packageName: string;
  packagePath: string;
  urdfPath: string;
  jointSpecs: JointSpec[];
  groups: Record<RobotGroupName, RobotGroupDefinition>;
  defaultGroup: RobotGroupName;
  toolFrames: Record<RobotFrameName, string>;
  defaultToolFrame: RobotFrameName;
  endEffector?: RobotEndEffectorDefinition;
  presets: Record<PoseName, JointValues>;
  actions: Record<RobotActionName, RobotActionDefinition>;
  defaultAction?: RobotActionName;
  capabilities: RobotCapabilities;
  initialTarget: Vector3Tuple;
  camera: {
    position: Vector3Tuple;
    target: Vector3Tuple;
  };
}

export interface RobotRegistry {
  robots: RobotDefinition[];
  robotById: Record<string, RobotDefinition>;
}
