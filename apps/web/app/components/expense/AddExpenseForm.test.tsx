import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../../context/LanguageContext';
import { AddExpenseForm } from './AddExpenseForm';
import type { Group } from '../../types';

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const group: Group = {
  id: 'g1',
  name: 'Trip',
  currency: 'EUR',
  members: [
    { id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'owner' },
    { id: 'u2', name: 'Bob', email: 'bob@test.com', role: 'member' },
  ],
};

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

// Locates the split-section row's number input for a given member — the same name
// also appears as participant-toggle button text, so we must disambiguate by
// targeting the <span> the split-row renders the name in (the toggle button has no
// wrapping span around the name).
function splitRowInput(memberName: string): HTMLInputElement {
  const nameSpan = screen
    .getAllByText(memberName)
    .find((el) => el.tagName === 'SPAN' && el.className.includes('truncate'));
  if (!nameSpan) throw new Error(`No split row found for ${memberName}`);
  const row = nameSpan.closest('div')!;
  const input = row.querySelector('input');
  if (!input) throw new Error(`No input found in split row for ${memberName}`);
  return input as HTMLInputElement;
}

describe('AddExpenseForm — exact split participant toggling', () => {
  it('restores a participant’s exact amount after toggling them off and back on', async () => {
    const user = userEvent.setup();
    wrap(
      <AddExpenseForm
        group={group}
        submitting={false}
        submitError={null}
        onCancel={() => {}}
        onSubmit={() => {}}
        defaults={{
          description: 'Dinner',
          amountCents: 1000,
          paidByUserId: 'u1',
          splitMode: 'exact',
          date: '2026-01-01',
          splits: [
            { userId: 'u1', owedCents: 700 },
            { userId: 'u2', owedCents: 300 },
          ],
        }}
      />,
    );

    expect(splitRowInput('Bob').value).toBe('3.00');

    // Toggle Bob off, then back on — his original 3.00 must come back, not a reset 0.00.
    await user.click(screen.getByRole('button', { name: /Bob/ }));
    await user.click(screen.getByRole('button', { name: /Bob/ }));

    expect(splitRowInput('Bob').value).toBe('3.00');
  });

  it('shows no "remaining/too much" feedback once a toggle round-trip restores balance', async () => {
    const user = userEvent.setup();
    wrap(
      <AddExpenseForm
        group={group}
        submitting={false}
        submitError={null}
        onCancel={() => {}}
        onSubmit={() => {}}
        defaults={{
          description: 'Dinner',
          amountCents: 1000,
          paidByUserId: 'u1',
          splitMode: 'exact',
          date: '2026-01-01',
          splits: [
            { userId: 'u1', owedCents: 700 },
            { userId: 'u2', owedCents: 300 },
          ],
        }}
      />,
    );

    // Initially balanced (700 + 300 = 1000): no "remaining"/"too much" feedback shown.
    // The "complete" state itself is intentionally silent — no green success line.
    expect(screen.queryByText(/remaining|übrig|too much|zu viel/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Bob/ }));
    // With Bob removed, only Alice's 700 remains against a 1000 total — feedback appears.
    expect(screen.getByText(/remaining|übrig/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Bob/ }));
    // Balanced again once Bob (and his original 3.00) is restored — feedback gone again.
    expect(screen.queryByText(/remaining|übrig|too much|zu viel/i)).not.toBeInTheDocument();
  });

  it('keeps a manually edited amount when a different participant is toggled', async () => {
    const user = userEvent.setup();
    wrap(
      <AddExpenseForm
        group={group}
        submitting={false}
        submitError={null}
        onCancel={() => {}}
        onSubmit={() => {}}
        defaults={{
          description: 'Dinner',
          amountCents: 1000,
          paidByUserId: 'u1',
          splitMode: 'exact',
          date: '2026-01-01',
          splits: [
            { userId: 'u1', owedCents: 700 },
            { userId: 'u2', owedCents: 300 },
          ],
        }}
      />,
    );

    const aliceInput = splitRowInput('Alice');
    await user.clear(aliceInput);
    await user.type(aliceInput, '5.5');

    // Toggling Bob off and back on must not clobber Alice's freshly typed value.
    await user.click(screen.getByRole('button', { name: /Bob/ }));
    await user.click(screen.getByRole('button', { name: /Bob/ }));

    expect(splitRowInput('Alice').value).toBe('5.5');
  });
});
