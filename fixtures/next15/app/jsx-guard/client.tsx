"use client";

import {useEffect, useState} from "react";

/** Verifies that the guarding JSX runtime executes in the hydrated browser bundle. */
export function ClientGuard() {
  const [blocked, setBlocked] = useState<number | null>(null);
  useEffect(() => {
    const accepted = [];
    let count = 0;
    try {
      accepted.push(<div {...{dangerouslySetInnerHTML: {__html: "unsafe"}}} />);
    } catch (error) {
      if (error instanceof TypeError) count += 1;
    }
    setBlocked(accepted.length === 0 ? count : -1);
  }, []);
  return <p data-client-guard={blocked}>{blocked}</p>;
}
