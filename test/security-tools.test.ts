import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { readPart } from '../src/asset-versions.ts';

const ctx = createContext({});
runInContext(readPart('security-tools.js').toString(), ctx);
const tools = runInContext('SecurityTools', ctx) as {
  packages(raw: unknown): Array<{name: string; version: string; ecosystem: string}>;
  range(version: string, expression?: string): boolean | null;
  osv(raw: unknown): Map<string, unknown[]>;
  assess(packages: unknown[], advisories: unknown[], scan: unknown): Array<{result: string; detail: string}>;
  workspace(raw: unknown): {cases: unknown[]; verifications: unknown[]; patches: unknown[]}; fresh(): unknown;
};
const plain = (raw: unknown) => JSON.parse(JSON.stringify(raw));

test('local inventory resolves npm nested versions, CycloneDX, SPDX and Swift with ecosystem identity', () => {
  assert.deepEqual(plain(tools.packages({ lockfileVersion: 3, packages: { '': {name:'root'}, 'node_modules/a': {version:'1.2.3'}, 'node_modules/a/node_modules/@scope/b': {version:'2.0.0'}, 'node_modules/unresolved': {link:true} } })), [
    {name:'a',version:'1.2.3',ecosystem:'npm'}, {name:'@scope/b',version:'2.0.0',ecosystem:'npm'},
  ]);
  assert.equal(tools.packages({lockfileVersion:1,dependencies:{a:{version:'1.0.0',dependencies:{b:{version:'2.0.0'}}}}}).length,2);
  assert.equal(tools.packages({bomFormat:'CycloneDX',components:[{purl:'pkg:maven/com.example/a@1.2.3',version:'1.2.3'}]})[0].name,'com.example:a');
  assert.equal(tools.packages({spdxVersion:'SPDX-2.3',packages:[{name:'fallback',versionInfo:'2.0.0',externalRefs:[{referenceType:'purl',referenceLocator:'pkg:npm/%40scope/a@2.0.0'}]}]})[0].name,'@scope/a');
  assert.equal(tools.packages({pins:[{location:'https://github.com/example/repo.git',state:{version:'1.0.0'}}]})[0].name,'github.com/example/repo');
  assert.throws(()=>tools.packages({dependencies:{a:'^1.0.0'}}),/沒有可辨識/);
});

test('local matching never turns unsupported ranges or a missing announcement into a clean result', () => {
  assert.equal(tools.range('1.2.0','>= 1.0.0, < 2.0.0'),true);
  assert.equal(tools.range('2.0.0','< 2.0.0'),false);
  assert.equal(tools.range('1.2.0','~1.0.0'),null);
  assert.equal(tools.range('1.2.0-beta','< 2.0.0'),null);
  const p=[{name:'a',version:'1.2.0',ecosystem:'npm'}];
  assert.equal(tools.assess(p,[],new Map())[0].result,'仍待完整掃描');
  const a={id:'GHSA-a',summary:'',ecosystems:{a:'npm'},ranges:[{package:'a',vulnerable:'< 2.0.0',patched:'2.0.0'}]};
  assert.equal(tools.assess(p,[a],new Map())[0].result,'命中已知公告範圍');
  assert.equal(tools.assess(p,[{...a,ranges:[{package:'a',vulnerable:'^1.0.0'}]}],new Map())[0].result,'版本範圍待確認');
  assert.equal(tools.assess([{...p[0],ecosystem:'Pub'}],[a],new Map())[0].result,'仍待完整掃描');
});

test('imported OSV results apply to exactly the scanned ecosystem, package and version, never a newer release', () => {
  const scan=tools.osv({results:[{packages:[{package:{name:'a',version:'1.0.0',ecosystem:'npm'},vulnerabilities:[{id:'OSV-a',affected:[{package:{name:'a',ecosystem:'npm'},ranges:[{events:[{introduced:'0'},{fixed:'1.1.0'}]}]}]}]},{package:{name:'b',version:'1.0.0',ecosystem:'npm'},vulnerabilities:[]}]}]});
  const results=tools.assess([{name:'a',version:'1.0.0',ecosystem:'npm'},{name:'a',version:'2.0.0',ecosystem:'npm'},{name:'b',version:'1.0.0',ecosystem:'npm'}],[],scan);
  assert.equal(results[0].result,'掃描回報受影響');assert.match(results[0].detail,/1.1.0/);
  assert.equal(results[1].result,'仍待完整掃描');assert.equal(results[2].result,'該次掃描未回報漏洞');
  assert.throws(()=>tools.osv({}),/OSV-Scanner/);
});

test('local workspace imports reject unsupported schema and cannot import a passed test without evidence', () => {
  assert.throws(()=>tools.workspace({}),/格式/);
  const raw={schema:1,cases:[{subject:'case',title:'Title',status:'verified',evidence:'report.pdf',note:'',at:'2026-11-22T00:00:00Z'}],verifications:[{target:'App v1',control:'MASVS-AUTH',test:'Test',result:'pass',testedAt:'2026-11-22',evidence:'',reviewer:'',note:'',at:'2026-11-22T00:00:00Z'}],patches:[]};
  const checked=tools.workspace(raw);assert.equal(checked.cases.length,1);assert.equal(checked.verifications.length,0);
  assert.deepEqual(plain(tools.fresh()),{schema:1,cases:[],verifications:[],patches:[]});
});
