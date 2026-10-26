// The page's toast stack (#toasts, a polite live region): short messages in the corner that go away by
// themselves. Shared by the notification center and the section links. The stack announces what is added to
// it, so a toast has no role of its own (one more live region would be read out twice by some readers).

interface ToastOptions {
  /** Buttons after the message, each with its own click handler (the toast closes after it runs) */
  actions?: Array<{ label: string; run: () => void }>;
  /** A close button */
  closable?: boolean;
  /** How long it stays, in ms */
  timeout?: number;
}

/** Shows a message (text, or nodes); returns its element, or null when the page has no toast stack */
function showToast(message: string | Node[], { actions = [], closable = false, timeout = 2500 }: ToastOptions = {}): HTMLElement | null {
  const stack = document.getElementById('toasts');
  if (!stack) return null;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const body = document.createElement('div');
  body.className = 'toast-body';
  body.append(...(typeof message === 'string' ? [message] : message));
  toast.append(body);
  for (const { label, run } of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn toast-action';
    button.textContent = label;
    button.addEventListener('click', event => {
      // The click has done its job here: it mustn't go on to a page listener ("click outside closes the
      // panel" would close the panel this button just opened)
      event.stopPropagation();
      toast.remove();
      run();
    });
    toast.append(button);
  }
  if (closable) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', '關閉');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss());
    toast.append(close);
  }
  // Where focus came from when the reader tabbed into the toast: closing it puts focus back there, not on <body>
  let cameFrom: Element | null = null;
  toast.addEventListener('focusin', event => {
    if (event.relatedTarget instanceof Element && !toast.contains(event.relatedTarget)) cameFrom = event.relatedTarget;
  });
  const dismiss = (): void => {
    const hadFocus = toast.contains(document.activeElement);
    toast.remove();
    if (!hadFocus) return;
    const back = cameFrom && document.contains(cameFrom) ? cameFrom : document.getElementById('notif-bell');
    if (back instanceof HTMLElement) back.focus();
  };
  stack.append(toast);
  // The clock stops while the reader points at it or has focus in it (reading it, reaching for a button), and
  // starts over once neither is true
  let timer = setTimeout(() => toast.remove(), timeout);
  let pointer = false;
  let focus = false;
  const sync = (): void => {
    clearTimeout(timer);
    if (!pointer && !focus) timer = setTimeout(() => toast.remove(), timeout);
  };
  toast.addEventListener('mouseenter', () => { pointer = true; sync(); });
  toast.addEventListener('mouseleave', () => { pointer = false; sync(); });
  toast.addEventListener('focusin', () => { focus = true; sync(); });
  toast.addEventListener('focusout', event => {
    focus = event.relatedTarget instanceof Node && toast.contains(event.relatedTarget);
    sync();
  });
  return toast;
}
