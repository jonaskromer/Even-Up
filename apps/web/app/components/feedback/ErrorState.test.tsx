import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../../context/LanguageContext';
import { ErrorState } from './ErrorState';

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('ErrorState', () => {
  it('renders the error message', () => {
    wrap(<ErrorState message="Server nicht erreichbar" />);
    expect(screen.getByText('Server nicht erreichbar')).toBeInTheDocument();
  });

  it('renders retry button and calls onRetry', async () => {
    const onRetry = vi.fn();
    wrap(<ErrorState message="Fehler" onRetry={onRetry} />);

    const btn = screen.getByRole('button', { name: 'Try again' });
    expect(btn).toBeInTheDocument();

    await userEvent.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not render retry button without onRetry', () => {
    wrap(<ErrorState message="Fehler" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
