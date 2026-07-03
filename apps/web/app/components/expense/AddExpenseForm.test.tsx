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

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Alice', defaultMarkupRate: 0 } }),
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

describe('AddExpenseForm — default payer', () => {
  it('defaults the payer to the current user for a new expense', () => {
    wrap(
      <AddExpenseForm
        group={group}
        submitting={false}
        submitError={null}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    const payerSelect = document.getElementById('expense-payer') as HTMLSelectElement;
    expect(payerSelect.value).toBe('u1');
  });

  it('keeps the explicit payer from defaults when editing an existing expense', () => {
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
          paidByUserId: 'u2',
          splitMode: 'equal',
          date: '2026-01-01',
          splits: [
            { userId: 'u1', owedCents: 500 },
            { userId: 'u2', owedCents: 500 },
          ],
        }}
      />,
    );
    const payerSelect = document.getElementById('expense-payer') as HTMLSelectElement;
    expect(payerSelect.value).toBe('u2');
  });
});

describe('AddExpenseForm — payer excluded from an otherwise-equal split', () => {
  const threeMemberGroup: Group = {
    id: 'g2',
    name: 'Trip',
    currency: 'EUR',
    members: [
      { id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'owner' },
      { id: 'u2', name: 'Bob', email: 'bob@test.com', role: 'member' },
      { id: 'u3', name: 'Carol', email: 'carol@test.com', role: 'member' },
    ],
  };

  it('submits as "exact" (not "equal") when the payer opts out of the split, so only the remaining participants owe anything', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    wrap(
      <AddExpenseForm
        group={threeMemberGroup}
        submitting={false}
        submitError={null}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const descInput = document.getElementById('expense-desc') as HTMLInputElement;
    await user.type(descInput, 'Dinner');
    const amountInput = document.getElementById('expense-amount') as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, '30.00');

    // Alice is the default payer (current user) and starts as a participant too —
    // deselect her so only Bob and Carol split the cost she fronted.
    await user.click(screen.getByRole('button', { name: /Alice/ }));

    await user.click(screen.getByRole('button', { name: /save|speichern/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.paidByUserId).toBe('u1');
    // Sending 'equal' here would make the server re-divide the amount across all
    // three members (including Alice) and discard exactSplits entirely.
    expect(payload.splitMode).toBe('exact');
    expect(payload.exactSplits).toEqual(
      expect.arrayContaining([
        { userId: 'u2', owedCents: 1500 },
        { userId: 'u3', owedCents: 1500 },
      ]),
    );
    expect(payload.exactSplits).toHaveLength(2);
  });
});

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
