ALTER TABLE "gate_passes"
  ADD COLUMN "visitTime" TEXT,
  ADD COLUMN "visitorName" TEXT,
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "vehicleType" TEXT,
  ADD COLUMN "vehicleNumber" TEXT,
  ADD COLUMN "driverName" TEXT,
  ADD COLUMN "driverMobile" TEXT,
  ADD COLUMN "materialMovement" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "gatePassType" TEXT NOT NULL DEFAULT 'NON_RETURNABLE',
  ADD COLUMN "photoProofPath" TEXT,
  ADD COLUMN "remarks" TEXT;
