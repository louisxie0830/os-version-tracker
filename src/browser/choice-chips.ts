// <choice-chips name="…">: a group of .chip buttons where exactly one is chosen. Wraps the server-rendered
// group (Light DOM, so the page's styles and the whole-page search see the same buttons). A click keeps
// is-active and aria-pressed in step and dispatches a bubbling "choice-change" event with
// { name, value } (the group's name attribute and the chip's data-value), so the controller around it
// (bank-table, news-list, chart-switch, the feed in app.js) can react without reaching into the group.
if (!customElements.get('choice-chips')) {
  customElements.define('choice-chips', class extends HTMLElement {
    #ready = false;

    connectedCallback(): void {
      if (this.#ready) return;
      this.#ready = true;
      this.addEventListener('click', event => {
        const chip = event.target instanceof Element ? event.target.closest<HTMLElement>('.chip') : null;
        if (!chip || !this.contains(chip)) return;
        this.choose(chip);
      });
    }

    /** Marks `chip` as the chosen one and announces its value */
    choose(chip: HTMLElement): void {
      for (const c of this.querySelectorAll<HTMLElement>('.chip')) {
        c.classList.toggle('is-active', c === chip);
        c.setAttribute('aria-pressed', String(c === chip));
      }
      this.dispatchEvent(new CustomEvent<ChoiceChangeDetail>('choice-change', {
        bubbles: true,
        detail: { name: this.getAttribute('name') ?? '', value: chip.dataset.value ?? '' },
      }));
    }
  });
}
