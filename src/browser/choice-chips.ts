// <choice-chips name="…">: a radio group (role="radiogroup") of .chip buttons (role="radio") where exactly one is
// chosen. Wraps the server-rendered group (Light DOM, so the page's styles and the whole-page search see the
// same buttons). Choosing a chip (a click, or the arrow keys / Home / End, which move the choice the way radio
// buttons do) keeps is-active, aria-checked and the roving tabindex (only the chosen chip is a tab stop) in
// step, and dispatches a bubbling "choice-change" event with { name, value } (the group's name attribute and
// the chip's data-value), so the controller around it (activity-filter, bank-table, news-list and
// chart-switch) can react without reaching into the group. The group scrolls sideways on narrow screens.
defineElement('choice-chips', class extends LightElement implements ChoiceChipsElement {
  protected setup(signal: AbortSignal): void {
    const chipOf = (target: EventTarget | null): HTMLElement | null => {
      const chip = target instanceof Element ? target.closest<HTMLElement>('.chip') : null;
      return chip && this.contains(chip) ? chip : null;
    };
    this.addEventListener('click', event => {
      const chip = chipOf(event.target);
      if (chip) this.choose(chip);
    }, { signal });
    this.addEventListener('keydown', event => {
      const chip = chipOf(event.target);
      if (!chip) return;
      const chips = [...this.querySelectorAll<HTMLElement>('.chip')];
      const i = chips.indexOf(chip);
      const next = ({ ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: chips.length - 1 } as Record<string, number>)[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const target = chips[(next + chips.length) % chips.length];
      target.focus();
      this.choose(target);
    }, { signal });
    const row = this.querySelector<HTMLElement>('[role="radiogroup"]');
    if (row) scrollSideways(row, signal);
  }

  choose(chip: HTMLElement): void {
    for (const c of this.querySelectorAll<HTMLElement>('.chip')) {
      c.classList.toggle('is-active', c === chip);
      c.setAttribute('aria-checked', String(c === chip));
      c.setAttribute('tabindex', c === chip ? '0' : '-1');
    }
    this.dispatchEvent(new CustomEvent<ChoiceChangeDetail>('choice-change', {
      bubbles: true,
      detail: { name: this.getAttribute('name') ?? '', value: chip.dataset.value ?? '' },
    }));
  }
});
