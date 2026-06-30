import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../context/LanguageContext';
import { LoadingState } from './LoadingState';

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('LoadingState', () => {
  it('renders default loading label', () => {
    wrap(<LoadingState />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders custom label', () => {
    wrap(<LoadingState label="Bitte warten…" />);
    expect(screen.getByText('Bitte warten…')).toBeInTheDocument();
  });

  it('has role="status" for a11y', () => {
    wrap(<LoadingState />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
