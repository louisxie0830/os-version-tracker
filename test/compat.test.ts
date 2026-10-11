import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgpRequirements,
  parseAgpTables,
  parseKotlinCompat,
  parseXcodeSupport,
} from '../src/fetchers/compat.js';
import { fixture, GARBAGE_HTML } from './helpers.js';

test('parseAgpTables: AGP → minimum Gradle', () => {
  const { agpGradle } = parseAgpTables(fixture('agp-about.html'));
  assert.deepEqual(agpGradle[0], { agp: '9.4', minGradle: '9.6.0' });
  assert.deepEqual(agpGradle.find(r => r.agp === '9.0'), { agp: '9.0', minGradle: '9.1.0' });
  assert.deepEqual(agpGradle.find(r => r.agp === '8.13'), { agp: '8.13', minGradle: '8.13' });
  assert.ok(agpGradle.length >= 15);
});

test('parseAgpTables: Android Studio → AGP range, continuing into the header-less table', () => {
  const { studioAgp } = parseAgpTables(fixture('agp-about.html'));
  assert.deepEqual(studioAgp[0], { studio: 'Rabbit 1 · 2026.2.1', agp: ['7.1', '9.4'] });
  assert.deepEqual(studioAgp.find(r => r.studio.startsWith('Panda 1')), { studio: 'Panda 1 · 2025.3.1', agp: ['7.0', '9.0'] });
  assert.ok(studioAgp.some(r => r.studio.startsWith('Meerkat')));
});

test('parseAgpTables: API level table', () => {
  const { apiLevels } = parseAgpTables(fixture('agp-about.html'));
  assert.ok(apiLevels.length > 0);
  for (const row of apiLevels) {
    assert.match(row.api, /^\d+(\.\d+)?$/);
    assert.ok(row.minStudio && row.minAgp);
  }
});

test('parseAgpRequirements: current AGP release requirements', () => {
  assert.deepEqual(parseAgpRequirements(fixture('agp-gradle-plugin.html')), {
    agp: '9.4',
    maxApi: '37',
    minGradle: '9.6.0',
    minBuildTools: '36.0.0',
    jdk: '17',
  });
});

test('parseKotlinCompat: KGP → Gradle / AGP ranges', () => {
  const kotlin = parseKotlinCompat(fixture('kotlin-gradle-compat.html'));
  assert.deepEqual(kotlin[0], { kotlin: '2.4.20–2.4.21', gradle: ['7.6.3', '9.7.0'], agp: ['8.5.2', '9.3.1'] });
  assert.deepEqual(kotlin.find(r => r.kotlin === '2.0.0'), { kotlin: '2.0.0', gradle: ['6.8.3', '8.5'], agp: ['7.1.3', '8.3.1'] });
});

test('parseXcodeSupport: Xcode → SDK, deployment targets, Swift', () => {
  const rows = parseXcodeSupport(fixture('xcode-support.html'));
  assert.deepEqual(rows.find(r => r.xcode === '27.1 RC'), {
    xcode: '27.1 RC',
    macOS: 'macOS Tahoe 26.6 or later',
    iosSdk: '27.1',
    deploymentiOS: '15–27',
    deviceiOS: '17 or later',
    simulatoriOS: '17 or later',
    swift: '6.4',
  });
  const x266 = rows.find(r => r.xcode === '26.6');
  assert.equal(x266?.iosSdk, '26.5');
  assert.equal(x266?.deploymentiOS, '15–26.5');
  assert.equal(x266?.swift, '6.3');
});

test('compat parsers throw on an unrecognised page layout', () => {
  assert.throws(() => parseAgpTables(GARBAGE_HTML), /AGP compatibility tables/);
  assert.throws(() => parseAgpRequirements(GARBAGE_HTML), /AGP current requirements/);
  assert.throws(() => parseKotlinCompat(GARBAGE_HTML), /Kotlin Gradle plugin/);
  assert.throws(() => parseXcodeSupport(GARBAGE_HTML), /Xcode support table/);
  assert.throws(() => parseAgpTables(''));
});

test('compat parsers throw when the table header survives but rows are unreadable', () => {
  const headerOnly = (cols: string[]) =>
    `<table><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr><tr><td colspan="3">See below</td></tr></table>`;
  assert.throws(() => parseKotlinCompat(headerOnly(['KGP version', 'Gradle min and max versions', 'AGP min and max versions'])), /parsed empty/);
  assert.throws(
    () => parseAgpTables(headerOnly(['Plugin version', 'Minimum required Gradle version']) + headerOnly(['Android Studio version', 'Required AGP version'])),
    /parsed empty/,
  );
  assert.throws(() => parseXcodeSupport(headerOnly(['Xcode', 'Requirements', 'SDKs', 'Deployment Targets'])), /without any iOS SDK/);
});
