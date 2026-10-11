import { useEffect, useState } from "react";

/** Re-render a few times a second: the work moves on its own. */
export function useTicking(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
