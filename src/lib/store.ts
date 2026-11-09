import { useSyncExternalStore } from "react";

export type Listener = () => void;

/** Minimal external store compatible with useSyncExternalStore. */
export class Store<T> {
  private listeners = new Set<Listener>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const l of Array.from(this.listeners)) l();
  }
  update(fn: (prev: T) => T): void {
    this.set(fn(this.value));
  }
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function useStore<T, S>(store: Store<T>, selector: (v: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
