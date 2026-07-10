import { expect, test, type Page } from 'playwright/test';
import { createHash } from 'node:crypto';

const robots = [
  { id: 'ur5e', controls: 6 },
  { id: 'fr3', controls: 7 },
  { id: 'xarm7', controls: 7 },
];

async function waitForRobot(page: Page, id: string) {
  await page.selectOption('#robot-selector', id);
  await expect(page.locator('#robot-ready')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.locator('#asset-state')).toContainText('loaded');
}

async function canvasDimensions(page: Page) {
  return page.locator('#scene').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    return {
      cssWidth: rect.width,
      cssHeight: rect.height,
      width: canvas.width,
      height: canvas.height,
      dpr: Math.min(devicePixelRatio, 2),
      imageLength: canvas.toDataURL().length,
    };
  });
}

async function canvasFingerprint(page: Page) {
  const screenshot = await page.locator('#scene').screenshot();
  return createHash('sha256').update(screenshot).digest('hex');
}

async function dragCartesianTarget(page: Page) {
  const projection = await page.evaluate(async () => {
    const id = (document.querySelector('#robot-selector') as HTMLSelectElement).value;
    const indexUrl = new URL('robots/index.json', document.baseURI);
    const index = await fetch(indexUrl).then(response => response.json()) as { robots: string[] };
    const definitions = await Promise.all(index.robots.map(path => {
      const configUrl = path.startsWith('/') ? new URL(path.slice(1), document.baseURI) : new URL(path, indexUrl);
      return fetch(configUrl).then(response => response.json());
    }));
    const robot = definitions.find(definition => definition.id === id)!;
    const rect = document.querySelector('#scene')!.getBoundingClientRect();
    return { camera: robot.camera, point: robot.initialTarget, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  });
  const subtract = (a: any, b: any) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a: any, b: any) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a: any, b: any) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const normalize = (value: any) => {
    const length = Math.sqrt(dot(value, value));
    return { x: value.x / length, y: value.y / length, z: value.z / length };
  };
  const forward = normalize(subtract(projection.camera.target, projection.camera.position));
  const right = normalize(cross(forward, { x: 0, y: 0, z: 1 }));
  const up = cross(right, forward);
  const relative = subtract(projection.point, projection.camera.position);
  const depth = dot(relative, forward);
  const tangent = Math.tan((45 * Math.PI / 180) / 2);
  const ndcX = dot(relative, right) / (depth * tangent * (projection.rect.width / projection.rect.height));
  const ndcY = dot(relative, up) / (depth * tangent);
  const x = projection.rect.x + (ndcX + 1) * projection.rect.width / 2;
  const y = projection.rect.y + (1 - ndcY) * projection.rect.height / 2;
  const before = await page.locator('#target-controls input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 42, y, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator('#target-controls input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
  expect(after).not.toEqual(before);
}

async function expectedMountedMass(page: Page) {
  return page.evaluate(async () => {
    const id = (document.querySelector('#robot-selector') as HTMLSelectElement).value;
    const indexUrl = new URL('robots/index.json', document.baseURI);
    const index = await fetch(indexUrl).then(response => response.json()) as { robots: string[] };
    const definitions = await Promise.all(index.robots.map(path => {
      const configUrl = path.startsWith('/') ? new URL(path.slice(1), document.baseURI) : new URL(path, indexUrl);
      return fetch(configUrl).then(response => response.json());
    }));
    const robot = definitions.find(definition => definition.id === id)!;
    const paths = [robot.urdfPath, robot.endEffector?.urdfPath].filter(Boolean) as string[];
    const documents = await Promise.all(paths.map(path => {
      const assetUrl = path.startsWith('/') ? new URL(path.slice(1), document.baseURI) : new URL(path, document.baseURI);
      return fetch(assetUrl).then(response => response.text());
    }));
    return documents.reduce((total, xml) => {
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      return total + [...document.querySelectorAll('inertial > mass')]
        .reduce((sum, mass) => sum + Number(mass.getAttribute('value')), 0);
    }, 0);
  });
}

