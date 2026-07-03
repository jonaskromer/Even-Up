import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../../context/LanguageContext';
import { ExportExpensesButton } from './ExportExpensesButton';
import type { Group } from '../../types';

const downloadFile = vi.fn();

vi.mock('../../lib/apiClient', () => ({
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const group: Group = {
  id: 'g1',
  name: 'Ski Trip',
  currency: 'EUR',
  members: [{ id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'owner' }],
};

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('ExportExpensesButton', () => {
  it('downloads the group export CSV with a sensible fallback filename', async () => {
    downloadFile.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    wrap(<ExportExpensesButton group={group} />);

    await user.click(screen.getByRole('button'));

    expect(downloadFile).toHaveBeenCalledWith(
      '/api/groups/g1/expenses/export',
      'Ski Trip-expenses.csv',
    );
  });

  it('shows an error message when the download fails', async () => {
    const { ApiError } = await import('../../lib/apiClient');
    downloadFile.mockRejectedValueOnce(new ApiError('403 Forbidden', 403));
    const user = userEvent.setup();
    wrap(<ExportExpensesButton group={group} />);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText('403 Forbidden')).toBeInTheDocument());
  });
});
