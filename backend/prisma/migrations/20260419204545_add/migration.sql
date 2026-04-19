/*
  Warnings:

  - A unique constraint covering the columns `[lookupToken]` on the table `Session` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `lookupToken` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "lookupToken" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Session_lookupToken_key" ON "Session"("lookupToken");
