// Shared by the security center's controls; no network, file-system access, or package code execution.
interface SecurityPackage { name: string; version: string; ecosystem: string }
interface SecurityAdvisory {
  id: string; cve?: string; summary: string; ecosystems?: Record<string, string>;
  ranges: Array<{ package: string; vulnerable?: string; patched?: string }>;
}
interface SecurityPackageResult { name: string; version: string; ecosystem: string; result: string; detail: string }
interface SecurityCaseRecord { subject: string; title: string; status: string; evidence: string; note: string; at: string; bank?: string; service?: string; occurredAt?: string; recoveredAt?: string }
interface SecurityVerification { target: string; control: string; test: string; result: string; testedAt: string; evidence: string; reviewer: string; note: string; at: string }
interface SecurityPatchRecord { system: string; published: string; mainline: string; kernel: string; at: string }
interface SecurityWorkspace { schema: 1; cases: SecurityCaseRecord[]; verifications: SecurityVerification[]; patches: SecurityPatchRecord[] }

const SecurityTools = (() => {
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = (value: unknown, limit = 1000): string => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const ecosystem = (value: unknown): string => ({ npm: 'npm', maven: 'Maven', pub: 'Pub', swift: 'SwiftURL', swifturl: 'SwiftURL', cocoapods: 'CocoaPods' }[text(value).toLowerCase()] ?? text(value));
  const packageKey = (p: SecurityPackage): string => `${p.ecosystem}|${p.name}|${p.version}`;
  const purl = (value: unknown): Partial<SecurityPackage> => {
    if (typeof value !== 'string') return {};
    const match = value.match(/^pkg:([^/]+)\/(.+?)(?:@([^?#]+))?(?:[?#].*)?$/);
    if (!match) return {};
    try {
      const type = match[1], name = decodeURIComponent(match[2]);
      return { ecosystem: ecosystem(type), name: type === 'maven' ? name.replace(/\/([^/]+)$/, ':$1') : name,
        version: match[3] ? decodeURIComponent(match[3]) : undefined };
    } catch { return {}; }
  };
  function packages(raw: unknown): SecurityPackage[] {
    const out: SecurityPackage[] = [];
    const add = (name: unknown, version: unknown, eco: unknown) => {
      if (typeof name !== 'string' || typeof version !== 'string' || !name.trim() || !version.trim()) return;
      out.push({ name: text(name, 300), version: text(version, 150), ecosystem: ecosystem(eco) || '未識別' });
      if (out.length > 10000) throw new Error('套件數超過 10,000，請縮小檔案範圍。');
    };
    const walkDependencies = (deps: unknown, depth = 0): void => {
      if (!record(deps)) return;
      if (depth > 50) throw new Error('套件巢狀層數過深。');
      for (const [name, entry] of Object.entries(deps)) if (record(entry)) { add(name, entry.version, 'npm'); walkDependencies(entry.dependencies, depth + 1); }
    };
    const walkComponents = (values: unknown, depth = 0): void => {
      if (!Array.isArray(values)) return;
      if (depth > 50) throw new Error('SBOM 巢狀層數過深。');
      for (const item of values) if (record(item)) {
        const parsed = purl(item.purl);
        add(parsed.name ?? item.name, item.version ?? parsed.version, parsed.ecosystem);
        walkComponents(item.components, depth + 1);
      }
    };
    if (Array.isArray(raw)) for (const item of raw) { if (record(item)) add(item.name, item.version, item.ecosystem); }
    else if (record(raw)) {
      if (raw.bomFormat === 'CycloneDX') walkComponents(raw.components);
      else if (typeof raw.spdxVersion === 'string' && Array.isArray(raw.packages)) {
        for (const entry of raw.packages) if (record(entry)) {
          const refs = Array.isArray(entry.externalRefs) ? entry.externalRefs : [];
          const ref = refs.find(v => record(v) && /(?:^|\/)purl$/.test(text(v.referenceType)));
          const parsed = purl(record(ref) ? ref.referenceLocator : undefined);
          add(parsed.name ?? entry.name, entry.versionInfo ?? parsed.version, parsed.ecosystem);
        }
      } else if (typeof raw.lockfileVersion === 'number' && record(raw.packages)) {
        for (const [location, entry] of Object.entries(raw.packages)) if (location && record(entry)) {
          const name = entry.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
          add(name, entry.version, 'npm');
        }
      } else if (typeof raw.lockfileVersion === 'number' && record(raw.dependencies)) walkDependencies(raw.dependencies);
      else {
        const pins = Array.isArray(raw.pins) ? raw.pins : record(raw.object) && Array.isArray(raw.object.pins) ? raw.object.pins : null;
        if (pins) for (const pin of pins) if (record(pin) && record(pin.state)) {
          const location = text(pin.location ?? pin.repositoryURL).replace(/^https?:\/\//, '').replace(/\.git$/, '');
          add(location || (pin.identity ?? pin.package), pin.state.version, 'SwiftURL');
        }
      }
    }
    if (!out.length) throw new Error('沒有可辨識的套件與鎖定版本。請使用 npm 鎖定檔、CycloneDX／SPDX JSON 或 Package.resolved。');
    return [...new Map(out.map(p => [packageKey(p), p])).values()];
  }
  const compare = (a: string, b: string): number => {
    const av = a.replace(/^v/, '').split('.').map(Number), bv = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) { const n = (av[i] ?? 0) - (bv[i] ?? 0); if (n) return n; }
    return 0;
  };
  function range(version: string, expression: string | undefined): boolean | null {
    if (!/^v?\d+(?:\.\d+)*$/.test(version) || !expression) return null;
    const alternatives = expression.split('||').map(group => {
      const parts = group.split(',').map(v => v.trim()).filter(Boolean);
      if (!parts.length) return null;
      const checks = parts.map(part => {
        const m = part.match(/^(<=|>=|<|>|=)?\s*v?(\d+(?:\.\d+)*)$/);
        if (!m) return null;
        const n = compare(version, m[2]);
        return m[1] === '<' ? n < 0 : m[1] === '<=' ? n <= 0 : m[1] === '>' ? n > 0 : m[1] === '>=' ? n >= 0 : n === 0;
      });
      return checks.includes(false) ? false : checks.includes(null) ? null : true;
    });
    return alternatives.includes(true) ? true : alternatives.includes(null) ? null : false;
  }
  function osv(raw: unknown): Map<string, Array<{ id: string; fixed: string }>> {
    if (!record(raw) || !Array.isArray(raw.results)) throw new Error('請匯入 OSV-Scanner 的 JSON 結果（需包含 results）。');
    const out = new Map<string, Array<{ id: string; fixed: string }>>();
    for (const result of raw.results) if (record(result) && Array.isArray(result.packages)) for (const entry of result.packages) {
      if (!record(entry) || !record(entry.package) || !Array.isArray(entry.vulnerabilities)) continue;
      const pkg = entry.package;
      if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string' || typeof pkg.ecosystem !== 'string') continue;
      const key = packageKey({ name: pkg.name, version: pkg.version, ecosystem: ecosystem(pkg.ecosystem) });
      const hits: Array<{ id: string; fixed: string }> = [];
      for (const vuln of entry.vulnerabilities) if (record(vuln) && typeof vuln.id === 'string' && !vuln.withdrawn) {
        const fixes: string[] = [];
        if (Array.isArray(vuln.affected)) for (const a of vuln.affected) if (record(a) && record(a.package)
          && a.package.name === pkg.name && ecosystem(a.package.ecosystem) === ecosystem(pkg.ecosystem) && Array.isArray(a.ranges)) {
          for (const r of a.ranges) if (record(r) && Array.isArray(r.events)) for (const e of r.events) if (record(e) && typeof e.fixed === 'string') fixes.push(text(e.fixed, 150));
        }
        hits.push({ id: text(vuln.id, 150), fixed: [...new Set(fixes)].join('、') || '未提供修補界線' });
      }
      out.set(key, [...(out.get(key) ?? []), ...hits]);
    }
    return out;
  }
  function assess(items: SecurityPackage[], advisories: SecurityAdvisory[], scan: ReturnType<typeof osv>): SecurityPackageResult[] {
    return items.map(p => {
      const imported = scan.get(packageKey(p));
      if (imported?.length) return { ...p, result: '掃描回報受影響', detail: imported.map(v => `${v.id} · 修補界線 ${v.fixed}（依適用分支）`).join('；') };
      const matches = advisories.flatMap(a => (a.ranges ?? []).filter(r => r.package === p.name
        && ecosystem(a.ecosystems?.[r.package] ?? (p.name.startsWith('github.com/') ? 'SwiftURL' : p.name.includes(':') ? 'Maven' : ['dio', 'webview_flutter', 'flutter_inappwebview', 'firebase_core'].includes(p.name) ? 'Pub' : 'npm')) === p.ecosystem)
        .map(r => ({ id: a.id, status: range(p.version, r.vulnerable), patched: r.patched, expression: r.vulnerable })));
      const hit = matches.filter(m => m.status === true), unknown = matches.filter(m => m.status === null);
      if (hit.length) return { ...p, result: '命中已知公告範圍', detail: hit.map(h => `${h.id} · ${h.expression} · 修補 ${h.patched ?? '待確認'}`).join('；') };
      if (unknown.length) return { ...p, result: '版本範圍待確認', detail: unknown.map(h => `${h.id} · ${h.expression ?? '範圍未提供'}`).join('；') };
      return { ...p, result: imported ? '該次掃描未回報漏洞' : '仍待完整掃描', detail: imported ? '僅限匯入結果、該套件與版本；不代表沒有未知漏洞。' : '未命中本站有限公告；需以完整且最新的漏洞資料另行掃描。' };
    });
  }
  const fresh = (): SecurityWorkspace => ({ schema: 1, cases: [], verifications: [], patches: [] });
  function workspace(raw: unknown): SecurityWorkspace {
    if (!record(raw) || raw.schema !== 1 || !Array.isArray(raw.cases) || !Array.isArray(raw.verifications) || !Array.isArray(raw.patches)) throw new Error('個人紀錄格式不正確。');
    const fields = (row: unknown, keys: string[]): Record<string, string> | null => record(row) && keys.every(k => typeof row[k] === 'string') ? Object.fromEntries(keys.map(k => [k, text(row[k])])) : null;
    const out = fresh();
    for (const value of raw.cases.slice(-500)) {
      const v = fields(value, ['subject', 'title', 'status', 'evidence', 'note', 'at']);
      if (v && ['pending', 'working', 'mitigated', 'fixed', 'verified', 'not-applicable'].includes(v.status) && v.subject && v.evidence && !Number.isNaN(Date.parse(v.at))) {
        const extra = record(value) ? Object.fromEntries(['bank', 'service', 'occurredAt', 'recoveredAt'].map(key => [key, text(value[key], 300)])) : {};
        out.cases.push({ ...v, ...extra } as unknown as SecurityCaseRecord);
      }
    }
    for (const value of raw.verifications.slice(-500)) {
      const v = fields(value, ['target', 'control', 'test', 'result', 'testedAt', 'evidence', 'reviewer', 'note', 'at']);
      if (v && /^MASVS-(STORAGE|CRYPTO|AUTH|NETWORK|PLATFORM|CODE|RESILIENCE|PRIVACY)$/.test(v.control)
        && ['pending', 'pass', 'fail', 'not-applicable'].includes(v.result) && v.target && v.test && /^\d{4}-\d{2}-\d{2}$/.test(v.testedAt)
        && (v.result !== 'pass' || !!v.evidence) && (v.result !== 'not-applicable' || !!v.note)) out.verifications.push(v as unknown as SecurityVerification);
    }
    for (const value of raw.patches.slice(-100)) {
      const v = fields(value, ['system', 'published', 'mainline', 'kernel', 'at']);
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.system) && /^\d{4}-\d{2}-\d{2}$/.test(v.published)) out.patches.push(v as unknown as SecurityPatchRecord);
    }
    return out;
  }
  return { packages, range, osv, assess, workspace, fresh, packageKey };
})();
