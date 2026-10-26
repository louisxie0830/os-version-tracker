// The base of the page's custom elements. A classic script loaded before the component scripts, so its
// declarations are globals they build on. Every component wraps server-rendered Light DOM that is complete
// without script and only adds behaviour to it.

/** Registers a custom element once, however often its script runs */
function defineElement(name: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, ctor);
}

/**
 * Sets itself up when connected, once its parts are in place: setup() returns false to be tried again on the
 * next connection. Everything it listens to is tied to `signal`, which disconnecting aborts, so an element
 * moved in the page is set up afresh instead of stacking listeners.
 */
abstract class LightElement extends HTMLElement {
  #wiring: AbortController | null = null;

  connectedCallback(): void {
    if (this.#wiring) return;
    const wiring = new AbortController();
    let ready: boolean | void = false;
    try {
      ready = this.setup(wiring.signal);
    } finally {
      // A setup that failed or threw drops whatever it had already attached, so a retry starts clean
      if (ready === false) wiring.abort();
      else this.#wiring = wiring;
    }
  }

  disconnectedCallback(): void {
    this.#wiring?.abort();
    this.#wiring = null;
  }

  protected abstract setup(signal: AbortSignal): boolean | void;
}

/**
 * Keeps a piece of the page's state in the address (?name=value) without a new history entry, so a reload or a
 * shared link shows the same thing; null (or "all") leaves it out.
 */
function keepInAddress(name: string, value: string | null): void {
  try {
    const url = new URL(location.href);
    if (value === null || value === 'all') url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  } catch {}
}

/** A value kept in the address, or null */
function readFromAddress(name: string): string | null {
  try { return new URLSearchParams(location.search).get(name); } catch { return null; }
}

/**
 * A row that scrolls sideways on narrow screens (chips, the section links): a mouse wheel scrolls it, and the
 * edge with more content fades (is-scroll-more-left / -right) so it's clear there is more.
 */
function scrollSideways(el: HTMLElement, signal: AbortSignal): void {
  const edges = (): void => {
    const more = el.scrollWidth - el.clientWidth > 1;
    el.classList.toggle('is-scroll-more-left', more && el.scrollLeft > 1);
    el.classList.toggle('is-scroll-more-right', more && el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };
  edges();
  el.addEventListener('scroll', edges, { passive: true, signal });
  el.addEventListener('wheel', event => {
    const room = el.scrollWidth - el.clientWidth;
    // Only a vertical wheel over a horizontal scroller; trackpads already scroll sideways
    if (room <= 1 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const next = Math.max(0, Math.min(room, el.scrollLeft + event.deltaY));
    // At either end the page scrolls as usual
    if (next === el.scrollLeft) return;
    event.preventDefault();
    el.scrollLeft = next;
  }, { passive: false, signal });
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(edges);
    observer.observe(el);
    signal.addEventListener('abort', () => observer.disconnect());
  }
}

/**
 * The "show more" cap of a list: while the list ([data-capped]) has is-collapsed, the stylesheet hides its
 * .list-extra rows, until the [data-show-more] button is used. A filter shows every match, so it lifts the cap
 * without using it up. `host` is the element holding that one list and its button (not a wrapper around
 * several capped lists, which would take the first one whatever it is). The button is marked data-wired, so
 * theme.js can tell a working cap from one whose script never ran. Using it moves focus to the first row it
 * revealed (the button itself goes away). Returns the function that brings the list and the button up to date.
 */
function capList(host: Element | null, signal: AbortSignal, changed: () => void): (filtering: boolean) => void {
  const list = host?.querySelector<HTMLElement>('[data-capped]') ?? null;
  const more = host?.querySelector<HTMLElement>('[data-show-more]') ?? null;
  if (more) more.dataset.wired = '';
  more?.addEventListener('click', () => {
    more.dataset.expanded = '1';
    changed();
    const first = list?.querySelector<HTMLElement>('.list-extra:not([hidden])');
    const target = first?.querySelector<HTMLElement>('a[href], button') ?? first;
    if (target) {
      if (target === first) target.tabIndex = -1;
      target.focus();
    }
  }, { signal });
  signal.addEventListener('abort', () => { if (more) delete more.dataset.wired; });
  return filtering => {
    const expanded = more?.dataset.expanded === '1';
    list?.classList.toggle('is-collapsed', !!more && !filtering && !expanded);
    if (more) more.hidden = filtering || expanded;
  };
}

/** The nearest filter element around an event's target */
function ownerOf(target: EventTarget | null): Element | null {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el instanceof FilterController) return el;
  }
  return null;
}

/**
 * Rows filtered by the <choice-chips> groups inside it that its `filters` attribute names (space-separated).
 * A row matches a choice when its data-<group> holds the chosen value (several values separated by "|");
 * "all" lets every row through. The choices are kept in the address (?f-group=value: prefixed, so they can't
 * be mistaken for parameters a link picks up elsewhere), so a reload or a shared
 * link shows the same rows, and restored from it on setup. After a reader's choice, the text update() returns
 * is announced in the [data-filter-status] region, if there is one.
 */
abstract class FilterController extends LightElement {
  /** Group name → chosen value; a group never chosen lets every row through */
  protected readonly filters: Record<string, string> = {};

  protected setup(signal: AbortSignal): boolean {
    if (this.wire(signal) === false) return false;
    const names = (this.getAttribute('filters') ?? '').split(/\s+/).filter(Boolean);
    const status = this.querySelector<HTMLElement>('[data-filter-status]');
    let restoring = true;
    this.addEventListener('choice-change', event => {
      const { name, value } = event.detail ?? {};
      // Only its own chip groups: not one inside a nested filter, and not a same-named group elsewhere
      if (!names.includes(name) || ownerOf(event.target) !== this) return;
      this.filters[name] = value;
      const summary = this.update();
      // Others that count these rows (the page search) hear that they changed
      this.dispatchEvent(new CustomEvent('rows-changed', { bubbles: true }));
      if (restoring) return;
      keepInAddress(`f-${name}`, value);
      if (status && summary) status.textContent = summary;
    }, { signal });
    for (const name of names) this.#restore(name);
    restoring = false;
    this.update();
    return true;
  }

  /** Finds its parts and listens to its own controls; false when its markup isn't there (yet) */
  protected abstract wire(signal: AbortSignal): boolean | void;

  /** Shows the rows the choices let through; returns what to announce after a choice */
  protected abstract update(): string | void;

  /** Whether a row passes every choice */
  protected passes(row: HTMLElement): boolean {
    return Object.entries(this.filters).every(([name, value]) => value === 'all' || (row.dataset[name] ?? '').split('|').includes(value));
  }

  /** Chooses the chip the address names for a group (an unknown value is ignored) */
  #restore(name: string): void {
    const value = readFromAddress(`f-${name}`);
    if (value === null) return;
    const group = [...this.querySelectorAll('choice-chips')].find(g => g.getAttribute('name') === name);
    const chip = group && [...group.querySelectorAll<HTMLElement>('.chip')].find(c => c.dataset.value === value);
    if (chip && typeof group.choose === 'function') group.choose(chip);
  }
}