test('all robots load and preserve the primary workbench workflows', async ({ page }) => {
  const consoleErrors: string[] = [];
  const deprecatedWarnings: string[] = [];
  const failedAssets: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning' && /THREE\.Clock|PCFSoftShadowMap|deprecated/i.test(message.text())) {
      deprecatedWarnings.push(message.text());
    }
  });
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && /\.(?:urdf|dae|stl|obj|json)(?:\?|$)/i.test(response.url())) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto('.');
  await expect(page.locator('#robot-selector option')).toHaveCount(3);
  expect(await page.locator('#robot-selector option').evaluateAll(options => options.map(option => option.value))).toEqual(
    robots.map(robot => robot.id),
  );
  await expect(page.locator('.joint-panel h2')).toHaveText(['Gripper']);
  await expect(page.locator('.physics-panel h2')).toHaveText(['Robot State', 'Target', 'Move Group', 'Scene']);
  await expect(page.locator('#torque-readout, #collision-readout, #asset-description')).toHaveCount(0);

  for (const robot of robots) {
    await waitForRobot(page, robot.id);
    await expect(page.locator('#joint-controls .joint-row')).toHaveCount(robot.controls);
    await expect(page.locator('#mass-output')).not.toHaveText('-- kg');
    const displayedMass = Number((await page.locator('#mass-output').textContent())!.replace(' kg', ''));
    expect(Math.abs(displayedMass - await expectedMountedMass(page))).toBeLessThan(0.002);
    await expect(page.locator('#pose-hud')).not.toContainText('unavailable');

    const before = await canvasDimensions(page);
    expect(before.cssWidth).toBeGreaterThan(100);
    expect(before.cssHeight).toBeGreaterThan(100);
    expect(before.width).toBe(Math.round(before.cssWidth * before.dpr));
    expect(before.height).toBe(Math.round(before.cssHeight * before.dpr));
    expect(before.imageLength).toBeGreaterThan(1_000);

    const namedResults = await page.evaluate(async () => {
      const group = window.robotMoveGroup!;
      const ready = await group.setNamedTarget('ready').go({ avoidCollisions: true, speedScale: 5 });
      const reach = await group.setNamedTarget('reach').go({ avoidCollisions: true, speedScale: 5 });
      return [ready.status, reach.status];
    });
    expect(namedResults).toEqual(['done', 'done']);

    await page.evaluate(async () => {
      await window.robotMoveGroup!.setNamedTarget('ready').go({ avoidCollisions: true, speedScale: 5 });
    });

    const ikPlan = await page.evaluate(async () => {
      const values = [...document.querySelectorAll<HTMLInputElement>('#target-controls input')].map(input => Number(input.value));
      return window.robotMoveGroup!
        .setPoseTarget({ position: { x: values[0], y: values[1], z: values[2] } })
        .plan({ avoidCollisions: false });
    });
    expect(ikPlan.success, ikPlan.warnings.join('\n')).toBe(true);

    await page.locator('#collision-toggle').uncheck();
    await page.locator('#collision-toggle').check();
    await page.locator('#com-toggle').check();
    await page.locator('#frames-toggle').uncheck();
    await page.locator('#frames-toggle').check();
    if (robot.id === 'ur5e') await dragCartesianTarget(page);

    const initialGripperState = await page.locator('#gripper-state').textContent();
    const openFingerprint = await canvasFingerprint(page);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#gripper-state')).not.toHaveText(initialGripperState ?? '');
    await page.waitForTimeout(300);
    expect(await canvasFingerprint(page)).not.toBe(openFingerprint);
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    const opening = await page.evaluate(async () => {
      window.gripper!.set(0.4);
      await new Promise(resolve => setTimeout(resolve, 100));
      const setValue = window.gripper!.get();
      window.gripper!.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      const closed = window.gripper!.getOpening();
      window.gripper!.open();
      await new Promise(resolve => setTimeout(resolve, 100));
      return { setValue, closed, open: window.gripper!.getOpening() };
    });
    expect(opening.setValue).toBeGreaterThan(0);
    expect(opening.closed).not.toBe(opening.open);

    await page.locator('#play-button').click();
    await expect(page.locator('#motion-state')).not.toHaveText('Manual');
    await page.locator('#move-stop-button').click();
    await expect(page.locator('#move-group-state')).toContainText(/stopped/i);
  }

  expect(failedAssets).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(deprecatedWarnings).toEqual([]);
});

