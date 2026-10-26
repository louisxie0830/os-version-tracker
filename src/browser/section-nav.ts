// <section-nav>: the list of section links; hides a link whose section isn't on the page (a section with no
// data isn't rendered), marks the section currently in view (is-current, aria-current) and, when the links
// scroll sideways (narrow screens), keeps the current one in view and fades the edges.
defineElement('section-nav', class extends LightElement {
  protected setup(signal: AbortSignal): boolean {
    const all = [...this.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    if (!all.length) return false;
    const links = new Map<string, HTMLAnchorElement>();
    for (const a of all) {
      const id = a.getAttribute('href')!.slice(1);
      a.hidden = !document.getElementById(id);
      if (!a.hidden) links.set(id, a);
    }
    const ids = [...links.keys()];
    let shown: string | undefined;
    const update = (): void => {
      // The last section (in page order) whose top has passed 40% of the screen is the one being read; at the
      // very bottom the last sections can't get there, so the last one shown wins. Measured each time rather
      // than kept from observer events, which a long jump can skip past
      const band = innerHeight * 0.4;
      const onPage = ids.filter(id => {
        const section = document.getElementById(id);
        return !!section && !section.classList.contains('search-miss') && section.getBoundingClientRect().height > 0;
      });
      const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      let current: string | undefined = atBottom ? onPage.at(-1) : undefined;
      if (!atBottom) {
        for (const id of onPage) {
          if (document.getElementById(id)!.getBoundingClientRect().top <= band) current = id;
          else break;
        }
      }
      if (current === shown) return;
      shown = current;
      for (const [id, a] of links) {
        a.classList.toggle('is-current', id === current);
        if (id === current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      }
      const link = current === undefined ? undefined : links.get(current);
      const nav = link?.parentElement;
      if (link && nav && nav.scrollWidth > nav.clientWidth) {
        const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        nav.scrollTo({ left: link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2, behavior: still ? 'auto' : 'smooth' });
      }
    };
    // Sections crossing the band are the moments to look again (scrolling is the other)
    const observer = new IntersectionObserver(() => update(), { rootMargin: '-20% 0px -60% 0px' });
    for (const id of ids) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    const nav = this.querySelector<HTMLElement>('nav');
    if (nav) scrollSideways(nav, signal);
    // A search that leaves a section empty hides it; its link goes too, until the search changes
    document.addEventListener('page-searched', event => {
      const missing = new Set(event.detail?.missing ?? []);
      for (const [id, a] of links) a.hidden = missing.has(id);
    }, { signal });
    let frame = 0;
    addEventListener('scroll', () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
    }, { passive: true, signal });
    signal.addEventListener('abort', () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    });
    return true;
  }
});
