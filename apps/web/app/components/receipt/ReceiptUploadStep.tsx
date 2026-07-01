import { useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';

interface ReceiptUploadStepProps {
  onFileSelected: (file: File) => void;
  onManualEntry: () => void;
  onCancel: () => void;
  error?: string | null;
}

export function ReceiptUploadStep({
  onFileSelected,
  onManualEntry,
  onCancel,
  error,
}: ReceiptUploadStepProps) {
  const { t } = useLanguage();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFileSelected(file);
  }

  return (
    <main className="main-content max-w-[480px]">
      <header className="mb-8">
        <h1 className="text-h1">{t('receipt.uploadTitle')}</h1>
        <p className="text-muted-foreground">{t('receipt.uploadSubtitle')}</p>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6 space-y-3">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleChange}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleChange}
          />

          <Button className="w-full" onClick={() => cameraRef.current?.click()}>
            {t('receipt.takePhoto')}
          </Button>
          <Button className="w-full" variant="outline" onClick={() => libraryRef.current?.click()}>
            {t('receipt.chooseFile')}
          </Button>
          <Button className="w-full" variant="ghost" onClick={onManualEntry}>
            {t('receipt.enterManually')}
          </Button>
          <Button className="w-full" variant="ghost" onClick={onCancel}>
            {t('receipt.cancel')}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
