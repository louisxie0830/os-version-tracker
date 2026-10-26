import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latestXcodeFromEvents,
  parseMacosImageReadme,
  parseRunnerImagesReadme,
  parseXcodeCloudReleaseNotes,
} from '../src/fetchers/ci-images.js';
import { fixture, GARBAGE_HTML } from './helpers.js';

test('parseRunnerImagesReadme: lists only macOS/Xcode images with labels, arch and status', () => {
  const images = parseRunnerImagesReadme(fixture('runner-images-readme.md'));
  assert.deepEqual(images.map(i => i.readmeFile), [
    'xcode-27-arm64-Readme.md',
    'macos-26-Readme.md',
    'macos-26-arm64-Readme.md',
    'macos-15-Readme.md',
    'macos-15-arm64-Readme.md',
    'macos-14-Readme.md',
    'macos-14-arm64-Readme.md',
  ]);
  assert.deepEqual(images[2], {
    name: 'macOS 26 Arm64',
    arch: 'arm64',
    status: 'ga',
    labels: ['macos-latest', 'macos-26', 'macos-26-xlarge'],
    readmeFile: 'macos-26-arm64-Readme.md',
  });
  assert.equal(images[0].name, 'Xcode 27');
  assert.equal(images[0].status, 'preview');
  assert.deepEqual(images[1].labels, ['macos-latest-large', 'macos-26-intel', 'macos-26-large']);
  assert.equal(images[1].arch, 'x64');
  assert.equal(images[6].status, 'deprecated');
  assert.deepEqual(images[6].labels, ['macos-14', 'macos-14-xlarge']);
});

test('parseMacosImageReadme: OS, image version/date, default and installed Xcodes', () => {
  const r = parseMacosImageReadme(fixture('runner-macos-15-arm64-readme.md'));
  assert.equal(r.os, 'macOS 15.7.9 (24G830)');
  assert.equal(r.imageVersion, '20260907.0337.1');
  assert.equal(r.imageDate, '2026-09-07');
  assert.equal(r.defaultXcode, '16.4');
  assert.deepEqual(r.xcodes, ['26.3', '26.2', '26.1.1', '26.0.1', '16.4', '16.3', '16.2', '16.1', '16.0']);
  assert.deepEqual(r.xcodeDetails.find(x => x.version === '16.4'), { version: '16.4', build: '16F6', isDefault: true, isBeta: false });
  assert.equal(r.xcodeDetails.find(x => x.version === '16.2')?.build, '16C5032a');
});

test('parseMacosImageReadme: preview image flags beta Xcode', () => {
  const r = parseMacosImageReadme(fixture('runner-xcode-27-arm64-readme.md'));
  assert.equal(r.os, 'macOS 27.0.1 (26A434)');
  assert.equal(r.defaultXcode, '27.0');
  assert.deepEqual(r.xcodes, ['27.2', '27.1', '27.0']);
  assert.deepEqual(r.xcodeDetails[0], { version: '27.2', build: '27B5028f', isDefault: false, isBeta: true });
});

test('parseXcodeCloudReleaseNotes: availability and removal events, newest first', () => {
  const events = parseXcodeCloudReleaseNotes(fixture('xcode-cloud-release-notes.html'));
  assert.deepEqual(events[0], {
    date: 'December 19, 2025',
    added: ['Xcode 26.2 (17C52)', 'macOS Tahoe 26.2 (25C56)'],
    removed: [],
  });
  const removal = events.find(e => e.date === 'September 30, 2025');
  assert.ok(removal);
  assert.deepEqual(removal.added, []);
  assert.ok(removal.removed.includes('Xcode 15.4 (15F31d)'));
  assert.ok(removal.removed.includes('macOS Sonoma 14.5 (23F79)'));
  assert.ok(removal.removed.includes('macOS Tahoe 26 Beta 8 (25A5349a)'));
  assert.equal(removal.removed.length, 25);
  // The IP-egress note (February 10, 2026) mentions no versions and is skipped
  assert.ok(!events.some(e => e.date === 'February 10, 2026'));
  assert.deepEqual(events.find(e => e.date === 'June 6, 2025')?.added, ['Xcode 26 beta (17A5241e)', 'macOS Tahoe 26 beta (25A5279m)']);
  assert.equal(latestXcodeFromEvents(events), '26.2');
});

test('ci-images parsers return nothing for unrelated content', () => {
  assert.deepEqual(parseRunnerImagesReadme('# nothing\n| a | b | c | d |\n'), []);
  assert.deepEqual(parseMacosImageReadme('# empty').xcodes, []);
  assert.deepEqual(parseXcodeCloudReleaseNotes(GARBAGE_HTML), []);
  assert.equal(latestXcodeFromEvents([]), undefined);
});

test('parseMacosImageReadme: an RC named only in the install path is not a release', () => {
  const md = `# macOS 26\n- OS Version: macOS 26.1 (25B78)\n- Image Version: 20261013.1\n### Xcode\n| Version | Build | Path |\n| --- | --- | --- |\n| 27.2 | 27B48 | /Applications/Xcode_27.2_Release_Candidate.app |\n| 27.1 (default) | 27A9275 | /Applications/Xcode_27.1.app |\n| 26.4 | 17E100 | /Applications/Xcode_26.4.0.app |\n`;
  const r = parseMacosImageReadme(md);
  assert.deepEqual(r.xcodeDetails.map(x => [x.version, x.isBeta]), [['27.2', true], ['27.1', false], ['26.4', false]]);
});
