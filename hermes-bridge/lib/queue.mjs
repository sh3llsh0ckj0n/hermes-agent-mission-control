import { claimableRequestKinds } from "./request-policy.mjs";
import { ValidationError } from "./errors.mjs";

export const CLAIM_REQUESTS_SQL = `
WITH candidates AS (
  SELECT id
  FROM "AgentRequest"
  WHERE
    (status = 'queued' AND kind = ANY($1::text[]))
    OR
    (status = 'approved' AND kind = ANY($2::text[]))
  ORDER BY "createdAt" ASC, id ASC
  LIMIT $3
  FOR UPDATE SKIP LOCKED
)
UPDATE "AgentRequest" AS request
SET
  status = 'running',
  "sideEffecting" = request.kind = ANY($2::text[]),
  "startedAt" = now(),
  "updatedAt" = now()
FROM candidates
WHERE request.id = candidates.id
RETURNING request.*
`;

export async function claimRequests(pool, { batchSize = 1 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
    throw new ValidationError("Queue claim batch size must be between 1 and 10");
  }

  const client = await pool.connect();
  const kinds = claimableRequestKinds();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(CLAIM_REQUESTS_SQL, [
      kinds.safe,
      kinds.approved,
      batchSize,
    ]);
    await client.query("COMMIT");
    return rows.sort((left, right) => {
      const created = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return created || String(left.id).localeCompare(String(right.id));
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