test('idle readouts are stable and the desktop workbench stays in the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('.');
  await expect(page.locator('#robot-ready')).toHaveText('Ready', { timeout: 60_000 });

  const result = await page.evaluate(async () => {
    performance.clearMarks('robot-workbench:physics-update');
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(document.querySelector('.metrics-grid')!, { childList: true, subtree: true, characterData: true });
    observer.observe(document.querySelector('#pose-hud')!, { childList: true, subtree: true, characterData: true });
    await new Promise(resolve => setTimeout(resolve, 750));
    observer.disconnect();
    return {
      mutations,
      physicsUpdates: performance.getEntriesByName('robot-workbench:physics-update').length,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    };
  });
  expect(result.mutations).toBe(0);
  expect(result.physicsUpdates).toBe(0);
  expect(result.scrollHeight).toBeLessThanOrEqual(result.viewportHeight);

  await page.evaluate(() => performance.clearMarks('robot-workbench:physics-update'));
  await page.locator('#play-button').click();
  await page.waitForTimeout(1_200);
  await page.locator('#move-stop-button').click();
  const movingUpdates = await page.evaluate(() =>
    performance.getEntriesByName('robot-workbench:physics-update').map(entry => entry.startTime),
  );
  expect(movingUpdates.length).toBeGreaterThan(0);
  for (let index = 1; index < movingUpdates.length; index += 1) {
    expect(movingUpdates[index] - movingUpdates[index - 1]).toBeGreaterThanOrEqual(90);
  }
});

test('mobile layout has natural vertical scrolling without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('.');
  await expect(page.locator('#robot-ready')).toHaveText('Ready', { timeout: 60_000 });
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
});

test('documented browser API examples execute with their stated semantics', async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#robot-ready')).toHaveText('Ready', { timeout: 60_000 });
  const result = await page.evaluate(async () => {
    const arm = window.robotMoveGroup!;
    const sameArm = window.moveIt!.group('manipulator');
    const groups = window.moveIt!.getGroupNames();
    const targets = window.moveIt!.getNamedTargets();

    arm.setNamedTarget('ready');
    const current = arm.getCurrentJointValues();
    const jointResult = await arm.setJointValueTarget({ ...current }).go({ avoidCollisions: false, speedScale: 5 });
    arm.setJointTarget({ ...current });

    const pose = arm.getCurrentPose()!;
    const posePlan = await arm.setPoseTarget({
      position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    }).plan({ avoidCollisions: false });
    arm.clearPoseTargets();

    const plan = await arm.setNamedTarget('reach').plan({
      avoidCollisions: true,
      maxVelocityScalingFactor: 0.7,
      stepsPerSecond: 60,
    });
    const execution = await arm.execute(plan, { speedScale: 5 });
    const combined = await arm.setNamedTarget('ready').go({ avoidCollisions: true, speedScale: 5 });
    arm.stop();

    window.gripper!.set(0.4);
    await new Promise(resolve => setTimeout(resolve, 100));
    const gripperCommand = window.gripper!.get();
    const opening = window.gripper!.getOpening();
    window.gripper!.close();
    window.gripper!.open();

    return {
      sameArm: sameArm === arm,
      groups,
      targets,
      jointStatus: jointResult.status,
      poseSuccess: posePlan.success,
      planSuccess: plan.success,
      executionStatus: execution.status,
      combinedStatus: combined.status,
      gripperCommand,
      opening,
    };
  });
  expect(result).toMatchObject({
    sameArm: true,
    groups: ['manipulator'],
    targets: ['zero', 'ready', 'folded', 'reach'],
    jointStatus: 'done',
    poseSuccess: true,
    planSuccess: true,
    executionStatus: 'done',
    combinedStatus: 'done',
  });
  expect(result.gripperCommand).not.toBeNull();
  expect(result.opening).toBeGreaterThan(0);
});
