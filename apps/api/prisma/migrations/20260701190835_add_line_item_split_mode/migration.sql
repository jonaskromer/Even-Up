-- AlterTable
ALTER TABLE "ReceiptLineItem" ADD COLUMN     "splitMode" TEXT NOT NULL DEFAULT 'shares';

-- AlterTable
ALTER TABLE "ReceiptLineItemAssignment" ADD COLUMN     "exactCents" INTEGER,
ADD COLUMN     "percent" DOUBLE PRECISION;
