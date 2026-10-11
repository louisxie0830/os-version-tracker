import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseiOSAdoption } from '../src/fetchers/ios-adoption.js';
import { fixture, GARBAGE_HTML } from './helpers.js';

test('parseiOSAdoption: recent / all device shares and measurement date', () => {
  const adoption = parseiOSAdoption(fixture('apple-app-store-support.html'));
  assert.equal(adoption.measuredAt, 'June 7, 2026');
  assert.deepEqual(adoption.recentDevices[0], { name: 'iOS 26', value: 86 });
  assert.deepEqual(adoption.allDevices[0], { name: 'iOS 26', value: 79 });
  assert.equal(adoption.recentDevices.reduce((sum, s) => sum + s.value, 0), 100);
  assert.equal(adoption.allDevices.reduce((sum, s) => sum + s.value, 0), 100);
});

test('parseiOSAdoption throws when the charts are missing', () => {
  assert.throws(() => parseiOSAdoption(GARBAGE_HTML), /charts not found/);
  // Only one iOS chart left (e.g. iPadOS-only page)
  assert.throws(() => parseiOSAdoption(`<div data-bar-chart='[{"name":"iOS 26","value":90}]'></div>`), /charts not found/);
});
