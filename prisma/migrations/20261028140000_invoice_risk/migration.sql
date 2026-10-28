-- CreateTable
CREATE TABLE "InvoiceRisk" (
    "invoiceId" TEXT NOT NULL PRIMARY KEY,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "model" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvoiceRisk_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

