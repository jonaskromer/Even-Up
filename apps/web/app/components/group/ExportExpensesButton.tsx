import { useState } from 'react';
import { Group } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { downloadFile, ApiError } from '../../lib/apiClient';
import { Button } from '../ui/button';

interface ExportExpensesButtonProps {
  group: Group;
}

export function ExportExpensesButton({ group }: ExportExpensesButtonProps) {
  const { t } = useLanguage();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      await downloadFile(`/api/groups/${group.id}/expenses/export`, `${group.name}-expenses.csv`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('csv.exportError'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
        {exporting ? t('csv.exporting') : t('csv.exportButton')}
      </Button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
