// <activity-filter>: type/platform/search filtering for the "now" cards and activity feed, plus the feed's
// initial row cap. It owns only elements marked with data-feed-* inside its Light DOM; the same search input
// can independently drive the whole-page search without either controller calling the other.
if (!customElements.get('activity-filter')) {
  customElements.define('activity-filter', class extends HTMLElement {
    #ready = false;
    #filters: Record<'type' | 'platform', string> = { type: 'all', platform: 'all' };

    connectedCallback(): void {
      if (this.#ready) return;
      const search = this.querySelector<HTMLInputElement>('[data-activity-search]');
      const items = [...this.querySelectorAll<HTMLElement>('[data-feed-item]')];
      const more = this.querySelector<HTMLElement>('[data-feed-more]');
      const nowEmpty = this.querySelector<HTMLElement>('[data-now-empty]');
      const feedEmpty = this.querySelector<HTMLElement>('[data-feed-empty]');
      this.#ready = true;

      const hasNow = items.some(item => !!item.closest('[data-feed-now]'));
      const hasFeed = items.some(item => !item.closest('[data-feed-now]'));
      const apply = (): void => {
        const q = (search?.value ?? '').trim().toLowerCase();
        const filtering = this.#filters.type !== 'all' || this.#filters.platform !== 'all' || q !== '';
        let shownNow = 0;
        let shownFeed = 0;
        for (const item of items) {
          const match = (this.#filters.type === 'all' || item.dataset.type === this.#filters.type)
            && (this.#filters.platform === 'all' || item.dataset.platform === this.#filters.platform)
            && (!q || item.textContent.toLowerCase().includes(q));
          const capped = !filtering && item.classList.contains('feed-extra') && more?.dataset.expanded !== '1';
          item.hidden = !match || capped;
          if (match) item.closest('[data-feed-now]') ? shownNow++ : shownFeed++;
        }
        if (more) more.hidden = filtering || more.dataset.expanded === '1';
        if (nowEmpty) nowEmpty.hidden = !filtering || shownNow > 0 || !hasNow;
        if (feedEmpty && hasFeed) feedEmpty.hidden = shownFeed > 0;
      };

      this.addEventListener('choice-change', event => {
        const { name, value } = event.detail ?? {};
        if (name !== 'type' && name !== 'platform') return;
        this.#filters[name] = value;
        apply();
      });
      search?.addEventListener('input', apply);
      more?.addEventListener('click', () => {
        more.dataset.expanded = '1';
        apply();
      });
      apply();
    }
  });
}
