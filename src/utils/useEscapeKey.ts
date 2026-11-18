import { useEffect, useRef } from 'react';

/**
 * Calls `onClose` when the user presses Escape while `isOpen` is true.
 * Uses capture phase so open modals intercept Escape before background canvas listeners.
 */
export function useEscapeKey(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen]);
}
