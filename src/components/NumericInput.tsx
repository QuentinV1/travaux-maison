import React, { useEffect, useRef } from 'react';

interface NumericInputProps {
  value: number;
  onCommit: (value: number) => void;
  onCancel?: () => void;
  onTab?: (shiftKey: boolean, committedValue: number) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

function formatNumericValue(val: number): string {
  if (!Number.isFinite(val)) return '0';
  return String(Math.round(val * 100) / 100);
}

export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  onCommit,
  onCancel,
  onTab,
  min = 0.1,
  max,
  step = 0.1,
  disabled = false,
  autoFocus = false,
  className = '',
  placeholder,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);
  const rawTypingRef = useRef<string>(formatNumericValue(value));

  useEffect(() => {
    const formatted = formatNumericValue(value);
    rawTypingRef.current = formatted;
    if (inputRef.current && !focusedRef.current) {
      inputRef.current.value = formatted;
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [autoFocus]);

  const parseAndCommit = (rawStr: string): number => {
    const normalized = rawStr.trim().replace(/,/g, '.');
    const parsed = Number(normalized);
    if (normalized === '' || Number.isNaN(parsed)) {
      const fallback = formatNumericValue(value);
      if (inputRef.current) inputRef.current.value = fallback;
      rawTypingRef.current = fallback;
      return value;
    }
    let clamped = Math.max(min, parsed);
    if (max !== undefined) {
      clamped = Math.min(max, clamped);
    }
    clamped = Math.round(clamped * 100) / 100;
    const formatted = formatNumericValue(clamped);
    if (inputRef.current) inputRef.current.value = formatted;
    rawTypingRef.current = formatted;
    if (Math.abs(clamped - value) > 1e-4) {
      onCommit(clamped);
    }
    return clamped;
  };

  return (
    <input
      ref={inputRef}
      type="number"
       inputMode="decimal"
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      placeholder={placeholder}
      defaultValue={formatNumericValue(value)}
      onFocus={(e) => {
        focusedRef.current = true;
        rawTypingRef.current = e.currentTarget.value;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        // When typing "12," in <input type="number">, browser sets e.target.value = "" with badInput=true
        // We do not overwrite the DOM value so the user can finish typing "12,5" seamlessly.
        if (e.currentTarget.value !== '') {
          rawTypingRef.current = e.currentTarget.value;
        }
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        const valToParse = e.currentTarget.value !== '' ? e.currentTarget.value : rawTypingRef.current;
        parseAndCommit(valToParse);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const valToParse = e.currentTarget.value !== '' ? e.currentTarget.value : rawTypingRef.current;
          parseAndCommit(valToParse);
          e.currentTarget.blur();
        } else if (e.key === 'Tab' && onTab) {
          e.preventDefault();
          const valToParse = e.currentTarget.value !== '' ? e.currentTarget.value : rawTypingRef.current;
          const committed = parseAndCommit(valToParse);
          onTab(e.shiftKey, committed);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          const fallback = formatNumericValue(value);
          if (inputRef.current) inputRef.current.value = fallback;
          rawTypingRef.current = fallback;
          focusedRef.current = false;
          onCancel?.();
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
};
