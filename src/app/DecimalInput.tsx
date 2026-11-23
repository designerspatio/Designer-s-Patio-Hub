"use client";

import { useEffect, useRef, useState } from "react";

// Keep the text being typed separate from the numeric amount used for pricing.
// Otherwise typing "52." immediately becomes 52 and the decimal disappears.
export default function DecimalInput({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === 0 && placeholder ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value === 0 && placeholder ? "" : String(value));
  }, [value, placeholder]);

  return <input
    type="text"
    inputMode="decimal"
    placeholder={placeholder}
    value={text}
    onFocus={() => { focused.current = true; }}
    onChange={event => {
      const next = event.target.value;
      if (!/^\d*(?:\.\d*)?$/.test(next)) return;
      setText(next);
      const amount = Number(next);
      if (Number.isFinite(amount)) onChange(amount);
      else if (next === ".") onChange(0);
    }}
    onBlur={() => {
      focused.current = false;
      const amount = Number(text);
      const next = Number.isFinite(amount) ? amount : 0;
      setText(next === 0 && placeholder ? "" : String(next));
      onChange(next);
    }}
  />;
}
