import { useLanguage } from '../../context/LanguageContext';

export function ReceiptProcessingStep() {
  const { t } = useLanguage();

  return (
    <main className="main-content max-w-[480px] flex flex-col items-center justify-center py-24 gap-4">
      <div
        role="status"
        aria-label={t('receipt.processing')}
        className="h-10 w-10 rounded-full border-2 border-muted border-t-primary animate-spin"
      />
      <p className="text-muted-foreground">{t('receipt.processing')}</p>
    </main>
  );
}
