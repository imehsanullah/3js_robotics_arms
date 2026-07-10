import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadRobotRegistry } from '../../src/robots/config.ts';

type JsonRecord = Record<string, any>;

async function readConfigTree() {
  const index = JSON.parse(await readFile(new URL('../../public/robots/index.json', import.meta.url), 'utf8')) as {
    robots: string[];
  };
  const configs: Record<string, JsonRecord> = {};
  for (const path of index.robots) {
    configs[path] = JSON.parse(
      await readFile(new URL(`../../public${path}`, import.meta.url), 'utf8'),
    ) as JsonRecord;
  }
  return { index, configs };
}

async function loadWith(
  index: JsonRecord,
  configs: Record<string, JsonRecord>,
  indexPath = '/robots/index.json',
  basePath = '/',
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async input => {
    const path = String(input);
    const basePrefix = basePath === '/' ? '' : basePath.replace(/\/$/, '');
    const configPath = basePrefix && path.startsWith(basePrefix) ? path.slice(basePrefix.length) : path;
    const value = path === indexPath ? index : configs[configPath];
    return {
      ok: value !== undefined,
      status: value === undefined ? 404 : 200,
      statusText: value === undefined ? 'Not Found' : 'OK',
      json: async () => structuredClone(value),
    } as Response;
  }) as typeof fetch;
  try {
    return await loadRobotRegistry(indexPath, basePath);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function firstConfig(configs: Record<string, JsonRecord>) {
  const config = Object.values(configs)[0];
  assert.ok(config);
  return config;
}

test('the checked-in registry loads every canonical robot and preset', async () => {
  const tree = await readConfigTree();
  for (const raw of Object.values(tree.configs)) {
    for (const legacyField of ['rootLink', 'linkChain', 'downstreamLinks', 'collision', 'endEffectors']) {
      assert.equal(legacyField in raw, false, `${raw.id} still defines ${legacyField}`);
    }
    assert.deepEqual(Object.keys(raw.groups), ['manipulator']);
    assert.deepEqual(Object.keys(raw.actions), ['wave_preview']);
    assert.ok(raw.endEffector);
  }
  const registry = await loadWith(tree.index, tree.configs);
  assert.deepEqual(registry.robots.map(robot => robot.id), ['ur5e', 'fr3', 'xarm7']);
  for (const robot of registry.robots) {
    assert.deepEqual(Object.keys(robot.presets), ['zero', 'ready', 'folded', 'reach']);
    assert.ok(robot.groups[robot.defaultGroup]);
    assert.ok(robot.toolFrames[robot.defaultToolFrame]);
  }
});

test('root asset URLs resolve from a deployment base path', async () => {
  const tree = await readConfigTree();
  const basePath = '/robotics_arms_web_threejs/';
  const registry = await loadWith(tree.index, tree.configs, `${basePath}robots/index.json`, basePath);
  for (const robot of registry.robots) {
    assert.ok(robot.packagePath.startsWith(basePath));
    assert.ok(robot.urdfPath.startsWith(basePath));
    assert.ok(robot.endEffector?.packagePath.startsWith(basePath));
    assert.ok(robot.endEffector?.urdfPath.startsWith(basePath));
  }
});

test('action keyframes are normalized into chronological order once', async () => {
  const tree = await readConfigTree();
  const config = firstConfig(tree.configs);
  const action = Object.values(config.actions)[0] as JsonRecord;
  action.keyframes.reverse();
  const registry = await loadWith(tree.index, tree.configs);
  const normalized = Object.values(registry.robots[0].actions)[0];
  assert.deepEqual(normalized.keyframes.map(frame => frame.time), [...normalized.keyframes.map(frame => frame.time)].sort((a, b) => a - b));
});

test('duplicate robot IDs fail fast', async () => {
  const tree = await readConfigTree();
  const paths = Object.keys(tree.configs);
  tree.configs[paths[1]].id = tree.configs[paths[0]].id;
  await assert.rejects(loadWith(tree.index, tree.configs), /duplicate robot id/i);
});

const invalidCases: Array<[string, (config: JsonRecord) => void, RegExp]> = [
  ['missing default group', config => delete config.defaultGroup, /defaultGroup/i],
  ['unknown default group', config => { config.defaultGroup = 'missing'; }, /defaultGroup|unknown group/i],
  ['missing default tool frame', config => delete config.defaultToolFrame, /defaultToolFrame/i],
  ['unknown default tool frame', config => { config.defaultToolFrame = 'missing'; }, /defaultToolFrame|unknown frame/i],
  ['unknown end-effector mount frame', config => { (config.endEffector ?? config.endEffectors[0]).mountFrame = 'missing'; }, /mountFrame|unknown frame/i],
  ['unknown default action', config => { config.defaultAction = 'missing'; }, /defaultAction|unknown action/i],
  ['missing canonical preset', config => { delete config.presets.ready; }, /ready|preset/i],
  ['unknown group joint', config => { config.groups[config.defaultGroup].jointNames[0] = 'missing'; }, /unknown joint/i],
  ['duplicate joint name', config => { config.jointSpecs[1].name = config.jointSpecs[0].name; }, /duplicate joint/i],
  ['non-finite joint bound', config => { config.jointSpecs[0].lower = Number.NaN; }, /finite/i],
  ['reversed joint range', config => { config.jointSpecs[0].lower = config.jointSpecs[0].upper; }, /range|lower|upper/i],
  ['non-positive joint velocity', config => { config.jointSpecs[0].velocity = 0; }, /velocity|positive/i],
  ['out-of-range preset', config => { config.presets.ready[config.jointSpecs[0].name] = config.jointSpecs[0].upper + 1; }, /range/i],
  ['invalid end-effector command range', config => { config.endEffector.command.lower = config.endEffector.command.upper; }, /command|lower|upper/i],
  ['invalid capability boolean', config => { config.capabilities.supportsIk = 'yes'; }, /boolean/i],
  ['non-positive action duration', config => { (Object.values(config.actions)[0] as JsonRecord).duration = 0; }, /duration|positive/i],
  ['negative keyframe time', config => { (Object.values(config.actions)[0] as JsonRecord).keyframes[0].time = -0.1; }, /keyframe|time/i],
  ['keyframe past duration', config => {
    const action = Object.values(config.actions)[0] as JsonRecord;
    action.keyframes[action.keyframes.length - 1].time = action.duration + 1;
  }, /keyframe|duration|time/i],
];

for (const [name, mutate, expected] of invalidCases) {
  test(`config validation rejects ${name}`, async () => {
    const tree = await readConfigTree();
    mutate(firstConfig(tree.configs));
    await assert.rejects(loadWith(tree.index, tree.configs), expected);
  });
}
