import type {
  EndEffectorCommandSpec,
  JointSpec,
  JointValues,
  RobotActionDefinition,
  RobotCapabilities,
  RobotDefinition,
  RobotEndEffectorDefinition,
  RobotGroupDefinition,
  RobotRegistry,
  Vector3Tuple,
} from './types';

interface RobotIndexConfig {
  robots: string[];
}

const canonicalPresets = ['zero', 'ready', 'folded', 'reach'] as const;
const defaultCapabilities: RobotCapabilities = {
  supportsCollision: false,
  supportsInertials: false,
  supportsIk: false,
};

export async function loadRobotRegistry(indexPath = '/robots/index.json', basePath = '/'): Promise<RobotRegistry> {
  const index = await fetchJson<RobotIndexConfig>(indexPath);
  if (!Array.isArray(index.robots) || index.robots.length === 0) {
    throw new Error(`Robot registry index must list at least one robot: ${indexPath}`);
  }
  if (index.robots.some(path => typeof path !== 'string' || path.length === 0)) {
    throw new Error(`Robot registry paths must be non-empty strings: ${indexPath}`);
  }

  const robots = await Promise.all(
    index.robots.map(async configPath =>
      normalizeRobotDefinition(
        await fetchJson<unknown>(resolvePath(indexPath, configPath, basePath)),
        configPath,
        basePath,
      ),
    ),
  );
  const ids = new Set<string>();
  for (const robot of robots) {
    if (ids.has(robot.id)) {
      throw new Error(`Duplicate robot ID: ${robot.id}`);
    }
    ids.add(robot.id);
  }

  const robotById = Object.fromEntries(robots.map(robot => [robot.id, robot])) as Record<string, RobotDefinition>;
  return { robots, robotById };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function resolvePath(indexPath: string, configPath: string, basePath: string) {
  if (configPath.startsWith('/')) {
    return resolveFromBase(configPath, basePath);
  }
  return `${indexPath.slice(0, indexPath.lastIndexOf('/') + 1)}${configPath}`;
}

function resolveFromBase(path: string, basePath: string) {
  if (!path.startsWith('/')) {
    return path;
  }
  return `${basePath.replace(/\/$/, '')}${path}`;
}

function normalizeRobotDefinition(raw: unknown, sourcePath: string, basePath: string): RobotDefinition {
  const record = asRecord(raw, sourcePath);
  const jointSpecs = normalizeJointSpecs(record.jointSpecs, `${sourcePath}.jointSpecs`);
  const specByName = new Map(jointSpecs.map(spec => [spec.name, spec]));
  const groups = normalizeGroups(record.groups, specByName, `${sourcePath}.groups`);
  const defaultGroup = requiredString(record, 'defaultGroup', sourcePath);
  if (!groups[defaultGroup]) {
    throw new Error(`Unknown defaultGroup ${defaultGroup}: ${sourcePath}`);
  }

  const toolFrames = normalizeStringRecord(record.toolFrames, `${sourcePath}.toolFrames`);
  if (Object.keys(toolFrames).length === 0) {
    throw new Error(`Robot config must define at least one tool frame: ${sourcePath}.toolFrames`);
  }
  const defaultToolFrame = requiredString(record, 'defaultToolFrame', sourcePath);
  if (!toolFrames[defaultToolFrame]) {
    throw new Error(`Unknown defaultToolFrame ${defaultToolFrame}: ${sourcePath}`);
  }

  const presets = normalizePresets(record.presets, specByName, `${sourcePath}.presets`);
  const actions = normalizeActions(record.actions, specByName, `${sourcePath}.actions`);
  const defaultAction = optionalString(record.defaultAction, `${sourcePath}.defaultAction`);
  if (defaultAction && !actions[defaultAction]) {
    throw new Error(`Unknown defaultAction ${defaultAction}: ${sourcePath}`);
  }
  if (Object.keys(actions).length > 0 && !defaultAction) {
    throw new Error(`defaultAction is required when actions are configured: ${sourcePath}`);
  }

  return {
    id: requiredString(record, 'id', sourcePath),
    name: requiredString(record, 'name', sourcePath),
    shortName: requiredString(record, 'shortName', sourcePath),
    description: requiredString(record, 'description', sourcePath),
    packageName: requiredString(record, 'packageName', sourcePath),
    packagePath: resolveFromBase(requiredString(record, 'packagePath', sourcePath), basePath),
    urdfPath: resolveFromBase(requiredString(record, 'urdfPath', sourcePath), basePath),
    jointSpecs,
    groups,
    defaultGroup,
    toolFrames,
    defaultToolFrame,
    endEffector: normalizeEndEffector(record.endEffector, toolFrames, `${sourcePath}.endEffector`, basePath),
    presets,
    actions,
    defaultAction,
    capabilities: normalizeCapabilities(record.capabilities, `${sourcePath}.capabilities`),
    initialTarget: normalizeVector(record.initialTarget, `${sourcePath}.initialTarget`),
    camera: normalizeCamera(record.camera, `${sourcePath}.camera`),
  };
}

function normalizeJointSpecs(raw: unknown, sourcePath: string) {
  const values = asArray(raw, sourcePath);
  if (values.length === 0) {
    throw new Error(`Robot must define at least one joint: ${sourcePath}`);
  }
  const names = new Set<string>();
  return values.map((rawSpec, index): JointSpec => {
    const path = `${sourcePath}[${index}]`;
    const record = asRecord(rawSpec, path);
    const spec = {
      name: requiredString(record, 'name', path),
      label: requiredString(record, 'label', path),
      lower: requiredNumber(record, 'lower', path),
      upper: requiredNumber(record, 'upper', path),
      velocity: requiredNumber(record, 'velocity', path),
      effort: requiredNumber(record, 'effort', path),
    };
    if (names.has(spec.name)) {
      throw new Error(`Duplicate joint ${spec.name}: ${sourcePath}`);
    }
    names.add(spec.name);
    if (spec.lower >= spec.upper) {
      throw new Error(`Joint lower bound must be below upper bound: ${path}`);
    }
    if (spec.velocity <= 0) {
      throw new Error(`Joint velocity must be positive: ${path}`);
    }
    if (spec.effort <= 0) {
      throw new Error(`Joint effort must be positive: ${path}`);
    }
    return spec;
  });
}

function normalizeGroups(raw: unknown, specs: Map<string, JointSpec>, sourcePath: string) {
  const groupsRaw = asRecord(raw, sourcePath);
  const groups: Record<string, RobotGroupDefinition> = {};
  for (const [name, value] of Object.entries(groupsRaw)) {
    const record = asRecord(value, `${sourcePath}.${name}`);
    const jointNames = requiredStringArray(record, 'jointNames', `${sourcePath}.${name}`);
    if (jointNames.length === 0 || new Set(jointNames).size !== jointNames.length) {
      throw new Error(`Group ${name} must contain unique joints: ${sourcePath}`);
    }
    for (const jointName of jointNames) {
      if (!specs.has(jointName)) {
        throw new Error(`Group ${name} references unknown joint ${jointName}: ${sourcePath}`);
      }
    }
    groups[name] = { jointNames };
  }
  if (Object.keys(groups).length === 0) {
    throw new Error(`Robot config must define at least one group: ${sourcePath}`);
  }
  return groups;
}

function normalizePresets(raw: unknown, specs: Map<string, JointSpec>, sourcePath: string) {
  const presetsRaw = asRecord(raw, sourcePath);
  for (const preset of canonicalPresets) {
    if (!(preset in presetsRaw)) {
      throw new Error(`Missing canonical ${preset} preset: ${sourcePath}`);
    }
  }
  const presets: Record<string, JointValues> = {};
  for (const [name, value] of Object.entries(presetsRaw)) {
    presets[name] = normalizeJointValues(value, specs, `${sourcePath}.${name}`, true) as JointValues;
  }
  return presets;
}

function normalizeActions(raw: unknown, specs: Map<string, JointSpec>, sourcePath: string) {
  if (raw === undefined) {
    return {};
  }
  const actionsRaw = asRecord(raw, sourcePath);
  const actions: Record<string, RobotActionDefinition> = {};
  for (const [name, value] of Object.entries(actionsRaw)) {
    const path = `${sourcePath}.${name}`;
    const actionRaw = asRecord(value, path);
    const duration = requiredNumber(actionRaw, 'duration', path);
    if (duration <= 0) {
      throw new Error(`Action duration must be positive: ${path}`);
    }
    const keyframes = requiredArray(actionRaw, 'keyframes', path)
      .map((item, index) => {
        const keyframePath = `${path}.keyframes[${index}]`;
        const keyframe = asRecord(item, keyframePath);
        return {
          time: requiredNumber(keyframe, 'time', keyframePath),
          joints: normalizeJointValues(keyframe.joints, specs, `${keyframePath}.joints`, false),
        };
      })
      .sort((left, right) => left.time - right.time);
    if (keyframes.length === 0) {
      throw new Error(`Action must define at least one keyframe: ${path}`);
    }
    for (let index = 0; index < keyframes.length; index += 1) {
      const time = keyframes[index].time;
      if (time < 0 || time > duration || (index > 0 && time <= keyframes[index - 1].time)) {
        throw new Error(`Invalid keyframe time ${time}: ${path}`);
      }
    }
    actions[name] = {
      label: optionalString(actionRaw.label, `${path}.label`) ?? name,
      duration,
      loop: optionalBoolean(actionRaw.loop, `${path}.loop`),
      keyframes,
    };
  }
  return actions;
}

function normalizeJointValues(
  raw: unknown,
  specs: Map<string, JointSpec>,
  sourcePath: string,
  requireAll: boolean,
) {
  const valuesRaw = asRecord(raw, sourcePath);
  const values: Partial<JointValues> = {};
  for (const [jointName, rawValue] of Object.entries(valuesRaw)) {
    const spec = specs.get(jointName);
    if (!spec) {
      throw new Error(`Unknown joint ${jointName}: ${sourcePath}`);
    }
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw new Error(`Joint value must be finite for ${jointName}: ${sourcePath}`);
    }
    if (rawValue < spec.lower || rawValue > spec.upper) {
      throw new Error(`Joint value outside valid range for ${jointName}: ${sourcePath}`);
    }
    values[jointName] = rawValue;
  }
  if (requireAll) {
    for (const jointName of specs.keys()) {
      if (!(jointName in values)) {
        throw new Error(`Preset is missing joint ${jointName}: ${sourcePath}`);
      }
    }
  }
  return values;
}

