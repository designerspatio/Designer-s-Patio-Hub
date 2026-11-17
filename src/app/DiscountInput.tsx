"use client";

import { useEffect, useRef, useState } from "react";

// Keep the text being typed separate from the numeric amount used for pricing.
// Otherwise typing "52." immediately becomes 52 and the decimal disappears.
export default function DiscountInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return <input
    type="text"
    inputMode="decimal"
    value={text}
    onFocus={() => { focused.current = true; }}
    onChange={event => {
      const next = event.target.value;
      if (!/^\d*(?:\.\d*)?$/.test(next)) return;
      setText(next);
      if (next && next !== "." && Number.isFinite(Number(next))) onChange(Number(next));
    }}
    onBlur={() => {
      focused.current = false;
      const amount = Number(text);
      const next = Number.isFinite(amount) ? amount : 0;
      setText(String(next));
      onChange(next);
    }}
  />;
}
