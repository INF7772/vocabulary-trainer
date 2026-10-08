import { CheckCircle2, XCircle } from 'lucide-react';

export function FeedbackBanner({
  kind,
  text,
}: {
  kind: 'success' | 'error';
  text: string;
}) {
  const Icon = kind === 'success' ? CheckCircle2 : XCircle;
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-4 py-3 font-semibold ${
        kind === 'success'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
          : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
      }`}
      role="status"
    >
      <Icon aria-hidden="true" size={20} />
      {text}
    </div>
  );
}
