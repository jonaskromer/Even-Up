-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "receiptStoreName" TEXT;

-- CreateTable
CREATE TABLE "ReceiptLineItem" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "priceCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "excluded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReceiptLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLineItemAssignment" (
    "lineItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shareWeight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ReceiptLineItemAssignment_pkey" PRIMARY KEY ("lineItemId","userId")
);

-- CreateIndex
CREATE INDEX "ReceiptLineItem_expenseId_idx" ON "ReceiptLineItem"("expenseId");

-- AddForeignKey
ALTER TABLE "ReceiptLineItem" ADD CONSTRAINT "ReceiptLineItem_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLineItemAssignment" ADD CONSTRAINT "ReceiptLineItemAssignment_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "ReceiptLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
