import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
// Every export is gated on Platform.OS === "web" and is a no-op elsewhere.
interface DomRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}
interface DomNode {
  nodeType: number;
  parentElement: DomElement | null;
}
interface DomElement extends DomNode {
  id: string;
  closest(selector: string): DomElement | null;
  contains(node: DomNode | null): boolean;
  getBoundingClientRect(): DomRect;
}
interface DomRange {
  startContainer: DomNode;
  endContainer: DomNode;
  getBoundingClientRect(): DomRect;
}
interface DomSelection {
  isCollapsed: boolean;
  rangeCount: number;
  anchorNode: DomNode | null;
  focusNode: DomNode | null;
  getRangeAt(index: number): DomRange;
  toString(): string;
  removeAllRanges(): void;
}
interface DomEvent {
  target: unknown;
}
type DomListener = (event: DomEvent) => void;
declare const document: {
  getSelection(): DomSelection | null;
  getElementById(id: string): DomElement | null;
  addEventListener(type: string, listener: DomListener): void;
  removeEventListener(type: string, listener: DomListener): void;
};

const BLOCK_ID_PREFIX = "plan-block-";

/** DOM id for a rendered block, derived from its locator key. Safe to call on every platform. */
export function blockElementId(key: string): string {
  return BLOCK_ID_PREFIX + encodeURIComponent(key);
}

/** Does this client support mouse text selection in the plan? */
export function supportsTextSelection(): boolean {
  return Platform.OS === "web";
}

export interface PlanTextSelection {
  /** Highlighted text, whitespace collapsed. */
  text: string;
  /** Locator key of the block where the range starts, in document order. */
  startKey: string | null;
  /** Locator key of the block where the range ends, in document order. */
  endKey: string | null;
  /** Bounding box of the range relative to the plan container's top-left corner. */
  rect: DomRect;
}

function elementOf(node: DomNode | null): DomElement | null {
  if (!node) return null;
  return node.nodeType === 1 ? (node as DomElement) : node.parentElement;
}

function blockKeyOf(node: DomNode | null): string | null {
  const block = elementOf(node)?.closest(`[id^="${BLOCK_ID_PREFIX}"]`) ?? null;
  if (!block) return null;
  try {
    return decodeURIComponent(block.id.slice(BLOCK_ID_PREFIX.length));
  } catch {
    return null;
  }
}

/** The current text selection if it lies inside the plan container, else null. */
export function readPlanSelection(containerId: string): PlanTextSelection | null {
  if (Platform.OS !== "web") return null;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const container = document.getElementById(containerId);
  if (!container) return null;
  if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return null;
  const text = selection.toString().replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const origin = container.getBoundingClientRect();
  return {
    text: text.length > 2000 ? `${text.slice(0, 1999)}…` : text,
    startKey: blockKeyOf(range.startContainer),
    endKey: blockKeyOf(range.endContainer),
    rect: {
      top: rect.top - origin.top,
      left: rect.left - origin.left,
      bottom: rect.bottom - origin.top,
      right: rect.right - origin.left,
    },
  };
}

export function clearPlanSelection(): void {
  if (Platform.OS !== "web") return;
  document.getSelection()?.removeAllRanges();
}

export interface PlanSelectionHandlers {
  /** A selection finished inside the plan (mouse up or keyboard selection). */
  onSelect(selection: PlanTextSelection): void;
  /** The user clicked inside the plan without selecting text. */
  onDismiss(): void;
}

/**
 * Watch for finished selections inside the plan container. Interactions on the element with
 * `toolbarId` are ignored, so pressing the floating comment button does not dismiss the snapshot
 * even though the browser collapses the live selection on mouse down.
 */
export function subscribeToPlanSelection(
  containerId: string,
  toolbarId: string,
  handlers: PlanSelectionHandlers,
): () => void {
  if (Platform.OS !== "web") return () => {};
  let disposed = false;

  const isInside = (id: string, target: unknown): boolean => {
    const element = document.getElementById(id);
    return Boolean(element && element.contains(target as DomNode));
  };

  const settle = (event: DomEvent) => {
    // The selection is finalized after the pointer event completes.
    setTimeout(() => {
      if (disposed) return;
      if (isInside(toolbarId, event.target)) return;
      const selection = readPlanSelection(containerId);
      if (selection) handlers.onSelect(selection);
      else if (isInside(containerId, event.target)) handlers.onDismiss();
    }, 0);
  };

  const onKeyUp = (event: DomEvent) => {
    if (disposed || isInside(toolbarId, event.target)) return;
    const selection = readPlanSelection(containerId);
    if (selection) handlers.onSelect(selection);
  };

  document.addEventListener("pointerup", settle);
  document.addEventListener("keyup", onKeyUp);
  return () => {
    disposed = true;
    document.removeEventListener("pointerup", settle);
    document.removeEventListener("keyup", onKeyUp);
  };
}
