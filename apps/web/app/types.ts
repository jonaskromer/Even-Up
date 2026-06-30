export type SplitMode = 'equal' | 'exact' | 'percent' | 'shares';

export interface Member {
  id: string;
  name: string;
  email?: string;
  role?: string;
}

export interface Group {
  id: string;
  name: string;
  currency: string;
  members: Member[];
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  originalAmountCents: number;
  originalCurrency: string;
  appliedMarkupRate: number;
  paidByUserId: string;
  paidByName?: string;
  date: string;
  updatedAt: string;
  splitMode: SplitMode;
  splits?: { userId: string; owedCents: number }[];
}

export interface Balance {
  userId: string;
  name: string;
  email?: string;
  netCents: number;
}

export interface NewExpenseInput {
  groupId: string;
  description: string;
  amountCents: number;
  currency?: string;
  markupRate?: number;
  paidByUserId: string;
  date: string;
  splitMode: SplitMode;
  exactSplits?: { userId: string; owedCents: number }[];
}

export interface Settlement {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  fromUserName: string;
  toUserName: string;
  amountCents: number;
  date: string;
  note?: string;
  createdAt: string;
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export interface JoinRequest {
  id: string;
  groupId: string;
  groupName: string;
  invitedByName: string;
  createdAt: string;
}

export interface PendingInvite {
  id: string;
  invitedName: string;
  invitedEmail: string;
  createdAt: string;
}
