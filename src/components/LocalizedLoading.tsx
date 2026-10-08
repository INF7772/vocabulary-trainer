import { useTranslation } from "react-i18next";

export function LocalizedLoading() {
  const { t } = useTranslation();
  return (
    <p className="p-6 text-center font-semibold text-slate-600">
      {t("common.loading")}
    </p>
  );
}
