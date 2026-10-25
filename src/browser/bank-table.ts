// <bank-table>: the bank App table's kind / minimum iOS / minimum Android / changed / targetSdk filters
// (choice-chips inside it), the sort select, the "共 N 個 App" count and the empty message. Wraps the
// server-rendered filters and table, which stay complete and readable without script.
if (!customElements.get('bank-table')) {
  customElements.define('bank-table', class extends HTMLElement {
    #ready = false;
    /** Filter name → chosen value; a filter that was never touched (or is "all") lets every row through */
    #filters: Record<string, string> = {};

    connectedCallback(): void {
      if (this.#ready) return;
      const body = this.querySelector('tbody');
      if (!body) return;
      this.#ready = true;
      const rows = [...body.rows];
      const count = this.querySelector<HTMLElement>('[data-bank-count]');
      const empty = this.querySelector<HTMLElement>('[data-bank-empty]');
      const sort = this.querySelector<HTMLSelectElement>('select[data-bank-sort]');
      const apply = (): void => {
        let shown = 0;
        for (const row of rows) {
          const match = Object.entries(this.#filters).every(([key, value]) => value === 'all' || row.dataset[key] === value);
          row.hidden = !match;
          if (match) shown++;
        }
        // The chosen option names the row dataset key to order by (data-sort-key) and the direction
        // (data-sort-dir="asc" | "desc"); an option without a key keeps the page's order, as do ties
        const option = sort ? [...sort.querySelectorAll('option')].find(o => o.value === sort.value) : null;
        const key = option?.dataset.sortKey;
        const direction = option?.dataset.sortDir === 'asc' ? 1 : -1;
        const ordered = [...rows].sort((a, b) => (key ? direction * (Number(a.dataset[key]) - Number(b.dataset[key])) : 0) || Number(a.dataset.index) - Number(b.dataset.index));
        body.append(...ordered);
        if (count) count.textContent = shown === rows.length ? `共 ${rows.length} 個 App` : `顯示 ${shown} / ${rows.length} 個 App`;
        if (empty) empty.hidden = shown > 0;
      };
      this.addEventListener('choice-change', event => {
        const { name, value } = event.detail ?? {};
        if (!name) return;
        this.#filters[name] = value;
        apply();
      });
      sort?.addEventListener('change', apply);
    }
  });
}
