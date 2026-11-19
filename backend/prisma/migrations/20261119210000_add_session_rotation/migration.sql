-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "previousLookupToken" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Session_previousLookupToken_key" ON "Session"("previousLookupToken");
