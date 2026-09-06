-- Meta WhatsApp Business Platform Connection V1
--
-- Makes a WhatsApp connection an auditable, per-tenant lifecycle rather than
-- "a token exists somewhere".
--
-- Three things this migration establishes:
--
--   1. Proof of subscription. `subscribedAt` / `subscriptionVerifiedAt` record that
--      POST /<WABA_ID>/subscribed_apps actually succeeded and that a later GET still
--      sees us on the edge. A callback URL existing proves nothing; a business can
--      revoke permissions and silently stop delivering webhooks.
--   2. Proof of liveness. `lastInboundEventAt` and `lastOutboundSuccessAt` are the
--      only honest inputs to a health indicator. Everything else is inference.
--   3. Delivery honesty. `messages.deliveryUncertainAt` marks a send that failed in a
--      way that does not prove non-delivery — a timeout, a reset connection, a 5xx
--      after the body was written. The Cloud API takes no idempotency key and offers
--      no lookup by client reference, so an automatic retry can send a real customer
--      a second copy. Marking uncertainty and stopping is the only correct behaviour.
--
-- One migration on purpose: the columns, the enums and the constraints are one
-- change. Splitting them would leave a deploy window where the code expects a column
-- the database does not have.

-- AlterEnum
-- DEGRADED sits between CONNECTED and ERROR: the connection works but a health
-- check found something wrong (subscription missing, token near expiry, number not
-- registered). Collapsing it into ERROR would make a real outage look like downtime;
-- collapsing it into CONNECTED would hide it entirely.
ALTER TYPE "ChannelStatus" ADD VALUE IF NOT EXISTS 'DEGRADED' BEFORE 'ERROR';

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "MetaTokenType" AS ENUM ('SYSTEM_USER', 'BUSINESS_INTEGRATION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "MetaConnectionMethod" AS ENUM ('MANUAL_TOKEN', 'EMBEDDED_SIGNUP', 'MOCK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: whatsapp_accounts — connection identity, token metadata, lifecycle
ALTER TABLE "whatsapp_accounts"
  ADD COLUMN IF NOT EXISTS "metaBusinessId" TEXT,
  ADD COLUMN IF NOT EXISTS "tokenType" "MetaTokenType",
  ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tokenUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "connectionMethod" "MetaConnectionMethod" NOT NULL DEFAULT 'MANUAL_TOKEN',
  ADD COLUMN IF NOT EXISTS "subscribedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "subscriptionVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastInboundEventAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastOutboundSuccessAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastHealthCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disconnectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disconnectedByMemberId" UUID,
  ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT;

-- AlterTable: whatsapp_phone_numbers — registration state and per-number liveness
ALTER TABLE "whatsapp_phone_numbers"
  ADD COLUMN IF NOT EXISTS "registeredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "registrationPinEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "codeVerificationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "platformType" TEXT,
  ADD COLUMN IF NOT EXISTS "throughputLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastOutboundAt" TIMESTAMP(3);

-- AlterTable: messages — the uncertain-delivery marker
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "deliveryUncertainAt" TIMESTAMP(3);

-- CreateIndex
-- A WhatsApp Business Account belongs to exactly one workspace, platform-wide.
-- Without this, two tenants could each hold a token for the same business and both
-- claim its phone numbers — and reconnecting would create a second account row
-- rather than updating the first. The pre-existing (workspaceId, wabaId) unique
-- constraint stays: it is what the reconnect upsert targets.
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_accounts_wabaId_key"
  ON "whatsapp_accounts"("wabaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_accounts_workspaceId_status_idx"
  ON "whatsapp_accounts"("workspaceId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_phone_numbers_workspaceId_status_idx"
  ON "whatsapp_phone_numbers"("workspaceId", "status");

-- CreateIndex
-- The account → numbers join runs on every connection overview read.
CREATE INDEX IF NOT EXISTS "whatsapp_phone_numbers_accountId_idx"
  ON "whatsapp_phone_numbers"("accountId");

-- AddForeignKey
-- SET NULL rather than CASCADE: if the member who disconnected the account later
-- leaves the workspace, the disconnection still happened. Losing the whole
-- connection record to preserve referential tidiness would destroy the audit trail.
DO $$
BEGIN
  ALTER TABLE "whatsapp_accounts"
    ADD CONSTRAINT "whatsapp_accounts_disconnectedByMemberId_fkey"
    FOREIGN KEY ("disconnectedByMemberId") REFERENCES "workspace_members"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: existing rows predate the concept of a connection method. Any account
-- already marked mock is a mock; everything else got there by a pasted token, which
-- is the only path that existed before this migration.
UPDATE "whatsapp_accounts"
   SET "connectionMethod" = 'MOCK'
 WHERE "isMock" = true;

UPDATE "whatsapp_accounts"
   SET "tokenType" = 'SYSTEM_USER',
       "tokenUpdatedAt" = "updatedAt"
 WHERE "accessTokenEncrypted" IS NOT NULL
   AND "isMock" = false
   AND "tokenType" IS NULL;
