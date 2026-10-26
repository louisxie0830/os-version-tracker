// <activity-filter filters="type platform">: type/platform/search filtering for the "now" cards and activity
// feed, plus the feed's "show more" cap. It owns only elements marked with data-feed-* inside its Light DOM;
// the same search input also drives <page-search> (the whole page), which hears how many of these rows match
// through the bubbling "activity-filtered" event instead of counting them itself.
defineElement('activity-filter', class extends FilterController {
  #search: HTMLInputElement | null = null;
  /** Each row with its text in lower case (read once: searching compares it on every keystroke) */
  #items: Array<{ row: HTMLElement; text: string; now: boolean }> = [];
  #nowEmpty: HTMLElement | null = null;
  #feedEmpty: HTMLElement | null = null;
  /** The feed's "最近 7 天新增 N 項", and what it reads while a filter or search is on */
  #count: { el: HTMLElement; text: string } | null = null;
  #cap: (filtering: boolean) => void = () => {};

  protected wire(signal: AbortSignal): void {
    this.#search = this.querySelector<HTMLInputElement>('[data-activity-search]');
    this.#items = [...this.querySelectorAll<HTMLElement>('[data-feed-item]')]
      .map(row => ({ row, text: row.textContent.toLowerCase(), now: !!row.closest('[data-feed-now]') }));
    this.#nowEmpty = this.querySelector<HTMLElement>('[data-now-empty]');
    this.#feedEmpty = this.querySelector<HTMLElement>('[data-feed-empty]');
    const count = this.querySelector<HTMLElement>('[data-feed-count]');
    this.#count = count ? { el: count, text: count.textContent ?? '' } : null;
    // Only the feed's own cap: the page's other capped lists (the news) belong to their own components
    this.#cap = capList(this.querySelector('#feed'), signal, () => this.update());
    // Typing settles first, the same 120 ms as the page search, so both update together
    let timer: ReturnType<typeof setTimeout> | undefined;
    signal.addEventListener('abort', () => clearTimeout(timer));
    this.#search?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.update(), 120);
    }, { signal });
  }

  protected update(): string {
    const q = (this.#search?.value ?? '').trim().toLowerCase();
    const filtering = q !== '' || Object.values(this.filters).some(value => value !== 'all');
    let shownNow = 0;
    let shownFeed = 0;
    let matchedFeed = 0;
    this.#cap(filtering);
    // Rows still behind "show more" aren't counted as shown
    const capped = !!this.querySelector('#feed .is-collapsed[data-capped]');
    for (const { row, text, now } of this.#items) {
      const match = this.passes(row) && (!q || text.includes(q));
      row.hidden = !match;
      if (match && !now) matchedFeed++;
      if (match && !(capped && row.classList.contains('list-extra'))) now ? shownNow++ : shownFeed++;
    }
    const hasNow = this.#items.some(item => item.now);
    const hasFeed = this.#items.some(item => !item.now);
    if (this.#nowEmpty) this.#nowEmpty.hidden = !filtering || shownNow > 0 || !hasNow;
    if (this.#feedEmpty && hasFeed) this.#feedEmpty.hidden = shownFeed > 0;
    // Filtered, the header counts what's listed, not the whole week
    if (this.#count) this.#count.el.textContent = filtering ? `符合條件 ${matchedFeed} 項` : this.#count.text;
    this.dispatchEvent(new CustomEvent<ActivityFilteredDetail>('activity-filtered', { bubbles: true, detail: { shown: shownNow + shownFeed } }));
    return `待處理 ${shownNow} 項、最新動態 ${shownFeed} 項`;
  }
});
