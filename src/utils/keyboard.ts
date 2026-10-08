export interface ChoiceShortcutEvent {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const contentEditable = target.getAttribute("contenteditable");
  return (
    target.isContentEditable ||
    (contentEditable !== null && contentEditable !== "false") ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function choiceShortcutIndex(event: ChoiceShortcutEvent): number | null {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isEditableKeyboardTarget(event.target ?? null) ||
    !/^[1-4]$/u.test(event.key)
  ) {
    return null;
  }
  return Number(event.key) - 1;
}
