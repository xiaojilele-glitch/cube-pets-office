import { useEffect, useState } from "react";

export function useIdleActivation(enabled: boolean, timeout = 800) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setActive(false);
      return;
    }

    if (typeof window === "undefined") {
      setActive(true);
      return;
    }

    setActive(false);

    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const activate = () => {
      setActive(true);
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(
        () => {
          activate();
        },
        { timeout }
      );
    } else {
      timeoutId = window.setTimeout(activate, timeout);
    }

    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [enabled, timeout]);

  return active;
}
