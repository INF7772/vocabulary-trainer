import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="not-found-title">
      <h1 id="not-found-title" className="text-3xl font-semibold">
        {t('notFound.title')}
      </h1>
      <Link
        className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-3 font-medium text-white outline-none hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:bg-white dark:text-slate-950"
        to="/"
      >
        {t('notFound.backHome')}
      </Link>
    </section>
  );
}
