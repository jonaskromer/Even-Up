import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { useLanguage } from '../../context/LanguageContext';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { t } = useLanguage();
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('feedback.error')}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          {t('feedback.retry')}
        </Button>
      )}
    </Alert>
  );
}
