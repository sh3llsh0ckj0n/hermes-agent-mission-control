-- Rollback for 1_mission_control_reconciliation.
--
-- Drops only the tables, triggers and function this migration created. No
-- existing table (AgentRequest, AgentEvent, HermesTask, DataStore, ...) is
-- touched. Run in one transaction, then remove the migration record so
-- `prisma migrate deploy` can re-apply it later:
--
--   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f rollback.sql
--
-- Data loss: the McReconciliation audit ledger and McEvent log are dropped.
-- Export them first if the rollback happens after the bridge has written rows:
--   \copy "McReconciliation" TO 'mc_reconciliation_backup.csv' CSV HEADER
--   \copy "McEvent" TO 'mc_event_backup.csv' CSV HEADER

DROP TABLE IF EXISTS "McEvent";
DROP TABLE IF EXISTS "McReconciliation";
DROP TABLE IF EXISTS "McApproval";
DROP TABLE IF EXISTS "McReceipt";
DROP TABLE IF EXISTS "McTaskState";
DROP TABLE IF EXISTS "McProject";
DROP FUNCTION IF EXISTS "mc_append_only"();

DELETE FROM "_prisma_migrations" WHERE migration_name = '1_mission_control_reconciliation';
