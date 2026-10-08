export function KeyboardShortcutBadge({ number }: { number: number }) {
  return (
    <kbd
      aria-hidden="true"
      className="inline-grid min-h-7 min-w-7 place-items-center rounded-md border border-slate-300 bg-slate-100 px-1.5 text-xs font-black text-slate-600 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
    >
      {number}
    </kbd>
  );
}
