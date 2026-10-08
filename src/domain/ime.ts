export interface TypingKeyEvent {
  key: string;
  isComposing: boolean;
  keyCode?: number;
}

export function shouldSubmitTypingAnswer(event: TypingKeyEvent): boolean {
  return (
    event.key === 'Enter' &&
    !event.isComposing &&
    // Some browsers report the composition-confirming key as legacy code 229.
    event.keyCode !== 229
  );
}
