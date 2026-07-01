import { useLanguage } from '../../context/LanguageContext';
import type { ReceiptParseProgress } from '../../types';

interface ReceiptProcessingStepProps {
  progress?: ReceiptParseProgress | null;
}

export function ReceiptProcessingStep({ progress }: ReceiptProcessingStepProps) {
  const { t } = useLanguage();

  const statusText =
    progress?.model === 'secondary'
      ? t('receipt.usingFallback')
      : progress && progress.attempt > 1
        ? t('receipt.retrying', { attempt: progress.attempt, attempts: progress.attempts })
        : t('receipt.processing');

  return (
    <main className="main-content max-w-[480px] flex flex-col items-center justify-center py-24 gap-4">
      <div role="status" aria-label={statusText} className="w-full max-w-[240px]">
        <div className="progress-bar-track">
          <div className="progress-bar-fill" />
        </div>
      </div>
      <p className="text-muted-foreground">{statusText}</p>
      <p className="text-xs text-muted-foreground">{t('receipt.processingHint')}</p>
    </main>
  );
}
