// <news-list>: developer-news filtering, its "show more" cap and empty state. The server renders all rows
// and the empty message; this component only changes visibility, so the content stays complete without JS.
// Its choice-chips group is selected declaratively by filter-name and communicates through choice-change.
if (!customElements.get('news-list')) {
  customElements.define('news-list', class extends HTMLElement {
    #ready = false;
    #filter = 'all';

    connectedCallback(): void {
      if (this.#ready) return;
      const list = this.querySelector<HTMLElement>('[data-news-items]');
      if (!list) return;
      this.#ready = true;
      const rows = [...list.children] as HTMLElement[];
      const more = this.querySelector<HTMLElement>('[data-news-more]');
      const empty = this.querySelector<HTMLElement>('[data-news-empty]');

      const apply = (): void => {
        let shown = 0;
        for (const row of rows) {
          const match = this.#filter === 'all'
            || (this.#filter === 'important' ? row.dataset.important === '1' : row.dataset.platform === this.#filter);
          row.hidden = !match;
          if (match) shown++;
        }
        const expanded = more?.dataset.expanded === '1';
        // With a filter on, show every match; the cap only applies to the unfiltered list.
        list.classList.toggle('collapsed', this.#filter === 'all' && !!more && !expanded);
        if (more) more.hidden = this.#filter !== 'all' || expanded;
        if (empty) empty.hidden = shown > 0;
      };

      this.addEventListener('choice-change', event => {
        const { name, value } = event.detail ?? {};
        if (name !== this.getAttribute('filter-name')) return;
        this.#filter = value;
        apply();
      });
      more?.addEventListener('click', () => {
        more.dataset.expanded = '1';
        apply();
      });
      apply();
    }
  });
}
