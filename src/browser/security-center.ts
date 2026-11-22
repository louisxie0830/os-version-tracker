{
  const KEY = 'osvt-security-workspace-v1';
  const CASE_STATUS: Record<string, string> = { pending: '待確認', working: '處理中', mitigated: '已採取措施', fixed: '已修補／服務恢復', verified: '已驗證', 'not-applicable': '不適用' };
  const RESULT: Record<string, string> = { pending: '待驗證', pass: '通過（使用者填報）', fail: '未通過', 'not-applicable': '不適用' };
  class SecurityCenter extends LightElement {
    protected setup(signal: AbortSignal): boolean {
      const dataNode = this.querySelector('[data-security-data]');
      if (!dataNode) return false;
      const data = JSON.parse(dataNode.textContent ?? '{}') as { advisories: SecurityAdvisory[] };
      const feedback = this.querySelector<HTMLElement>('[data-security-feedback]');
      const say = (message: string) => { if (feedback) feedback.textContent = message; };
      let state = SecurityTools.fresh();
      try { const saved = localStorage.getItem(KEY); if (saved) state = SecurityTools.workspace(JSON.parse(saved)); }
      catch { say('無法讀取已存紀錄，請匯入備份；新的紀錄仍可在本次頁面使用。'); }
      const write = () => {
        try { localStorage.setItem(KEY, JSON.stringify(state)); say('已儲存在此瀏覽器。'); }
        catch { say('瀏覽器無法儲存，請在離開前匯出本次紀錄。'); }
        redraw();
      };
      const makeTable = (target: Element | null, labels: string[], rows: string[][]) => {
        if (!target) return;
        target.replaceChildren();
        if (!rows.length) { const p = document.createElement('p'); p.textContent = '尚未有紀錄。'; target.append(p); return; }
        const wrap = document.createElement('div'); wrap.className = 'table-wrap';
        const table = document.createElement('table'); table.className = 'compat-table stack-on-mobile security-table';
        const head = document.createElement('thead'), header = document.createElement('tr');
        for (const label of labels) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.append(th); }
        head.append(header); table.append(head);
        const body = document.createElement('tbody');
        for (const values of rows) { const tr = document.createElement('tr'); values.forEach((value, i) => { const td = document.createElement('td'); td.dataset.label = labels[i]; td.textContent = value; tr.append(td); }); body.append(tr); }
        table.append(body); wrap.append(table); target.append(wrap);
      };
      const redraw = () => {
        const last = new Map(state.cases.map(c => [c.subject, c]));
        for (const span of this.querySelectorAll<HTMLElement>('[data-security-state]')) {
          const item = last.get(span.dataset.securityState ?? '');
          span.textContent = item ? `${CASE_STATUS[item.status]}（個人紀錄） · ${item.at.slice(0, 10)}` : '待確認適用性';
        }
        for (const target of this.querySelectorAll('[data-security-case-list]')) makeTable(target, ['個人追蹤／銀行／服務', '處理狀態', '發生／恢復（台灣時間）', '證據／處置說明', '記錄時間（UTC）'], [...state.cases].reverse().map(c => [
          [c.title || c.subject, c.bank, c.service].filter(Boolean).join(' · '), CASE_STATUS[c.status], `發生 ${c.occurredAt || '待確認'}／恢復 ${c.recoveredAt || '待確認'}`, `${c.evidence} ${c.note}`, c.at]));
        makeTable(this.querySelector('[data-security-verification-list]'), ['App／版本', '分類／測試', '使用者填報結果', '證據與說明', '測試日期／人員'], [...state.verifications].reverse().map(v => [v.target, `${v.control} · ${v.test}`, RESULT[v.result], `${v.evidence} ${v.note}`, `${v.testedAt} ${v.reviewer}`]));
        const patch = state.patches.at(-1), target = this.querySelector('[data-security-patch-result]');
        if (target && patch) makeTable(target, ['元件', '裝置值', '對照結果'], [
          ['系統安全修補', patch.system, patch.system >= patch.published ? `已達所選公告日期 ${patch.published}；仍須驗證裝置適用性` : `落後所選公告日期 ${patch.published}，請確認可用更新`],
          ['Google Play 系統更新', patch.mainline || '未填寫', '需按元件與對應公告驗證，不能套用系統日期'],
          ['核心', patch.kernel || '未填寫', '需按核心版本與對應修補公告驗證'],
        ]);
      };
      const tabs = [...this.querySelectorAll<HTMLButtonElement>('[data-security-tab]')];
      const panels = [...this.querySelectorAll<HTMLElement>('[data-security-panel]')];
      const choose = (id: string, focus = false) => {
        const selected = tabs.find(t => t.dataset.securityTab === id) ?? tabs[0];
        if (!selected) return;
        for (const tab of tabs) { const yes = tab === selected; tab.setAttribute('aria-selected', String(yes)); tab.tabIndex = yes ? 0 : -1; }
        for (const panel of panels) panel.hidden = panel.dataset.securityPanel !== selected.dataset.securityTab;
        keepInAddress('security-view', selected.dataset.securityTab ?? null);
        if (focus) selected.focus();
      };
      for (const tab of tabs) {
        tab.addEventListener('click', () => choose(tab.dataset.securityTab ?? ''), { signal });
        tab.addEventListener('keydown', event => {
          const at = tabs.indexOf(tab);
          const next = event.key === 'ArrowRight' ? (at + 1) % tabs.length : event.key === 'ArrowLeft' ? (at + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); choose(tabs[next].dataset.securityTab ?? '', true); }
        }, { signal });
      }
      choose(readFromAddress('security-view') ?? 'overview');
      // Filter text searches every row, the ones past the cap too; an empty filter goes back to the capped view
      // (rows marked data-security-extra stay hidden until "顯示全部")
      for (const input of this.querySelectorAll<HTMLInputElement>('[data-security-filter]')) input.addEventListener('input', () => {
        const target = this.querySelector(`#security-${input.dataset.securityFilter}`);
        const query = input.value.trim().toLowerCase();
        for (const row of target?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []) {
          row.hidden = query ? !(row.textContent ?? '').toLowerCase().includes(query) : row.hasAttribute('data-security-extra');
        }
      }, { signal });
      for (const button of this.querySelectorAll<HTMLButtonElement>('[data-security-show-all]')) button.addEventListener('click', () => {
        const target = this.querySelector(`#security-${button.dataset.securityShowAll}`);
        for (const row of target?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-security-extra]') ?? []) {
          row.removeAttribute('data-security-extra');
          row.hidden = false;
        }
        button.closest('[data-security-cap]')?.remove();
      }, { signal });
      const values = (form: HTMLFormElement): Record<string, string> => Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value).trim().slice(0, 1000)]));
      for (const form of this.querySelectorAll<HTMLFormElement>('[data-security-case-form]')) form.addEventListener('submit', event => {
        event.preventDefault();
        const v = values(form), at = new Date().toISOString();
        const title = v.subject === 'manual' ? v.title : (form.elements.namedItem('subject') as HTMLSelectElement).selectedOptions[0]?.textContent ?? '';
        if (!title || !v.evidence || !(v.status in CASE_STATUS)) { say('請填寫標題、處理狀態與證據。'); return; }
        state.cases.push({ subject: v.subject === 'manual' ? `manual:${title}` : v.subject, title, status: v.status, evidence: v.evidence, note: v.note, at,
          bank: v.bank, service: v.service, occurredAt: v.occurredAt, recoveredAt: v.recoveredAt });
        state.cases = state.cases.slice(-500); write();
      }, { signal });
      const patchForm = this.querySelector<HTMLFormElement>('[data-security-patch-form]');
      patchForm?.addEventListener('submit', event => {
        event.preventDefault(); const v = values(patchForm);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.system) || !/^\d{4}-\d{2}-\d{2}$/.test(v.published)) { say('請填寫有效的裝置與公告修補日期。'); return; }
        state.patches.push({ system: v.system, published: v.published, mainline: v.mainline, kernel: v.kernel, at: new Date().toISOString() });
        state.patches = state.patches.slice(-100); write();
      }, { signal });
      const verification = this.querySelector<HTMLFormElement>('[data-security-verification-form]');
      verification?.addEventListener('submit', event => {
        event.preventDefault(); const v = values(verification);
        if (!v.target || !v.test || !v.testedAt || !(v.result in RESULT) || (v.result === 'pass' && !v.evidence) || (v.result === 'not-applicable' && !v.note)) { say('請完成必填欄位；通過須附證據，不適用須附說明。'); return; }
        state.verifications.push({ target: v.target, control: v.control, test: v.test, result: v.result, testedAt: v.testedAt, evidence: v.evidence, reviewer: v.reviewer, note: v.note, at: new Date().toISOString() });
        state.verifications = state.verifications.slice(-500); write();
      }, { signal });
      const readFile = async (input: HTMLInputElement): Promise<unknown> => {
        const file = input.files?.[0];
        if (!file) throw new Error('尚未選擇檔案。');
        if (file.size > 5 * 1024 * 1024) throw new Error('檔案超過 5 MB。');
        return JSON.parse(await file.text()) as unknown;
      };
      let packages: SecurityPackage[] = [], scan: ReturnType<typeof SecurityTools.osv> = new Map();
      let packageRequest = 0, osvRequest = 0;
      const imported = (kind: string, ok: boolean) => this.dispatchEvent(new CustomEvent('security-import', { bubbles: true, detail: { kind, ok } }));
      const assess = () => {
        const target = this.querySelector('[data-security-package-results]'), status = this.querySelector('[data-security-package-status]');
        if (status) status.textContent = packages.length ? `已解析 ${packages.length} 個套件版本，OSV 結果含 ${scan.size} 個套件版本；只在本機比對。` : '尚未匯入套件清單。';
        makeTable(target, ['套件／生態系', '使用版本', '比對結果', '漏洞／修補與限制'], SecurityTools.assess(packages, data.advisories ?? [], scan).map(r => [`${r.name} (${r.ecosystem})`, r.version, r.result, r.detail]));
      };
      const packageInput = this.querySelector<HTMLInputElement>('[data-security-packages]');
      packageInput?.addEventListener('change', async () => {
        const request = ++packageRequest;
        try {
          const value = SecurityTools.packages(await readFile(packageInput));
          if (request !== packageRequest || signal.aborted) return;
          packages = value; assess(); say('套件清單已在本機解析，沒有上傳。'); imported('packages', true);
        } catch (error) {
          if (request !== packageRequest || signal.aborted) return;
          packages = []; assess(); say(`匯入失敗：${(error as Error).message}`); imported('packages', false);
        }
      }, { signal });
      const osvInput = this.querySelector<HTMLInputElement>('[data-security-osv]');
      osvInput?.addEventListener('change', async () => {
        const request = ++osvRequest;
        try {
          const value = SecurityTools.osv(await readFile(osvInput));
          if (request !== osvRequest || signal.aborted) return;
          scan = value; assess(); say('OSV 結果已在本機匯入；只套用到完全相同的套件、生態系與版本。'); imported('osv', true);
        } catch (error) {
          if (request !== osvRequest || signal.aborted) return;
          scan = new Map(); assess(); say(`匯入失敗：${(error as Error).message}`); imported('osv', false);
        }
      }, { signal });
      const importer = this.querySelector<HTMLInputElement>('[data-security-import]');
      importer?.addEventListener('change', async () => {
        try {
          const imported = SecurityTools.workspace(await readFile(importer));
          const unique = <T>(items: T[]) => [...new Map(items.map(v => [JSON.stringify(v), v])).values()];
          state = { schema: 1, cases: unique([...state.cases, ...imported.cases]).slice(-500), verifications: unique([...state.verifications, ...imported.verifications]).slice(-500), patches: unique([...state.patches, ...imported.patches]).slice(-100) };
          write();
        } catch (error) { say(`匯入失敗：${(error as Error).message}`); }
      }, { signal });
      this.querySelector('[data-security-export]')?.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = 'security-workspace.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); say('已匯出個人追蹤與驗證紀錄；不包含原始套件檔案。');
      }, { signal });
      redraw();
      return true;
    }
  }
  defineElement('security-center', SecurityCenter);
}
