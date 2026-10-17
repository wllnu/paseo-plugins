import { useCallback, useSyncExternalStore } from "react";

// Ticked findings per review. Kept at module level, outside React state, so switching tabs or between the
// list and the diff view keeps the selection for as long as the plugin is loaded. Never persisted.
const selections = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const EMPTY: ReadonlySet<string> = new Set();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelection(key: string | null): [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const selected = useSyncExternalStore(subscribe, () => (key ? (selections.get(key) ?? EMPTY) : EMPTY));
  const setSelected = useCallback(
    (next: ReadonlySet<string>) => {
      if (!key) return;
      selections.set(key, next);
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [selected, setSelected];
}
