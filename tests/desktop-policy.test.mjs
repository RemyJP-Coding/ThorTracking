import assert from 'node:assert/strict';
import test from 'node:test';
import { isAppUrl, isDevelopmentLaunch, isExternalUrl, restoreWindowState } from '../desktop/policy.mjs';

test('desktop diagnostics require the exact explicit dev switch', () => {
  assert.equal(isDevelopmentLaunch(['Thor Track.exe']), false);
  assert.equal(isDevelopmentLaunch(['Thor Track.exe', '--development', '--dev=false']), false);
  assert.equal(isDevelopmentLaunch(['Thor Track.exe', '--dev']), true);
});

test('desktop navigation confines the app and external links to their intended destinations', () => {
  assert.equal(isAppUrl('thor-track://app/api/shipments'), true);
  for (const url of ['https://app/', 'thor-track://evil/', 'thor-track://app.evil/', 'thor-track://user@app/', 'file:///C:/secret']) {
    assert.equal(isAppUrl(url), false, url);
  }
  assert.equal(isExternalUrl('https://www.ayntec.com/pages/shipment-dashboard'), true);
  for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'http://www.ayntec.com/', 'https://www.ayntec.com.evil/', 'https://user@www.ayntec.com/']) {
    assert.equal(isExternalUrl(url), false, url);
  }
});

test('desktop window recovers from a removed monitor and invalid saved bounds', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  assert.deepEqual(restoreWindowState({ x: 2400, y: 0, width: 1180, height: 820 }, areas), { width: 1180, height: 820 });
  assert.deepEqual(restoreWindowState({ x: 'bad', y: 0, width: 1180, height: 820 }, areas), { width: 1180, height: 820 });
  assert.deepEqual(restoreWindowState({ x: 100, y: 80, width: 1000, height: 720 }, areas), { x: 100, y: 80, width: 1000, height: 720 });
  assert.deepEqual(restoreWindowState({ x: 1800, y: 1000, width: 640, height: 480 }, areas), { x: 1280, y: 600, width: 640, height: 480 });
});
