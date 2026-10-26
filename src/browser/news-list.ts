// <news-list filters="news">: developer-news filtering, its "show more" cap and empty state. The server renders
// all rows and the empty message; this component only changes visibility, so the content stays complete
// without JS. Each row's data-news holds the values that let it through (its platform, and "important").
defineElement('news-list', class extends FilterController {
  #rows: HTMLElement[] = [];
  #empty: HTMLElement | null = null;
  #cap: (filtering: boolean) => void = () => {};

  protected wire(signal: AbortSignal): boolean {
    const list = this.querySelector<HTMLElement>('[data-news-items]');
    if (!list) return false;
    this.#rows = [...list.children] as HTMLElement[];
    this.#empty = this.querySelector<HTMLElement>('[data-news-empty]');
    this.#cap = capList(list.parentElement, signal, () => this.update());
    return true;
  }

  protected update(): string {
    let shown = 0;
    for (const row of this.#rows) {
      const match = this.passes(row);
      row.hidden = !match;
      if (match) shown++;
    }
    this.#cap(Object.values(this.filters).some(value => value !== 'all'));
    if (this.#empty) this.#empty.hidden = shown > 0;
    return `顯示 ${shown} 則新聞`;
  }
});