function normalizeEndEffector(
  raw: unknown,
  toolFrames: Record<string, string>,
  sourcePath: string,
  basePath: string,
): RobotEndEffectorDefinition | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const record = asRecord(raw, sourcePath);
  const mountFrame = requiredString(record, 'mountFrame', sourcePath);
  if (!toolFrames[mountFrame]) {
    throw new Error(`Unknown end-effector mountFrame ${mountFrame}: ${sourcePath}`);
  }
  return {
    id: requiredString(record, 'id', sourcePath),
    name: requiredString(record, 'name', sourcePath),
    shortName: requiredString(record, 'shortName', sourcePath),
    packageName: requiredString(record, 'packageName', sourcePath),
    packagePath: resolveFromBase(requiredString(record, 'packagePath', sourcePath), basePath),
    urdfPath: resolveFromBase(requiredString(record, 'urdfPath', sourcePath), basePath),
    mountFrame,
    origin: normalizeTransform(record.origin, `${sourcePath}.origin`),
    tcpOffset: normalizeOptionalVector(record.tcpOffset, `${sourcePath}.tcpOffset`),
    command: normalizeEndEffectorCommand(record.command, `${sourcePath}.command`),
  };
}

function normalizeEndEffectorCommand(raw: unknown, sourcePath: string): EndEffectorCommandSpec {
  const record = asRecord(raw, sourcePath);
  const command = {
    jointName: requiredString(record, 'jointName', sourcePath),
    label: optionalString(record.label, `${sourcePath}.label`) ?? 'Grip',
    lower: requiredNumber(record, 'lower', sourcePath),
    upper: requiredNumber(record, 'upper', sourcePath),
    open: requiredNumber(record, 'open', sourcePath),
    close: requiredNumber(record, 'close', sourcePath),
    velocity: requiredNumber(record, 'velocity', sourcePath),
  };
  if (command.lower >= command.upper) {
    throw new Error(`End-effector command lower bound must be below upper bound: ${sourcePath}`);
  }
  if (command.velocity <= 0) {
    throw new Error(`End-effector command velocity must be positive: ${sourcePath}`);
  }
  if ([command.open, command.close].some(value => value < command.lower || value > command.upper)) {
    throw new Error(`End-effector open/close command must be inside its range: ${sourcePath}`);
  }
  return command;
}

