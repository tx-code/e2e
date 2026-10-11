import type { SemanticNode } from 'e2e/engine';

export interface DomCapture {
  root: SemanticNode;
  viewport: { width: number; height: number };
  location: string;
  matched: Record<string, string[]>;
  truncated: boolean;
}

/** Executed in the document, with no module or test variables in its closure. */
export function captureDocument(selectors: string[], testIdAttribute: string, limit: number): DomCapture {
  const documentWindow = window as typeof window & {
    e2eWebDriverNodes?: { ids: WeakMap<Element, string>; elements: Map<string, WeakRef<Element>>; next: number; prefix: string };
  };
  const store = documentWindow.e2eWebDriverNodes ??= {
    ids: new WeakMap(), elements: new Map(), next: 0, prefix: crypto.randomUUID(),
  };
  const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const idOf = (element: Element): string => {
    if (element === document.body) return 'root';
    let id = store.ids.get(element);
    if (id === undefined) {
      id = `${store.prefix}:${++store.next}`;
      store.ids.set(element, id);
      store.elements.set(id, new WeakRef(element));
    }
    return id;
  };
  const text = (element: Element): string => normalize((element as HTMLElement).innerText ?? element.textContent ?? '');
  const purpose = (element: Element): SemanticNode['inputPurpose'] => {
    if (element.matches('input[type="password"]')) return 'password';
    const autocomplete = element.getAttribute('autocomplete') ?? '';
    if (autocomplete === 'username') return 'username';
    if (autocomplete === 'one-time-code') return 'one-time-code';
    return 'none';
  };
  const roleOf = (element: Element): string | undefined => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = element.tagName.toLowerCase();
    const roles: Record<string, string> = {
      button: 'button', textarea: 'textbox', select: 'combobox', option: 'option',
      img: 'image', ul: 'list', ol: 'list', li: 'listitem', table: 'table',
      thead: 'rowgroup', tbody: 'rowgroup', tr: 'row', td: 'cell', th: 'columnheader',
      main: 'main', nav: 'navigation', aside: 'complementary', article: 'article',
      progress: 'progressbar', meter: 'meter', dialog: 'dialog', summary: 'button',
    };
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (element.getAttribute('contenteditable') === 'true') return 'textbox';
    if (tag === 'input') {
      const type = (element as HTMLInputElement).type;
      if (type === 'hidden') return undefined;
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    return roles[tag];
  };
  const nameOf = (element: Element, role: string | undefined): string => {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const label = normalize(labelledBy.split(/\s+/).map((id) => {
        const target = document.getElementById(id);
        return target ? text(target) : '';
      }).join(' '));
      if (label) return label;
    }
    if (element.getAttribute('aria-label')) return normalize(element.getAttribute('aria-label')!);
    const labels = (element as HTMLInputElement).labels;
    if (labels?.length) return normalize([...labels].map(text).join(' '));
    if (element.tagName === 'IMG') return normalize(element.getAttribute('alt') ?? '');
    if (element.tagName === 'INPUT' && role === 'button') return normalize((element as HTMLInputElement).value);
    if (role === 'textbox' || role === 'combobox' || role === 'spinbutton') return normalize(element.getAttribute('title') ?? '');
    return role === undefined ? '' : text(element) || normalize(element.getAttribute('title') ?? '');
  };
  let count = 0;
  let truncated = false;
  const walk = (element: Element): SemanticNode | undefined => {
    if (element.matches('script, style, link, meta, head, noscript')) return undefined;
    if (++count > limit) { truncated = true; return undefined; }
    const role = roleOf(element);
    const secure = purpose(element) === 'password';
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const hidden = bounds.width === 0 || bounds.height === 0 || style.display === 'none' || style.visibility === 'hidden';
    const attributes: Record<string, string> = {};
    if (!secure) for (const attribute of element.attributes) attributes[attribute.name] = attribute.value;
    const name = nameOf(element, role);
    const states: NonNullable<SemanticNode['states']> = {
      hidden, secure, focused: document.activeElement === element,
      disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
      ...(['checked', 'selected', 'expanded', 'pressed'] as const).reduce<Record<string, boolean>>((result, state) => {
        const value = element.getAttribute(`aria-${state}`);
        if (value === 'true' || value === 'false') result[state] = value === 'true';
        return result;
      }, {}),
      ...(element.matches('input[type="checkbox"], input[type="radio"]') ? { checked: (element as HTMLInputElement).checked } : {}),
      ...(element.tagName === 'OPTION' ? { selected: (element as HTMLOptionElement).selected } : {}),
    };
    const value = !secure && element.matches('input, textarea, select') ? (element as HTMLInputElement).value : undefined;
    const children = [...element.children].map(walk).filter((node): node is SemanticNode => node !== undefined);
    const testId = element.getAttribute(testIdAttribute);
    return {
      ref: { id: idOf(element), revision: '' },
      ...(role === undefined ? {} : { role }),
      name, text: secure ? '' : text(element), attributes, states,
      inputPurpose: purpose(element) ?? 'none',
      ...(value === undefined ? {} : { value }),
      ...(testId === null ? {} : { testId }),
      ...(/^H[1-6]$/.test(element.tagName) ? { level: Number(element.tagName[1]) } : {}),
      rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, children,
    };
  };
  const capturedRoot = walk(document.body ?? document.documentElement)!;
  const root = { ...capturedRoot, ref: { id: 'root', revision: '' } };
  const matched: Record<string, string[]> = {};
  for (const selector of selectors) {
    const elements: Element[] = [];
    if (selector.startsWith('//') || selector.startsWith('xpath=')) {
      const xpath = selector.replace(/^xpath=/, '');
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
      for (let i = 0; i < result.snapshotLength; i++) {
        const item = result.snapshotItem(i);
        if (item instanceof Element) elements.push(item);
      }
    } else elements.push(...document.querySelectorAll(selector.replace(/^css=/, '')));
    matched[selector] = elements.map(idOf);
  }
  return { root, matched, truncated, viewport: { width: innerWidth, height: innerHeight }, location: location.href };
}

/** Returns the same live element that the document capture identified. */
export function elementByRef(id: string): Element | null {
  if (id === 'root') return document.body;
  const store = (window as typeof window & {
    e2eWebDriverNodes?: { elements: Map<string, WeakRef<Element>> };
  }).e2eWebDriverNodes;
  const element = store?.elements.get(id)?.deref();
  return element?.isConnected ? element : null;
}
