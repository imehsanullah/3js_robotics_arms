import type {
  JointName,
  JointSpec,
  JointValues,
  RobotActionDefinition,
  RobotCapabilities,
  RobotCollisionMetadata,
  RobotDefinition,
  RobotGroupDefinition,
  RobotRegistry,
} from './types';

interface RobotIndexConfig {
  robots: string[];
}

const defaultCapabilities: RobotCapabilities = {
  fixedBase: true,
  supportsCollision: false,
  supportsInertials: false,
  supportsGravityTorques: false,
  supportsIk: false,
  supportsActions: false,
};

export async function loadRobotRegistry(indexPath = '/robots/index.json'): Promise<RobotRegistry> {
  const index = await fetchJson<RobotIndexConfig>(indexPath);
  if (!Array.isArray(index.robots) || index.robots.length === 0) {
    throw new Error(`Robot registry index must list at least one robot: ${indexPath}`);
  }

  const robots = await Promise.all(
    index.robots.map(async configPath => normalizeRobotDefinition(await fetchJson<unknown>(resolvePath(indexPath, configPath)), configPath)),
  );

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

function resolvePath(indexPath: string, configPath: string) {
  if (configPath.startsWith('/')) {
    return configPath;
  }
  const basePath = indexPath.slice(0, indexPath.lastIndexOf('/') + 1);
  return `${basePath}${configPath}`;
}

function normalizeRobotDefinition(raw: unknown, sourcePath: string): RobotDefinition {
  const record = asRecord(raw, sourcePath);
  const id = requiredString(record, 'id', sourcePath);
  const jointSpecs = requiredArray(record, 'jointSpecs', sourcePath).map((item, index) =>
    normalizeJointSpec(item, `${sourcePath}.jointSpecs[${index}]`),
  );
  const jointNames = new Set(jointSpecs.map(spec => spec.name));
  const rootLink = requiredString(record, 'rootLink', sourcePath);
  const toolFrames = normalizeStringRecord(record.toolFrames, `${sourcePath}.toolFrames`);
  const normalizedToolFrames = Object.keys(toolFrames).length > 0 ? toolFrames : { root: rootLink };
  const configuredDefaultToolFrame = optionalString(record.defaultToolFrame);
  const firstToolFrame = Object.keys(normalizedToolFrames)[0];
  const defaultToolFrame =
    configuredDefaultToolFrame && normalizedToolFrames[configuredDefaultToolFrame]
      ? configuredDefaultToolFrame
      : firstToolFrame;
  const groups = normalizeGroups(record.groups, jointNames, sourcePath);
  const firstGroup = Object.keys(groups)[0];
  if (!firstGroup) {
    throw new Error(`Robot config must define at least one group: ${sourcePath}`);
  }
  const configuredDefaultGroup = optionalString(record.defaultGroup);
  const defaultGroup = configuredDefaultGroup && groups[configuredDefaultGroup] ? configuredDefaultGroup : firstGroup;

  const capabilities = normalizeCapabilities(record.capabilities);
  const actions = normalizeActions(record.actions, jointNames, `${sourcePath}.actions`);

  return {
    id,
    name: requiredString(record, 'name', sourcePath),
    shortName: requiredString(record, 'shortName', sourcePath),
    description: requiredString(record, 'description', sourcePath),
    packageName: requiredString(record, 'packageName', sourcePath),
    packagePath: requiredString(record, 'packagePath', sourcePath),
    urdfPath: requiredString(record, 'urdfPath', sourcePath),
    rootLink,
    jointSpecs,
    groups,
    defaultGroup,
    toolFrames: normalizedToolFrames,
    defaultToolFrame,
    linkChain: optionalStringArray(record.linkChain, `${sourcePath}.linkChain`),
    collision: normalizeCollisionMetadata(record.collision, record.linkChain, `${sourcePath}.collision`),
    downstreamLinks: normalizeStringArrayRecord(record.downstreamLinks, `${sourcePath}.downstreamLinks`),
    presets: normalizeJointValueMaps(record.presets, jointNames, `${sourcePath}.presets`),
    actions,
    defaultAction: optionalString(record.defaultAction),
    capabilities: {
      ...capabilities,
      supportsActions: capabilities.supportsActions || Object.keys(actions).length > 0,
    },
    initialTarget: normalizeVector(record.initialTarget, `${sourcePath}.initialTarget`),
    camera: normalizeCamera(record.camera, `${sourcePath}.camera`),
  };
}

function normalizeCollisionMetadata(raw: unknown, fallbackLinkChain: unknown, sourcePath: string): RobotCollisionMetadata {
  if (raw === undefined) {
    const linkChain = optionalStringArray(fallbackLinkChain, `${sourcePath}.fallbackLinkChain`);
    return {
      adjacentLinkChains: linkChain.length > 0 ? [linkChain] : [],
      disabledPairs: [],
    };
  }

  const collisionRaw = asRecord(raw, sourcePath);
  const chainsRaw = collisionRaw.adjacentLinkChains;
  const adjacentLinkChains =
    chainsRaw === undefined
      ? []
      : requiredArray(collisionRaw, 'adjacentLinkChains', sourcePath).map((item, index) =>
          asStringArray(item, `${sourcePath}.adjacentLinkChains[${index}]`),
        );

  const disabledPairsRaw = collisionRaw.disabledPairs;
  const disabledPairs =
    disabledPairsRaw === undefined
      ? []
      : requiredArray(collisionRaw, 'disabledPairs', sourcePath).map((item, index) => {
          const pair = asStringArray(item, `${sourcePath}.disabledPairs[${index}]`);
          if (pair.length !== 2) {
            throw new Error(`Collision disabled pair must contain exactly two links: ${sourcePath}.disabledPairs[${index}]`);
          }
          return [pair[0], pair[1]] as [string, string];
        });

  return { adjacentLinkChains, disabledPairs };
}

function normalizeJointSpec(raw: unknown, sourcePath: string): JointSpec {
  const record = asRecord(raw, sourcePath);
  return {
    name: requiredString(record, 'name', sourcePath),
    label: requiredString(record, 'label', sourcePath),
    lower: requiredNumber(record, 'lower', sourcePath),
    upper: requiredNumber(record, 'upper', sourcePath),
    velocity: requiredNumber(record, 'velocity', sourcePath),
    effort: requiredNumber(record, 'effort', sourcePath),
  };
}

function normalizeGroups(raw: unknown, jointNames: Set<string>, sourcePath: string) {
  const groupsRaw = asRecord(raw, `${sourcePath}.groups`);
  const groups: Record<string, RobotGroupDefinition> = {};

  for (const [key, value] of Object.entries(groupsRaw)) {
    const groupRaw = asRecord(value, `${sourcePath}.groups.${key}`);
    const name = optionalString(groupRaw.name) ?? key;
    const groupJointNames = requiredStringArray(groupRaw, 'jointNames', `${sourcePath}.groups.${key}`);
    for (const jointName of groupJointNames) {
      if (!jointNames.has(jointName)) {
        throw new Error(`Group ${name} references unknown joint ${jointName}: ${sourcePath}`);
      }
    }
    groups[name] = {
      name,
      label: optionalString(groupRaw.label) ?? name,
      jointNames: groupJointNames,
      defaultFrame: optionalString(groupRaw.defaultFrame),
      supportsIk: optionalBoolean(groupRaw.supportsIk) ?? Boolean(groupRaw.defaultFrame),
    };
  }

  return groups;
}

function normalizeActions(raw: unknown, jointNames: Set<string>, sourcePath: string) {
  if (raw === undefined) {
    return {};
  }

  const actionsRaw = asRecord(raw, sourcePath);
  const actions: Record<string, RobotActionDefinition> = {};
  for (const [key, value] of Object.entries(actionsRaw)) {
    const actionRaw = asRecord(value, `${sourcePath}.${key}`);
    const name = optionalString(actionRaw.name) ?? key;
    const keyframes = requiredArray(actionRaw, 'keyframes', `${sourcePath}.${key}`).map((item, index) => {
      const keyframe = asRecord(item, `${sourcePath}.${key}.keyframes[${index}]`);
      return {
        time: requiredNumber(keyframe, 'time', `${sourcePath}.${key}.keyframes[${index}]`),
        joints: normalizeJointValues(keyframe.joints, jointNames, `${sourcePath}.${key}.keyframes[${index}].joints`),
      };
    });
    actions[name] = {
      name,
      label: optionalString(actionRaw.label) ?? name,
      duration: requiredNumber(actionRaw, 'duration', `${sourcePath}.${key}`),
      loop: optionalBoolean(actionRaw.loop),
      keyframes,
    };
  }
  return actions;
}

function normalizeCapabilities(raw: unknown): RobotCapabilities {
  if (raw === undefined) {
    return defaultCapabilities;
  }
  const capabilitiesRaw = asRecord(raw, 'capabilities');
  return {
    fixedBase: optionalBoolean(capabilitiesRaw.fixedBase) ?? defaultCapabilities.fixedBase,
    supportsCollision: optionalBoolean(capabilitiesRaw.supportsCollision) ?? defaultCapabilities.supportsCollision,
    supportsInertials: optionalBoolean(capabilitiesRaw.supportsInertials) ?? defaultCapabilities.supportsInertials,
    supportsGravityTorques:
      optionalBoolean(capabilitiesRaw.supportsGravityTorques) ?? defaultCapabilities.supportsGravityTorques,
    supportsIk: optionalBoolean(capabilitiesRaw.supportsIk) ?? defaultCapabilities.supportsIk,
    supportsActions: optionalBoolean(capabilitiesRaw.supportsActions) ?? defaultCapabilities.supportsActions,
  };
}

function normalizeJointValueMaps(raw: unknown, jointNames: Set<string>, sourcePath: string) {
  const mapsRaw = asRecord(raw, sourcePath);
  const maps: Record<string, JointValues> = {};
  for (const [name, value] of Object.entries(mapsRaw)) {
    maps[name] = normalizeJointValues(value, jointNames, `${sourcePath}.${name}`) as JointValues;
  }
  return maps;
}

function normalizeJointValues(raw: unknown, jointNames: Set<string>, sourcePath: string) {
  const valuesRaw = asRecord(raw, sourcePath);
  const values: Partial<JointValues> = {};
  for (const [jointName, value] of Object.entries(valuesRaw)) {
    if (!jointNames.has(jointName)) {
      throw new Error(`Unknown joint ${jointName}: ${sourcePath}`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Joint value must be finite number for ${jointName}: ${sourcePath}`);
    }
    values[jointName as JointName] = value;
  }
  return values;
}

function normalizeStringRecord(raw: unknown, sourcePath: string) {
  if (raw === undefined) {
    return {};
  }
  const record = asRecord(raw, sourcePath);
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (typeof value !== 'string') {
        throw new Error(`Expected string value for ${sourcePath}.${key}`);
      }
      return [key, value];
    }),
  ) as Record<string, string>;
}

function normalizeStringArrayRecord(raw: unknown, sourcePath: string) {
  if (raw === undefined) {
    return {};
  }
  const record = asRecord(raw, sourcePath);
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, asStringArray(value, `${sourcePath}.${key}`)]),
  ) as Record<string, string[]>;
}

function normalizeVector(raw: unknown, sourcePath: string) {
  const record = asRecord(raw, sourcePath);
  return {
    x: requiredNumber(record, 'x', sourcePath),
    y: requiredNumber(record, 'y', sourcePath),
    z: requiredNumber(record, 'z', sourcePath),
  };
}

function normalizeCamera(raw: unknown, sourcePath: string) {
  const record = asRecord(raw, sourcePath);
  return {
    position: normalizeVector(record.position, `${sourcePath}.position`),
    target: normalizeVector(record.target, `${sourcePath}.target`),
  };
}

function requiredArray(record: Record<string, unknown>, key: string, sourcePath: string) {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected array ${sourcePath}.${key}`);
  }
  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string, sourcePath: string) {
  return asStringArray(record[key], `${sourcePath}.${key}`);
}

function optionalStringArray(raw: unknown, sourcePath: string) {
  return raw === undefined ? [] : asStringArray(raw, sourcePath);
}

function asStringArray(raw: unknown, sourcePath: string) {
  if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string')) {
    throw new Error(`Expected string array: ${sourcePath}`);
  }
  return raw;
}

function requiredString(record: Record<string, unknown>, key: string, sourcePath: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected non-empty string ${sourcePath}.${key}`);
  }
  return value;
}

function optionalString(raw: unknown) {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function requiredNumber(record: Record<string, unknown>, key: string, sourcePath: string) {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number ${sourcePath}.${key}`);
  }
  return value;
}

function optionalBoolean(raw: unknown) {
  return typeof raw === 'boolean' ? raw : undefined;
}

function asRecord(raw: unknown, sourcePath: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Expected object: ${sourcePath}`);
  }
  return raw as Record<string, unknown>;
}
