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

test('parseiOSAdoption: double-quoted chart data, and the charts told apart by their headings, not their order', () => {
  const chart = (v: number) => JSON.stringify([{ name: 'iOS 27', value: v }, { name: 'Earlier', value: 100 - v }]).replace(/"/g, '&quot;');
  const html = `<h3>All devices</h3><div data-bar-chart="${chart(60)}"></div>
    <h3>Devices introduced in the last four years</h3><div data-bar-chart="${chart(80)}"></div>`;
  const a = parseiOSAdoption(html);
  assert.equal(a.allDevices[0].value, 60);
  assert.equal(a.recentDevices[0].value, 80);
});

test('parseiOSAdoption: any entity in double-quoted chart data is decoded (not just &quot;)', () => {
  const data = '[{&quot;name&quot;:&quot;iOS 27 &amp; later&quot;,&quot;value&quot;:80},{&quot;name&quot;:&quot;Earlier &#39;x&#x27; &lt;y&gt;&quot;,&quot;value&quot;:20}]';
  const a = parseiOSAdoption(`<h3>Devices introduced in the last four years</h3><div data-bar-chart="${data}"></div><h3>All devices</h3><div data-bar-chart="${data}"></div>`);
  assert.equal(a.recentDevices[0].name, 'iOS 27 & later');
  assert.equal(a.recentDevices[1].name, "Earlier 'x' <y>");
});

test('parseiOSAdoption: a chart whose shares don\'t add up to about 100% (fields renamed) fails', () => {
  const chart = (rows: object[]) => `data-bar-chart='${JSON.stringify(rows)}'`;
  const html = (rows: object[]) => `<h3>Devices introduced in the last four years</h3><div ${chart(rows)}></div><h3>All devices</h3><div ${chart(rows)}></div>`;
  assert.throws(() => parseiOSAdoption(html([{ name: 'iOS 27', share: 80 }, { name: 'Earlier', share: 20 }])), /add up to 100%/);
  assert.throws(() => parseiOSAdoption(html([{ name: 'iOS 27', value: 40 }, { name: 'Earlier', value: 20 }])), /add up to 100%/);
});
