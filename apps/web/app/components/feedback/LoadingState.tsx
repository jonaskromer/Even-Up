import { Card, CardContent } from '../ui/card';
import { useLanguage } from '../../context/LanguageContext';

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label }: LoadingStateProps) {
  const { t } = useLanguage();
  return (
    <Card>
      <CardContent className="text-center py-8">
        <p className="text-muted-foreground mb-0" role="status" aria-live="polite">
          {label ?? t('feedback.loading')}
        </p>
      </CardContent>
    </Card>
  );
}
