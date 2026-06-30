-- AlterTable: User — add preferred currency
ALTER TABLE "User" ADD COLUMN "preferredCurrency" TEXT NOT NULL DEFAULT 'EUR';

-- AlterTable: Group — add standard currency
ALTER TABLE "Group" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EUR';

-- AlterTable: Expense — add original amount/currency fields
-- originalAmountCents defaults to the existing amountCents value for existing rows
ALTER TABLE "Expense" ADD COLUMN "originalAmountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN "originalCurrency" TEXT NOT NULL DEFAULT 'EUR';
UPDATE "Expense" SET "originalAmountCents" = "amountCents" WHERE "originalAmountCents" = 0;

-- CreateTable: ExchangeRate cache
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique rate per date+pair
CREATE UNIQUE INDEX "ExchangeRate_date_fromCurrency_toCurrency_key" ON "ExchangeRate"("date", "fromCurrency", "toCurrency");
