// <page-search skip="now feed" jump-to="now">: the whole-page search. It wraps the page so it can reach the
// search input (input[data-page-search]) in the header, the status line ([data-search-status]) and every
// section of <main>. The rows it searches are the children of the [data-search-rows] containers the
// renderers mark (a list, a table body, a grid of cards). Rows that don't match are hidden, a card or table
// whose heading matches keeps all its rows, and a section with nothing left hides. The sections named in
// `skip` are left to <activity-filter>, which uses the same input and reports how many of its rows match
// ("activity-filtered"). The search is kept in the address (?search=) and restored from it. Enter jumps to the
// section named in `jump-to`; "/" anywhere outside a field focuses the search.
defineElement('page-search', class extends LightElement {
  /** How many rows <activity-filter> last said match */
  #activityShown = 0;

  protected setup(signal: AbortSignal): boolean {
    const search = this.querySelector<HTMLInputElement>('input[data-page-search]');
    if (!search) return false;
    const status = this.querySelector<HTMLElement>('[data-search-status]');
    const skip = (this.getAttribute('skip') ?? '').split(/\s+/);
    /** The query the page currently shows (lower case) */
    let applied = '';
    // The activity filter's count only changes the summary line (its rows aren't this search's); a filter that
    // changed rows in the searched sections changes which sections have anything left, so the search reruns
    this.addEventListener('activity-filtered', event => {
      this.#activityShown = event.detail?.shown ?? 0;
      summarize();
    }, { signal });
    this.addEventListener('rows-changed', event => {
      if (applied && !(event.target instanceof Element && event.target.closest('activity-filter') === event.target)) searchPage(applied);
    }, { signal });

    // The heading of the card or table a row is in (e.g. "AGP" names a table of version numbers)
    const headingOf = (el: Element): string => {
      const card = el.closest('.case');
      if (card) return card.querySelector('.case-head')?.textContent ?? '';
      let prev = el.closest('.table-wrap')?.previousElementSibling;
      while (prev?.classList.contains('table-note')) prev = prev.previousElementSibling;
      return prev?.textContent ?? '';
    };
    const lower = (el: Element | null | undefined): string => (el?.textContent ?? '').toLowerCase();
    // The text is read once, in lower case: a search compares it on every keystroke
    const rowsIn = (el: Element): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('[data-search-rows] > *')];
    // Built on the first search, not on every page load (most visits never search)
    let index: Array<{ section: HTMLElement; text: string; rows: Array<{ row: HTMLElement; text: string; heading: string }>; cards: Array<{ card: HTMLElement; rows: HTMLElement[] }> }> | undefined;
    const sectionsToSearch = () => (index ??= [...this.querySelectorAll<HTMLElement>('main > section')].filter(section => !skip.includes(section.id)).map(section => ({
      section,
      text: lower(section),
      rows: rowsIn(section).map(row => ({ row, text: lower(row), heading: headingOf(row).toLowerCase() })),
      cards: [...section.querySelectorAll<HTMLElement>('.case, .table-wrap')].map(card => ({ card, rows: rowsIn(card) })),
    })));

    /** Rows found outside the activity filter by the last search */
    let found = 0;
    const summarize = (): void => {
      if (!status) return;
      status.hidden = applied === '';
      const summary = status.querySelector('[data-search-summary]');
      // Only once the search has caught up with the box (the activity filter can report first)
      if (summary && applied && search.value.trim().toLowerCase() === applied) summary.textContent = `「${search.value.trim()}」：待處理與動態 ${this.#activityShown} 筆，其他區塊 ${found} 筆`;
    };

    const searchPage = (q: string): void => {
      applied = q;
      document.body.classList.toggle('searching', q !== '');
      found = 0;
      const missing: string[] = [];
      for (const { section, text, rows, cards } of q || index ? sectionsToSearch() : []) {
        let hits = 0;
        for (const { row, text: rowText, heading } of rows) {
          const miss = q !== '' && !rowText.includes(q) && !heading.includes(q);
          row.classList.toggle('search-miss', miss);
          // A row another filter hides (the news or bank chips) isn't a hit either
          if (!miss && !row.hidden) hits++;
        }
        for (const { card, rows: own } of cards) {
          card.classList.toggle('search-miss', q !== '' && own.length > 0 && own.every(r => r.classList.contains('search-miss')));
        }
        const matches = q === '' || (rows.length ? hits > 0 : text.includes(q));
        section.classList.toggle('search-miss', !matches);
        if (!matches) missing.push(section.id);
        if (q && rows.length) found += hits;
      }
      // Collapsed parts (requirements already in effect, a long detail) open while a search finds something in
      // them, and close again when the search is cleared
      for (const box of this.querySelectorAll<HTMLDetailsElement>('details[data-search-open]')) {
        if (q && !box.open && (box.textContent ?? '').toLowerCase().includes(q)) {
          box.open = true;
          box.dataset.searchOpened = '';
        } else if (!q && box.dataset.searchOpened !== undefined) {
          box.open = false;
          delete box.dataset.searchOpened;
        }
      }
      // The section links hide the sections the search emptied
      this.dispatchEvent(new CustomEvent('page-searched', { bubbles: true, detail: { missing } }));
      summarize();
      keepInAddress('search', search.value.trim() || null);
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    signal.addEventListener('abort', () => clearTimeout(timer));
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => searchPage(search.value.trim().toLowerCase()), 120);
    }, { signal });
    status?.querySelector('[data-search-clear]')?.addEventListener('click', () => {
      search.value = '';
      search.dispatchEvent(new Event('input'));
      search.focus();
    }, { signal });
    search.addEventListener('keydown', event => {
      const target = this.getAttribute('jump-to');
      if (event.key === 'Enter' && target) document.getElementById(target)?.scrollIntoView({ block: 'start' });
    }, { signal });
    // "/" jumps to the search box (unless the reader is already typing somewhere)
    document.addEventListener('keydown', event => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      search.focus();
      search.select();
    }, { signal });

    // A search in the address (a reload, a shared link): run it, the activity filter included
    const kept = readFromAddress('search');
    if (kept && !search.value) {
      search.value = kept;
      search.dispatchEvent(new Event('input'));
    }
    return true;
  }
});
