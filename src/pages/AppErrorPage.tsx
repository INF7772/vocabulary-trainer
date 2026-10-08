import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useRouteError } from 'react-router-dom';

export function AppErrorPage() {
  const { t } = useTranslation();
  useRouteError();

  return (
    <main className="mx-auto grid min-h-dvh max-w-xl place-items-center p-6 text-center">
      <div>
        <AlertTriangle aria-hidden="true" className="mx-auto text-amber-600" size={44} />
        <h1 className="mt-4 text-2xl font-bold">{t('errors.generic')}</h1>
        <Link className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-slate-950 px-5 font-semibold text-white" to="/">
          {t('notFound.backHome')}
        </Link>
      </div>
    </main>
  );
}