function normalizeCapabilities(raw: unknown, sourcePath: string): RobotCapabilities {
  if (raw === undefined) {
    return { ...defaultCapabilities };
  }
  const record = asRecord(raw, sourcePath);
  return {
    supportsCollision: optionalBoolean(record.supportsCollision, `${sourcePath}.supportsCollision`) ?? false,
    supportsInertials: optionalBoolean(record.supportsInertials, `${sourcePath}.supportsInertials`) ?? false,
    supportsIk: optionalBoolean(record.supportsIk, `${sourcePath}.supportsIk`) ?? false,
  };
}

function normalizeTransform(raw: unknown, sourcePath: string) {
  if (raw === undefined) {
    return { position: zeroVector(), rpy: zeroVector() };
  }
  const record = asRecord(raw, sourcePath);
  return {
    position: normalizeOptionalVector(record.position, `${sourcePath}.position`),
    rpy: normalizeOptionalVector(record.rpy, `${sourcePath}.rpy`),
  };
}

function normalizeCamera(raw: unknown, sourcePath: string) {
  const record = asRecord(raw, sourcePath);
  return {
    position: normalizeVector(record.position, `${sourcePath}.position`),
    target: normalizeVector(record.target, `${sourcePath}.target`),
  };
}

function normalizeStringRecord(raw: unknown, sourcePath: string) {
  const record = asRecord(raw, sourcePath);
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Expected non-empty string: ${sourcePath}.${key}`);
      }
      return [key, value];
    }),
  ) as Record<string, string>;
}

function normalizeOptionalVector(raw: unknown, sourcePath: string) {
  return raw === undefined ? zeroVector() : normalizeVector(raw, sourcePath);
}

function normalizeVector(raw: unknown, sourcePath: string): Vector3Tuple {
  const record = asRecord(raw, sourcePath);
  return {
    x: requiredNumber(record, 'x', sourcePath),
    y: requiredNumber(record, 'y', sourcePath),
    z: requiredNumber(record, 'z', sourcePath),
  };
}

function zeroVector(): Vector3Tuple {
  return { x: 0, y: 0, z: 0 };
}

function requiredArray(record: Record<string, unknown>, key: string, sourcePath: string) {
  return asArray(record[key], `${sourcePath}.${key}`);
}

function asArray(raw: unknown, sourcePath: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Expected array: ${sourcePath}`);
  }
  return raw;
}

function requiredStringArray(record: Record<string, unknown>, key: string, sourcePath: string) {
  const raw = record[key];
  if (!Array.isArray(raw) || raw.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new Error(`Expected string array: ${sourcePath}.${key}`);
  }
  return raw as string[];
}

function requiredString(record: Record<string, unknown>, key: string, sourcePath: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected non-empty string ${sourcePath}.${key}`);
  }
  return value;
}

function optionalString(raw: unknown, sourcePath: string) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`Expected non-empty string ${sourcePath}`);
  }
  return raw;
}

function requiredNumber(record: Record<string, unknown>, key: string, sourcePath: string) {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number ${sourcePath}.${key}`);
  }
  return value;
}

function optionalBoolean(raw: unknown, sourcePath: string) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') {
    throw new Error(`Expected boolean ${sourcePath}`);
  }
  return raw;
}

function asRecord(raw: unknown, sourcePath: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Expected object: ${sourcePath}`);
  }
  return raw as Record<string, unknown>;
}
