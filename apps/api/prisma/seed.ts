import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Fixed UUIDs so this script is idempotent. These users only exist in this app's DB,
// not in Supabase Auth — to actually log in as one, create a Supabase Auth user with
// the matching UUID (Authentication → Users → Add User, set the user's id explicitly
// via the Admin API) and the email below.
const DEMO_USER_IDS = {
  demo: '00000000-0000-0000-0000-000000000001',
  anna: '00000000-0000-0000-0000-000000000002',
  ben: '00000000-0000-0000-0000-000000000003',
};

async function main() {
  const demo = await prisma.user.upsert({
    where: { email: 'demo@even-up.local' },
    update: {},
    create: {
      id: DEMO_USER_IDS.demo,
      email: 'demo@even-up.local',
      name: 'Demo User',
    },
  });

  const anna = await prisma.user.upsert({
    where: { email: 'anna@even-up.local' },
    update: {},
    create: {
      id: DEMO_USER_IDS.anna,
      email: 'anna@even-up.local',
      name: 'Anna',
    },
  });

  const ben = await prisma.user.upsert({
    where: { email: 'ben@even-up.local' },
    update: {},
    create: {
      id: DEMO_USER_IDS.ben,
      email: 'ben@even-up.local',
      name: 'Ben',
    },
  });

  const existingGroup = await prisma.group.findFirst({
    where: { members: { some: { userId: demo.id } } },
  });

  if (existingGroup) {
    console.log('Seed data already present, skipping group/expense creation.');
    return;
  }

  const group = await prisma.group.create({
    data: {
      name: 'Ski-Trip 2026',
      members: {
        createMany: {
          data: [{ userId: demo.id, role: 'owner' }, { userId: anna.id }, { userId: ben.id }],
        },
      },
    },
  });

  const memberIds = [demo.id, anna.id, ben.id];
  const expenses = [
    {
      description: 'Hüttenmiete',
      amountCents: 48000,
      originalAmountCents: 48000,
      originalCurrency: 'EUR',
      paidByUserId: demo.id,
      date: new Date('2026-03-20'),
    },
    {
      description: 'Skipass Tag 1',
      amountCents: 20000,
      originalAmountCents: 20000,
      originalCurrency: 'EUR',
      paidByUserId: anna.id,
      date: new Date('2026-03-21'),
    },
    {
      description: 'Apres-Ski Runde',
      amountCents: 7600,
      originalAmountCents: 7600,
      originalCurrency: 'EUR',
      paidByUserId: ben.id,
      date: new Date('2026-03-21'),
    },
    {
      // USD expense to demo multi-currency: $54 USD ≈ €50 EUR at 0.926 rate
      description: 'Ski-Ausrüstung (USD)',
      amountCents: 5000,
      originalAmountCents: 5400,
      originalCurrency: 'USD',
      paidByUserId: demo.id,
      date: new Date('2026-03-22'),
    },
  ];

  for (const exp of expenses) {
    const share = Math.round(exp.amountCents / memberIds.length);
    await prisma.expense.create({
      data: {
        groupId: group.id,
        description: exp.description,
        amountCents: exp.amountCents,
        originalAmountCents: exp.originalAmountCents,
        originalCurrency: exp.originalCurrency,
        paidByUserId: exp.paidByUserId,
        date: exp.date,
        splitMode: 'equal',
        splits: {
          createMany: {
            data: memberIds.map((uid) => ({ userId: uid, owedCents: share })),
          },
        },
      },
    });
  }

  console.log('Seed complete. Demo user: demo@even-up.local (see DEMO_USER_IDS comment to log in)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
