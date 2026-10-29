-- CPF do motorista passa a ser opcional (o índice único por empresa aceita vários NULL).
ALTER TABLE "drivers" ALTER COLUMN "document" DROP NOT NULL;
