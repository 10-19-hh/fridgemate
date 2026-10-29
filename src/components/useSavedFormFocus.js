import { useEffect, useRef, useState } from 'react';

// Saved forms intentionally remount to clear old values. Restore their keyboard
// position only if the user has not focused another control while awaiting ACK.
export default function useSavedFormFocus(contextKey) {
  const containerRef = useRef(null);
  const headingRef = useRef(null);
  const pending = useRef(null);
  const [, setRevision] = useState(0);

  function cancel(intent = pending.current) {
    if (!intent || pending.current !== intent) return;
    intent.document.removeEventListener('focusin', intent.onFocus);
    pending.current = null;
  }

  function begin() {
    cancel();
    const origin = containerRef.current?.ownerDocument.activeElement;
    if (!origin?.closest('form') || !containerRef.current.contains(origin)) return null;
    const intent = { origin, document: origin.ownerDocument, moved: false, ready: false };
    intent.onFocus = event => { if (event.target !== origin) intent.moved = true; };
    intent.document.addEventListener('focusin', intent.onFocus);
    pending.current = intent;
    return intent;
  }

  function complete(intent) {
    if (!intent || pending.current !== intent) return;
    intent.ready = true;
    setRevision(value => value + 1);
  }

  useEffect(() => {
    const intent = pending.current;
    if (!intent?.ready) return;
    const active = intent.document.activeElement;
    const restore = !intent.moved && (active === intent.origin ||
      (!intent.origin.isConnected && active === intent.document.body));
    cancel(intent);
    if (restore) headingRef.current?.focus();
  });

  useEffect(() => {
    const invalidate = () => cancel();
    window.addEventListener('focus', invalidate);
    return () => { cancel(); window.removeEventListener('focus', invalidate); };
  }, [contextKey]);

  return { containerRef, headingRef, begin, complete, cancel };
}
