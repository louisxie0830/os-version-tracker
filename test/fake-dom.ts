// A small fake of the DOM and the page around the components (enough for test/components.test.ts): elements
// with attributes, classes, dataset, events (bubbling, stopPropagation, AbortSignal-bound listeners) and a
// selector matcher (selector lists; descendant and child combinators; tag, #id, class, [attr], [attr="v"],
// [attr^="v"], :not(…)), plus the address, history, document, timers, storage and IntersectionObserver.
import { APP_PARTS, joinAppParts, readPart } from '../src/asset-versions.ts';
import { COMPONENT_TAGS } from '../src/component-tags.ts';

const TAGS: readonly string[] = COMPONENT_TAGS;

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export class FakeEvent {
  target: FakeElement | null = null;
  bubbles: boolean;
  detail: unknown;
  defaultPrevented = false;
  key = '';
  constructor(public type: string, init: { bubbles?: boolean; detail?: unknown; key?: string } = {}) {
    this.bubbles = !!init.bubbles;
    this.detail = init.detail;
    this.key = init.key ?? '';
  }
  preventDefault() { this.defaultPrevented = true; }
  stopped = false;
  stopPropagation() { this.stopped = true; }
}

/** One compound selector ("tag#id.class[attr][attr=\"v\"][attr^=\"v\"]:not(<compound>)" or "*") */
function matchesCompound(el: FakeElement, compound: string): boolean {
  const negations: string[] = [];
  const own = compound.replace(/:not\(([^()]*)\)/g, (_, inner: string) => { negations.push(inner); return ''; });
  const m = own.match(/^(\*|[a-z][\w-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)((?:\[[\w-]+(?:\^?="[^"]*")?\])*)$/);
  if (!m) throw new Error(`fake DOM: unsupported selector "${compound}"`);
  return (!m[1] || m[1] === '*' || el.tagName === m[1])
    && (!m[2] || el.attrs.get('id') === m[2])
    && m[3].split('.').filter(Boolean).every(c => el.classList.contains(c))
    && [...m[4].matchAll(/\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)].every(a => el.attrs.has(a[1])
      && (a[2] === undefined || (a[2] === '=' ? el.attrs.get(a[1]) === a[3] : el.attrs.get(a[1])!.startsWith(a[3]))))
    && negations.every(inner => !matchesCompound(el, inner));
}

/** A selector list with descendant (" ") and child (">") combinators, matched right to left */
function matchesSelector(el: FakeElement, selector: string): boolean {
  return selector.split(',').some(complex => {
    const parts = complex.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    const at = (node: FakeElement | null, i: number): boolean => {
      if (!node || !matchesCompound(node, parts[i])) return false;
      if (i === 0) return true;
      if (parts[i - 1] === '>') return at(node.parentElement, i - 2);
      for (let p = node.parentElement; p; p = p.parentElement) if (at(p, i - 1)) return true;
      return false;
    };
    return at(el, parts.length - 1);
  });
}

export class FakeElement {
  tagName = '';
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  #text = '';
  listeners = new Map<string, Array<(e: FakeEvent) => void>>();
  dataset: Record<string, string> = new Proxy({}, {
    get: (_, key) => [...this.attrs].find(([k]) => k.startsWith('data-') && camel(k.slice(5)) === key)?.[1],
    set: (_, key, value) => { this.attrs.set(`data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, String(value)); return true; },
  });
  classList = {
    contains: (c: string) => (this.attrs.get('class') ?? '').split(' ').includes(c),
    toggle: (c: string, on: boolean) => {
      const list = (this.attrs.get('class') ?? '').split(' ').filter(x => x && x !== c);
      this.attrs.set('class', [...list, ...(on ? [c] : [])].join(' '));
    },
    add: (c: string) => this.classList.toggle(c, true),
    remove: (c: string) => this.classList.toggle(c, false),
  };
  get className() { return this.attrs.get('class') ?? ''; }
  set className(v: string) { this.attrs.set('class', v); }
  /** Its own text, or (as the DOM does) its children's */
  get textContent(): string { return this.children.length ? this.children.map(c => c.textContent).join('') : this.#text; }
  set textContent(v: string) { this.children = []; this.#text = v; }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v: boolean) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get rows() { return this.children.filter(c => c.tagName === 'tr'); }
  get value() { return this.attrs.get('value') ?? ''; }
  set value(v: string) { this.attrs.set('value', v); }
  get id() { return this.attrs.get('id') ?? ''; }
  get previousElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  // Enough layout for line-chart: a 600-wide plot and viewBox, a tooltip of no width
  style: Record<string, string> = {};
  offsetWidth = 0;
  viewBox = { baseVal: { width: 600 } };
  /** Where a test puts it on screen (top, height); the rest is a 600-wide box */
  rect: { top?: number; height?: number } = {};
  getBoundingClientRect() { return { width: 600, top: this.rect.top ?? 0, height: this.rect.height ?? 100 }; }
  replaceChildren(...nodes: FakeElement[]) { this.children = []; this.append(...nodes); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attrs.set(name, String(value)); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  hasAttribute(name: string) { return this.attrs.has(name); }
  append(...nodes: Array<FakeElement | string>) {
    for (const node of nodes) {
      const n = typeof node === 'string' ? Object.assign(new FakeElement(), { tagName: '#text', textContent: node }) : node;
      if (n.parentElement) n.parentElement.children = n.parentElement.children.filter(c => c !== n);
      n.parentElement = this;
      this.children.push(n);
    }
  }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; }
  contains(el: unknown): boolean {
    for (let p = el instanceof FakeElement ? el : null; p; p = p.parentElement) if (p === this) return true;
    return false;
  }
  matches(selector: string): boolean { return this.tagName !== '#text' && matchesSelector(this, selector); }
  closest(selector: string): FakeElement | null {
    for (let p: FakeElement | null = this; p; p = p.parentElement) if (p.matches(selector)) return p;
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(type: string, fn: (e: FakeEvent) => void, options?: { signal?: AbortSignal }) {
    if (options?.signal?.aborted) return;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    options?.signal?.addEventListener('abort', () => this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn)));
  }
  dispatchEvent(event: FakeEvent) {
    event.target ??= this;
    for (let p: FakeElement | null = this; p && !event.stopped; p = event.bubbles ? p.parentElement : null) for (const fn of p.listeners.get(event.type) ?? []) fn(event);
    return true;
  }
  focus() { fakeFocus.current = this; }
  blur() { if (fakeFocus.current === this) fakeFocus.current = null; }
  select() {}
  scrollIntoView() { this.attrs.set('data-scrolled-to', ''); }
}
export const fakeFocus: { current: FakeElement | null } = { current: null };

/** The page around the components: the address, history, document, timers and the window's events */
export function fakePage(href: string) {
  const location = { href, search: new URL(href).search };
  const history = {
    state: null,
    replaceState: (_state: unknown, _title: string, url: URL | string) => {
      location.href = String(url);
      location.search = new URL(location.href).search;
    },
  };
  const body = Object.assign(new FakeElement(), { tagName: 'body' });
  const documentElement = Object.assign(new FakeElement(), { tagName: 'html', scrollHeight: 5000 });
  documentElement.append(body);
  const timers: Array<{ at: number; run: () => void; every?: number }> = [];
  let now = 0;
  const document = Object.assign(new FakeElement(), {
    tagName: '#document',
    body,
    documentElement,
    visibilityState: 'visible',
    createElement: (tag: string) => Object.assign(new FakeElement(), { tagName: tag }),
    createTextNode: (text: string) => Object.assign(new FakeElement(), { tagName: '#text', textContent: text }),
    getElementById: (id: string) => body.querySelectorAll(`[id="${id}"]`)[0] ?? null,
  });
  // A live getter (Object.assign would copy its value once, freezing whatever had focus then)
  Object.defineProperty(document, 'activeElement', { get: () => fakeFocus.current });
  document.append(documentElement);
  const win = Object.assign(new FakeElement(), { innerHeight: 800, scrollY: 0 });
  const observers: Array<{ callback: (entries: Array<{ target: FakeElement; isIntersecting: boolean }>) => void; targets: FakeElement[] }> = [];
  class IntersectionObserver {
    targets: FakeElement[] = [];
    constructor(public callback: (entries: Array<{ target: FakeElement; isIntersecting: boolean }>) => void) { observers.push(this); }
    observe(target: FakeElement) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  }
  const storage = new Map<string, string>();
  const globals: Record<string, unknown> = {
    HTMLElement: FakeElement, Element: FakeElement, SVGElement: FakeElement, Node: FakeElement, CustomEvent: FakeEvent, Event: FakeEvent,
    location, history, document, window: {}, IntersectionObserver,
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); } },
    get innerHeight() { return win.innerHeight; },
    get scrollY() { return win.scrollY; },
    addEventListener: win.addEventListener.bind(win),
    // Runs at once; returns 0, as if the frame had already gone (an id would read as one still pending)
    requestAnimationFrame: (run: () => void) => { run(); return 0; },
    cancelAnimationFrame: () => {},
    setTimeout: (run: () => void, ms: number) => timers.push({ at: now + ms, run }),
    clearTimeout: (id: number) => { if (timers[id - 1]) timers[id - 1].run = () => {}; },
    setInterval: (run: () => void, ms: number) => timers.push({ at: now + ms, run, every: ms }),
    clearInterval: (id: number) => { if (timers[id - 1]) timers[id - 1].run = () => {}; },
  };
  /** Moves the fake clock on, running the timers that come due */
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers) {
      while (t.at <= now) {
        t.run();
        if (!t.every) { t.at = Infinity; break; }
        t.at += t.every;
      }
    }
  };
  return { location, history, document, body, win, observers, storage, globals, advance };
}

/**
 * Runs app.js's parts but page.js (page-level behaviour, checked in the browser) with the fake globals, as one
 * script the way app.js joins them; returns the registry and the fake page
 */
export function loadComponents(href = 'https://example.com/', extra: Array<[string, string]> = []) {
  const registry = new Map<string, new () => FakeElement>();
  const page = fakePage(href);
  const customElements = {
    get: (name: string) => registry.get(name),
    define: (name: string, ctor: new () => FakeElement) => {
      if (registry.has(name)) throw new Error(`${name} already defined`);
      registry.set(name, ctor);
    },
  };
  const names = [...Object.keys(page.globals), 'customElements'];
  const values = [...Object.values(page.globals), customElements];
  // The getters (innerHeight, scrollY) are read when the scripts use them
  const source = joinAppParts(APP_PARTS.filter(part => part !== 'page.js').map(part => [part, readPart(part).toString()]).concat(extra))
    .replace(/\binnerHeight\b/g, '__page.innerHeight').replace(/\bscrollY\b/g, '__page.scrollY');
  const run = () => new Function(...names, '__page', source)(...values, page.globals);
  run();
  run(); // loaded twice, the components must not redefine (or throw)
  return Object.assign(registry, { page });
}

export type Spec = [string, Record<string, string>?, Spec[]?];
/** Builds a fake tree; custom elements are created from the registry, then "connected" (as an upgrade does) */
export function build(registry: Map<string, new () => FakeElement>, [tag, attrs = {}, kids = []]: Spec): FakeElement {
  const Ctor = registry.get(tag);
  const el = Ctor ? new Ctor() : new FakeElement();
  el.tagName = tag;
  for (const [k, v] of Object.entries(attrs)) el.attrs.set(k, v);
  el.append(...kids.map(k => build(registry, k)));
  return el;
}
/** Connects the custom elements in the tree, in document order (as defining them in a parsed page does) */
export const connectAll = (el: FakeElement) => {
  for (const node of [el, ...el.querySelectorAll('*')]) {
    if (TAGS.includes(node.tagName)) (node as unknown as { connectedCallback?: () => void }).connectedCallback?.();
  }
};
export const click = (el: FakeElement) => el.dispatchEvent(new FakeEvent('click', { bubbles: true }));
export const key = (el: FakeElement, k: string) => {
  const event = new FakeEvent('keydown', { bubbles: true, key: k });
  el.dispatchEvent(event);
  return event.defaultPrevented;
};
export const chips = (name: string, values: string[]): Spec => ['choice-chips', { name }, [['div', { class: 'chips', role: 'radiogroup' }, values.map((v, i) => ['button', { class: i ? 'chip' : 'chip is-active', role: 'radio', 'data-value': v, 'aria-checked': String(!i), tabindex: i ? '-1' : '0' }] as Spec)]]];
export const state = (group: FakeElement) => group.querySelectorAll('.chip').map(c => `${c.dataset.value}:${c.classList.contains('is-active')}:${c.getAttribute('aria-checked')}:${c.getAttribute('tabindex')}`);
