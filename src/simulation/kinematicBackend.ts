import { URDFRobot } from 'urdf-loader';
import { clamp, cloneJointValues } from '../robots';
import type { JointName, JointValues, RobotDefinition } from '../robots';
import type { SimulationBackend } from './types';

export class KinematicBackend implements SimulationBackend {
  private robotDefinition: RobotDefinition | null = null;
  private model: URDFRobot | null = null;
  private readonly currentJoints: JointValues = {};

  attachModel(model: URDFRobot | null) {
    this.model = model;
    if (this.model) {
      this.applyToModel(this.currentJoints);
    }
  }

  loadRobot(robot: RobotDefinition) {
    this.robotDefinition = robot;
    this.reset();
  }

  isReady() {
    return Boolean(this.robotDefinition && this.model);
  }

  getCurrentJointValues() {
    if (!this.robotDefinition) {
      return {};
    }
    return cloneJointValues(this.robotDefinition, this.currentJoints);
  }

  setJointValues(values: Partial<Record<JointName, number>>) {
    if (!this.robotDefinition) {
      return;
    }

    for (const spec of this.robotDefinition.jointSpecs) {
      const next = values[spec.name];
      if (next === undefined) {
        continue;
      }
      this.currentJoints[spec.name] = clamp(next, spec.lower, spec.upper);
    }
    this.applyToModel(this.currentJoints);
  }

  step(_dt: number) {
    this.applyToModel(this.currentJoints);
  }

  reset() {
    for (const key of Object.keys(this.currentJoints)) {
      delete this.currentJoints[key];
    }
    if (!this.robotDefinition) {
      return;
    }
    const preset = this.robotDefinition.presets.ready ?? this.robotDefinition.presets.zero ?? {};
    for (const spec of this.robotDefinition.jointSpecs) {
      this.currentJoints[spec.name] = clamp(preset[spec.name] ?? 0, spec.lower, spec.upper);
    }
    this.applyToModel(this.currentJoints);
  }

  private applyToModel(values: JointValues) {
    if (!this.model || !this.robotDefinition) {
      return;
    }

    for (const spec of this.robotDefinition.jointSpecs) {
      const next = values[spec.name];
      if (next !== undefined) {
        this.model.setJointValue(spec.name, clamp(next, spec.lower, spec.upper));
      }
    }
    this.model.updateMatrixWorld(true);
  }
}
