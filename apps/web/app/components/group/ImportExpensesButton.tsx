import { useRef, useState } from 'react';
import { Group, Member } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../lib/apiClient';
import { Button } from '../ui/button';

interface ParsedExpense {
  date: string;
  description: string;
  amountCents: number;
  paidByUserId: string;
  paidByName: string;
  exactSplits: { userId: string; owedCents: number }[];
  warning?: string;
}

interface ImportExpensesButtonProps {
  group: Group;
  onImported: () => void;
}

function parseCsvDate(s: string): string {
  const parts = s.split('/').map(Number);
  if (parts.length !== 3) throw new Error('Invalid date');
  const [m, d, y] = parts;
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function matchMember(csvName: string, members: Member[]): Member | undefined {
  const lower = csvName.toLowerCase().trim();
  return (
    members.find((m) => m.name.toLowerCase() === lower) ??
    members.find((m) => m.name.toLowerCase().split(' ')[0] === lower.split(' ')[0])
  );
}

function parseCsv(
  text: string,
  members: Member[],
  unknownPayer: string,
  payerError: string,
  sumMismatch: (actual: string, expected: string) => string,
): { expenses: ParsedExpense[]; unmatchedColumns: string[] } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { expenses: [], unmatchedColumns: [] };

  const headers = lines[0].split(',').map((h) => h.trim());
  const memberHeaders = headers.slice(3);
  const columnMembers = memberHeaders.map((h) => matchMember(h, members));
  const unmatchedColumns = memberHeaders.filter((_, i) => !columnMembers[i]);

  const expenses: ParsedExpense[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const [dateStr, description, costStr, ...memberValues] = cols;

    if (!dateStr || !description || !costStr) continue;

    const amountCents = Math.round(parseFloat(costStr) * 100);
    if (isNaN(amountCents) || amountCents <= 0) continue;

    let date: string;
    try {
      date = parseCsvDate(dateStr);
    } catch {
      continue;
    }

    let payerIdx = -1;
    let maxPositive = 0;
    for (let j = 0; j < memberValues.length; j++) {
      const v = parseFloat(memberValues[j]);
      if (!isNaN(v) && v > 0 && v > maxPositive) {
        maxPositive = v;
        payerIdx = j;
      }
    }

    if (payerIdx === -1 || !columnMembers[payerIdx]) {
      expenses.push({
        date,
        description,
        amountCents,
        paidByUserId: '',
        paidByName: unknownPayer,
        exactSplits: [],
        warning: payerError,
      });
      continue;
    }

    const payer = columnMembers[payerIdx]!;
    const payerNetCents = Math.round(parseFloat(memberValues[payerIdx]) * 100);

    const exactSplits: { userId: string; owedCents: number }[] = [];
    for (let j = 0; j < memberValues.length; j++) {
      const member = columnMembers[j];
      if (!member) continue;
      const valueCents = Math.round(parseFloat(memberValues[j]) * 100);
      const owedCents = j === payerIdx ? amountCents - payerNetCents : Math.abs(valueCents);
      exactSplits.push({ userId: member.id, owedCents });
    }

    const splitsSum = exactSplits.reduce((s, sp) => s + sp.owedCents, 0);
    const warning =
      Math.abs(splitsSum - amountCents) > 2
        ? sumMismatch((splitsSum / 100).toFixed(2), (amountCents / 100).toFixed(2))
        : undefined;

    expenses.push({
      date,
      description,
      amountCents,
      paidByUserId: payer.id,
      paidByName: payer.name,
      exactSplits,
      warning,
    });
  }

  return { expenses, unmatchedColumns };
}

function formatEuro(cents: number) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

export function ImportExpensesButton({ group, onImported }: ImportExpensesButtonProps) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedExpense[] | null>(null);
  const [unmatchedColumns, setUnmatchedColumns] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { expenses, unmatchedColumns: unmatched } = parseCsv(
        text,
        group.members,
        t('csv.unknownPayer'),
        t('csv.payerError'),
        (actual, expected) => t('csv.sumMismatch', { actual, expected }),
      );
      setPreview(expenses);
      setUnmatchedColumns(unmatched);
      setResult(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    let imported = 0;
    let failed = 0;

    const valid = preview.filter((e) => e.paidByUserId && !e.warning);
    for (const expense of valid) {
      try {
        await api.post(`/api/groups/${group.id}/expenses`, {
          description: expense.description,
          amountCents: expense.amountCents,
          paidByUserId: expense.paidByUserId,
          date: expense.date,
          splitMode: 'exact',
          exactSplits: expense.exactSplits,
        });
        imported++;
      } catch {
        failed++;
      }
    }

    setImporting(false);
    setResult({ imported, failed });
    setPreview(null);
    if (imported > 0) onImported();
  }

  const validCount = preview?.filter((e) => e.paidByUserId && !e.warning).length ?? 0;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
      />

      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        <span className="hidden sm:inline">{t('csv.button')}</span>
        <span className="sm:hidden">{t('csv.buttonShort')}</span>
      </Button>

      {result && (
        <p className="text-xs text-muted-foreground mt-1">
          {t('csv.resultSuccess', { n: result.imported })}
          {result.failed > 0 ? t('csv.resultFailed', { n: result.failed }) : ''}
        </p>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="font-semibold text-lg">{t('csv.previewTitle')}</h2>
              <button
                onClick={() => setPreview(null)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {unmatchedColumns.length > 0 && (
              <div className="px-4 pt-3">
                <p className="text-sm text-amber-600">
                  {t('csv.unmatched', { cols: unmatchedColumns.join(', ') })}
                </p>
              </div>
            )}

            <div className="overflow-y-auto flex-1 p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="pb-2 pr-3 font-normal">{t('csv.columnDate')}</th>
                    <th className="pb-2 pr-3 font-normal">{t('csv.columnDesc')}</th>
                    <th className="pb-2 pr-3 text-right font-normal">{t('csv.columnAmount')}</th>
                    <th className="pb-2 font-normal">{t('csv.columnPayer')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((e, i) => (
                    <tr
                      key={i}
                      className={`border-b last:border-0 ${e.warning ? 'opacity-40' : ''}`}
                    >
                      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{e.date}</td>
                      <td className="py-2 pr-3">
                        {e.description}
                        {e.warning && (
                          <span className="block text-xs text-red-500">{e.warning}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-mono">
                        {formatEuro(e.amountCents)}
                      </td>
                      <td className="py-2">{e.paidByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t flex gap-3 justify-end items-center">
              {preview.length - validCount > 0 && (
                <p className="text-xs text-muted-foreground mr-auto">
                  {t('csv.skipped', { n: preview.length - validCount })}
                </p>
              )}
              <Button variant="outline" onClick={() => setPreview(null)} disabled={importing}>
                {t('csv.cancel')}
              </Button>
              <Button onClick={handleImport} disabled={importing || validCount === 0}>
                {importing ? t('csv.importing') : t('csv.import', { n: validCount })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
