import type { RuntimeEvent } from "./types";

type RuntimeEventListener = (event: RuntimeEvent) => void;

class LocalRuntimeEventBus {
  private listeners = new Set<RuntimeEventListener>();

  emit(event: RuntimeEvent) {
    this.listeners.forEach(listener => {
      listener(event);
    });
  }

  subscribe(listener: RuntimeEventListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const runtimeEventBus = new LocalRuntimeEventBus();
