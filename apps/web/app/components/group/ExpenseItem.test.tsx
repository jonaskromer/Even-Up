import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../context/LanguageContext';
import { ExpenseItem } from './ExpenseItem';
import type { Group, Expense } from '../../types';

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Alice', defaultMarkupRate: 0 } }),
}));

vi.mock('../../lib/apiClient', () => ({
  api: { delete: vi.fn().mockResolvedValue(undefined) },
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

const baseExpense: Expense = {
  id: 'e1',
  groupId: 'g1',
  description: 'Dinner',
  amountCents: 2000,
  originalAmountCents: 2000,
  originalCurrency: 'EUR',
  appliedMarkupRate: 0,
  paidByUserId: 'u1',
  paidByName: 'Alice',
  date: '2026-01-01',
  splitMode: 'equal',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('ExpenseItem', () => {
  it('renders the expense description', () => {
    wrap(<ExpenseItem expense={baseExpense} group={group} showConverted onDeleted={() => {}} />);
    expect(screen.getByText('Dinner')).toBeInTheDocument();
  });

  it('shows "you paid" label when current user is the payer', () => {
    wrap(<ExpenseItem expense={baseExpense} group={group} showConverted onDeleted={() => {}} />);
    // The translated text for 'expense.item.youPaid' — check something payer-related appears
    const container = screen.getByText('Dinner').closest('.expense-item');
    expect(container).toBeTruthy();
    // "You paid" or German equivalent should be somewhere in the item
    expect(container!.textContent).toMatch(/you paid|du hast bezahlt/i);
  });

  it('shows payer name when someone else paid', () => {
    const expense: Expense = { ...baseExpense, paidByUserId: 'u2', paidByName: 'Bob' };
    wrap(<ExpenseItem expense={expense} group={group} showConverted onDeleted={() => {}} />);
    const container = screen.getByText('Dinner').closest('.expense-item');
    expect(container!.textContent).toContain('Bob');
  });

  it('showConverted=true: primary amount displayed in group currency (EUR)', () => {
    wrap(<ExpenseItem expense={baseExpense} group={group} showConverted onDeleted={() => {}} />);
    // amountCents=2000 EUR → should show something like "20,00 €"
    const container = screen.getByText('Dinner').closest('.expense-item');
    expect(container!.textContent).toContain('€');
  });

  it('showConverted=false: primary amount displayed in original currency', () => {
    const expense: Expense = {
      ...baseExpense,
      amountCents: 2200,
      originalAmountCents: 2000,
      originalCurrency: 'USD',
    };
    wrap(
      <ExpenseItem expense={expense} group={group} showConverted={false} onDeleted={() => {}} />,
    );
    // Original is USD → should show "$" somewhere in the amount box
    const container = screen.getByText('Dinner').closest('.expense-item');
    expect(container!.textContent).toContain('$');
  });

  it('does not show secondary amount when currencies are the same', () => {
    // EUR expense in an EUR group — no secondary line expected
    wrap(<ExpenseItem expense={baseExpense} group={group} showConverted onDeleted={() => {}} />);
    // There should be no element with "text-xs text-muted-foreground font-normal" showing a second amount
    const amountBox = screen
      .getByText('Dinner')
      .closest('.expense-item')
      ?.querySelector('.expense-amount-box');
    // There should be no USD symbol since this is a same-currency EUR expense
    expect(amountBox?.textContent).not.toContain('$');
  });

  it('shows secondary amount when originalCurrency differs from group currency', () => {
    const expense: Expense = {
      ...baseExpense,
      amountCents: 2200,
      originalAmountCents: 2000,
      originalCurrency: 'USD',
    };
    wrap(<ExpenseItem expense={expense} group={group} showConverted onDeleted={() => {}} />);
    const amountBox = screen
      .getByText('Dinner')
      .closest('.expense-item')
      ?.querySelector('.expense-amount-box');
    // When showConverted=true: primary=EUR, secondary=USD
    expect(amountBox?.textContent).toContain('€');
    expect(amountBox?.textContent).toContain('$');
  });

  it('shows markup hint when appliedMarkupRate > 0', () => {
    const expense: Expense = { ...baseExpense, appliedMarkupRate: 2 };
    wrap(<ExpenseItem expense={expense} group={group} showConverted onDeleted={() => {}} />);
    const amountBox = screen
      .getByText('Dinner')
      .closest('.expense-item')
      ?.querySelector('.expense-amount-box');
    expect(amountBox?.textContent).toMatch(/incl\. 2%/);
  });

  it('does not show markup hint when appliedMarkupRate is 0', () => {
    wrap(<ExpenseItem expense={baseExpense} group={group} showConverted onDeleted={() => {}} />);
    const amountBox = screen
      .getByText('Dinner')
      .closest('.expense-item')
      ?.querySelector('.expense-amount-box');
    expect(amountBox?.textContent).not.toMatch(/incl\./);
  });

  it('uses the actual stored split, not an equal division, for the "you get" amount', () => {
    // Alice (the mocked current user, u1) paid 100.00. Her own exact share is only
    // 10.00, so she's owed back 90.00 from Bob — an equal division across 2 members
    // would wrongly show 50.00 instead.
    const expense: Expense = {
      ...baseExpense,
      amountCents: 10000,
      originalAmountCents: 10000,
      splitMode: 'exact',
      splits: [
        { userId: 'u1', owedCents: 1000 },
        { userId: 'u2', owedCents: 9000 },
      ],
    };
    wrap(<ExpenseItem expense={expense} group={group} showConverted onDeleted={() => {}} />);
    const amountBox = screen
      .getByText('Dinner')
      .closest('.expense-item')
      ?.querySelector('.expense-amount-box');
    expect(amountBox?.textContent).toContain('90,00');
    expect(amountBox?.textContent).not.toContain('50,00');
  });

  it('uses the actual stored split, not an equal division, for the "you owe" amount', () => {
    // Bob paid 100.00; Alice's (the mocked current user) exact share is only 10.00,
    // so she owes 10.00 — an equal division across 2 members would wrongly show 50.00.
    const expense: Expense = {
      ...baseExpense,
      paidByUserId: 'u2',
      paidByName: 'Bob',
      amountCents: 10000,
      originalAmountCents: 10000,
      splitMode: 'exact',
      splits: [
        { userId: 'u1', owedCents: 1000 },
        { userId: 'u2', owedCents: 9000 },
      ],
    };
    wrap(<ExpenseItem expense={expense} group={group} showConverted onDeleted={() => {}} />);
    const amountBox = screen
      .getByText('Dinner')
      .closest('.expense-item')
      ?.querySelector('.expense-amount-box');
    expect(amountBox?.textContent).toContain('10,00');
    expect(amountBox?.textContent).not.toContain('50,00');
  });

  it('renders edit and delete buttons', () => {
    wrap(<ExpenseItem expense={baseExpense} group={group} showConverted onDeleted={() => {}} />);
    // Edit link
    const editLink = screen.getByRole('link');
    expect(editLink).toHaveAttribute('href', expect.stringContaining('edit'));
    // Delete button (only button in the item)
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
