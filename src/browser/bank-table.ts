// <bank-table filters="kind ios …">: the bank App table's filters (choice-chips inside it), the sort select,
// the "共 N 個 App" count (a live region of its own) and the empty message. Wraps the server-rendered filters
// and table, which stay complete and readable without script.
defineElement('bank-table', class extends FilterController {
  #body: HTMLTableSectionElement | null = null;
  #rows: HTMLTableRowElement[] = [];
  #count: HTMLElement | null = null;
  #empty: HTMLElement | null = null;
  #sort: HTMLSelectElement | null = null;

  protected wire(signal: AbortSignal): boolean {
    this.#body = this.querySelector('tbody');
    if (!this.#body) return false;
    this.#rows = [...this.#body.rows];
    this.#count = this.querySelector<HTMLElement>('[data-bank-count]');
    this.#empty = this.querySelector<HTMLElement>('[data-bank-empty]');
    this.#sort = this.querySelector<HTMLSelectElement>('select[data-bank-sort]');
    const sort = this.#sort;
    // A sort kept in the address (?bank-sort=…, like the filters), or one the browser kept from before
    const kept = readFromAddress('bank-sort');
    if (sort && kept && [...sort.options].some(o => o.value === kept)) sort.value = kept;
    sort?.addEventListener('change', () => {
      this.#order();
      // The first option is the page's own order: nothing to keep
      keepInAddress('bank-sort', sort.selectedIndex > 0 ? sort.value : null);
    }, { signal });
    this.#order();
    return true;
  }

  protected update(): void {
    let shown = 0;
    for (const row of this.#rows) {
      const match = this.passes(row);
      row.hidden = !match;
      if (match) shown++;
    }
    const total = this.#rows.length;
    if (this.#count) this.#count.textContent = shown === total ? `共 ${total} 個 App` : `顯示 ${shown} / ${total} 個 App`;
    if (this.#empty) this.#empty.hidden = shown > 0;
  }

  /**
   * Orders the rows as the chosen option says: it names the row dataset key to order by (data-sort-key) and
   * the direction (data-sort-dir="asc" | "desc"); an option without a key keeps the page's order, as do ties
   */
  #order(): void {
    const sort = this.#sort;
    const option = sort ? [...sort.querySelectorAll('option')].find(o => o.value === sort.value) : null;
    const key = option?.dataset.sortKey;
    const direction = option?.dataset.sortDir === 'asc' ? 1 : -1;
    const ordered = [...this.#rows].sort((a, b) => (key ? direction * (Number(a.dataset[key]) - Number(b.dataset[key])) : 0) || Number(a.dataset.index) - Number(b.dataset.index));
    this.#body?.append(...ordered);
  }
});
