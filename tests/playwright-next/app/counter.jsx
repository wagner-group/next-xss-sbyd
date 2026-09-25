"use client";

import {useState} from "react";

/** Expose a state change that proves React hydration completed. */
export default function Counter() {
  const [count, setCount] = useState(0);
  function increment() { setCount(count + 1); }
  return <button onClick={increment}>Count {count}</button>;
}
