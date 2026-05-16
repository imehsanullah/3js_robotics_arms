import type { JointName, JointValues, RobotDefinition } from '../robots';

export interface SimulationBackend {
  loadRobot(robot: RobotDefinition): void;
  isReady(): boolean;
  getCurrentJointValues(): JointValues;
  setJointValues(values: Partial<Record<JointName, number>>): void;
  step(dt: number): void;
  reset(): void;
}
