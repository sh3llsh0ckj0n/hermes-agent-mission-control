const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

function cleanLine(line) {
  return line.replace(ANSI_ESCAPE, "").trim();
}

function classifyGatewayValue(value) {
  if (/\b(?:not\s+running|stopped|offline)\b/i.test(value)) return "stopped";
  if (/\b(?:running|online)\b/i.test(value)) return "running";
  return "unknown";
}

function isSectionHeader(line) {
  const clean = cleanLine(line);
  return Boolean(clean) && !clean.includes(":") && /^[^\p{L}\p{N}]*[\p{L}\p{N}]/u.test(clean);
}

export function parseGatewayStatus(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const gatewayIndex = lines.findIndex((line) =>
    /\bgateway\s+service\b/i.test(cleanLine(line)),
  );

  if (gatewayIndex >= 0) {
    for (let index = gatewayIndex + 1; index < lines.length; index += 1) {
      const line = cleanLine(lines[index]);
      if (!line) continue;
      if (isSectionHeader(lines[index])) break;

      const status = line.match(/^status\s*:\s*(.*)$/i);
      if (status) return classifyGatewayValue(status[1]);
    }

    const inline = cleanLine(lines[gatewayIndex]).match(
      /\bgateway\s+service\s*:\s*(.*)$/i,
    );
    return inline ? classifyGatewayValue(inline[1]) : "unknown";
  }

  const legacyLine = lines.find((line) => /\bgateway\b/i.test(cleanLine(line)));
  if (!legacyLine) return "unknown";
  const value = cleanLine(legacyLine).match(/\bgateway\s*:\s*(.*)$/i);
  return value ? classifyGatewayValue(value[1]) : "unknown";
}

export async function persistKanbanMirror({
  tasks,
  board,
  query,
  setStore,
  now = () => new Date(),
}) {
  const seen = new Set();
  for (const task of tasks) {
    const id = String(task.id ?? task.task_id ?? "");
    if (!id) continue;
    seen.add(id);
    await query(
      `INSERT INTO "HermesTask" (id, board, title, assignee, status, priority, result, "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, assignee=EXCLUDED.assignee, status=EXCLUDED.status,
         priority=EXCLUDED.priority, result=EXCLUDED.result, "syncedAt"=now()`,
      [
        id,
        board,
        String(task.title ?? "untitled").slice(0, 300),
        task.assignee ?? null,
        String(task.status ?? "todo"),
        task.priority != null ? Number(task.priority) : null,
        task.result ? String(task.result).slice(0, 2_000) : null,
      ],
    );
  }

  if (seen.size) {
    await query(`DELETE FROM "HermesTask" WHERE board=$1 AND id <> ALL($2::text[])`, [
      board,
      [...seen],
    ]);
  } else {
    await query(`DELETE FROM "HermesTask" WHERE board=$1`, [board]);
  }

  const marker = {
    board,
    total: seen.size,
    syncedAt: now().toISOString(),
  };
  await setStore("hermes-tasks", marker);
  return marker;
}
