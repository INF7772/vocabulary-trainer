import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StoredImage } from '../domain';
import { useObjectUrl } from '../hooks/useObjectUrl';

export function CardImage({
  image,
  className = '',
  loading = 'lazy',
}: {
  image: StoredImage | null;
  className?: string;
  loading?: 'eager' | 'lazy';
}) {
  const { t } = useTranslation();
  const url = useObjectUrl(image?.blob);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const broken = Boolean(url && failedUrl === url);

  if (!url || broken) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 ${className}`}
        role="img"
        aria-label={t("card.missingImage")}
      >
        <ImageOff aria-hidden="true" size={28} />
      </div>
    );
  }

  return (
    <img
      alt={image?.alt ?? ''}
      className={`object-cover ${className}`}
      loading={loading}
      onError={() => setFailedUrl(url)}
      src={url}
    />
  );
}
