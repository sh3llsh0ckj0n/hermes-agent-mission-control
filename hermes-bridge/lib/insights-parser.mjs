import { stripVTControlCharacters } from "node:util";

const BOX_VERTICAL = /[\u2502\u2503\u2551]/;
const BOX_DRAWING = /[\u2500-\u257f]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const STRICT_INTEGER = /^(?:\d{1,3}(?:,\d{3})*|\d+)$/;

function cleanCell(value) {
  return value
    .replace(BOX_DRAWING, " ")
    .replace(/^[^A-Za-z0-9$]+/u, "")
    .trim();
}

function lineCells(line) {
  const cells = line.split(BOX_VERTICAL).map(cleanCell);
  while (cells[0] === "") cells.shift();
  while (cells.at(-1) === "") cells.pop();
  return cells;
}

function parseInteger(value) {
  const normalized = value.trim();
  if (!STRICT_INTEGER.test(normalized)) return null;
  const parsed = Number(normalized.replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labeledValue(cell, label) {
  const escaped = escapePattern(label);
  const delimited = cell.match(new RegExp(`^${escaped}\\s*[:=]\\s*(.+)$`, "i"));
  if (delimited) return delimited[1].trim();

  const spaced = cell.match(new RegExp(`^${escaped}\\s+(.+)$`, "i"));
  return spaced ? spaced[1].trim() : null;
}

function uniqueValue(values) {
  const unique = [...new Set(values.filter((value) => value !== null))];
  return unique.length === 1 ? unique[0] : null;
}

function integerMetric(cells, labels) {
  const values = [];
  for (const cell of cells) {
    for (const label of labels) {
      const value = labeledValue(cell, label);
      if (value !== null) values.push(parseInteger(value));
    }
  }
  return uniqueValue(values);
}

function parsePeriod(cells) {
  const values = [];
  for (const cell of cells) {
    for (const label of ["Reporting period", "Period"]) {
      const value = labeledValue(cell, label);
      if (value) values.push(value);
    }
  }

  const label = uniqueValue(values);
  if (!label) return { label: null, start: null, end: null, days: null };

  const dates = label.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const daysMatch = label.match(/\b(\d{1,3}(?:,\d{3})*|\d+)\s+days?\b/i);
  return {
    label,
    start: dates[0] ?? null,
    end: dates[1] ?? null,
    days: daysMatch ? parseInteger(daysMatch[1]) : null,
  };
}

function parseExplicitCost(cells) {
  const values = [];
  for (const cell of cells) {
    const value = labeledValue(cell, "Total cost");
    if (!value) continue;

    const match = value.match(
      /^(?:USD\s*)?\$\s*(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?$|^USD\s+(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?$/i,
    );
    if (!match) {
      values.push(null);
      continue;
    }

    const parsed = Number(`${match[1] ?? match[3]}${match[2] ?? match[4] ?? ""}`.replaceAll(",", ""));
    values.push(Number.isFinite(parsed) && parsed >= 0 ? parsed : null);
  }
  return uniqueValue(values);
}

function joinWrappedModel(prefix, model) {
  if (!prefix) return model;
  return /[-/]$/.test(prefix) ? `${prefix}${model}` : `${prefix} ${model}`;
}

function mergeModel(rows, row) {
  const existing = rows.find((candidate) => candidate.model === row.model);
  if (!existing) {
    rows.push(row);
    return;
  }
  if (existing.sessions !== row.sessions) existing.sessions = null;
  if (existing.tokens !== row.tokens) existing.tokens = null;
}

function parseModelUsage(lines) {
  const models = [];
  let columns = null;
  let inModelSection = false;
  let pendingModel = "";

  for (const line of lines) {
    const cells = lineCells(line);
    const nonEmpty = cells.filter(Boolean);
    if (!nonEmpty.length) continue;

    const explicit = nonEmpty.join(" | ").match(
      /^Model\s*:\s*(.+?)\s*\|\s*Sessions\s*:\s*([\d,]+)\s*\|\s*Tokens\s*:\s*([\d,]+)$/i,
    );
    if (explicit) {
      const sessions = parseInteger(explicit[2]);
      const tokens = parseInteger(explicit[3]);
      if (sessions !== null || tokens !== null) {
        mergeModel(models, {
          model: explicit[1].trim(),
          sessions,
          tokens,
        });
      }
      continue;
    }

    const normalized = cells.map((cell) => cell.toLowerCase().replace(/\s+/g, " "));
    const modelIndex = normalized.findIndex((cell) => /^(?:model|model name)$/.test(cell));
    const sessionsIndex = normalized.findIndex((cell) => cell === "sessions");
    const tokensIndex = normalized.findIndex((cell) => cell === "tokens");
    if (modelIndex >= 0 && sessionsIndex >= 0 && tokensIndex >= 0) {
      columns = { modelIndex, sessionsIndex, tokensIndex };
      inModelSection = true;
      pendingModel = "";
      continue;
    }

    const single = nonEmpty.join(" ").replace(/\s+/g, " ").trim();
    if (/^(?:model usage|usage by model|models)$/i.test(single)) {
      inModelSection = true;
      pendingModel = "";
      continue;
    }
    if (/^(?:platforms?|top tools?|active days?|peak hours?|usage totals?|summary)\b/i.test(single)) {
      columns = null;
      inModelSection = false;
      pendingModel = "";
      continue;
    }
    if (!inModelSection) continue;

    if (columns) {
      const modelPart = cells[columns.modelIndex] ?? "";
      const sessions = parseInteger(cells[columns.sessionsIndex] ?? "");
      const tokens = parseInteger(cells[columns.tokensIndex] ?? "");
      if (sessions !== null || tokens !== null) {
        const model = joinWrappedModel(pendingModel, modelPart).trim();
        if (model) mergeModel(models, { model, sessions, tokens });
        pendingModel = "";
      } else if (modelPart) {
        pendingModel = joinWrappedModel(pendingModel, modelPart);
      }
      continue;
    }

    const row = single.match(/^(.+?)\s{2,}([\d,]+)\s{2,}([\d,]+)$/);
    if (row) {
      const sessions = parseInteger(row[2]);
      const tokens = parseInteger(row[3]);
      const model = joinWrappedModel(pendingModel, row[1].trim());
      if (model && (sessions !== null || tokens !== null)) {
        mergeModel(models, { model, sessions, tokens });
      }
      pendingModel = "";
    } else if (!/\d/.test(single)) {
      pendingModel = joinWrappedModel(pendingModel, single);
    }
  }

  return models;
}

export function sanitizeInsightsOutput(output) {
  return stripVTControlCharacters(String(output ?? ""))
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS, "")
    .replaceAll("\u00a0", " ");
}

export function parseHermesInsights(output) {
  const sanitized = sanitizeInsightsOutput(output);
  const lines = sanitized.split("\n");
  const cells = lines.flatMap((line) => lineCells(line)).filter(Boolean);

  return {
    period: parsePeriod(cells),
    totalSessions: integerMetric(cells, ["Total sessions", "Sessions"]),
    totalMessages: integerMetric(cells, ["Total messages", "Messages"]),
    userMessages: integerMetric(cells, ["User messages"]),
    toolCalls: integerMetric(cells, ["Tool calls"]),
    inputTokens: integerMetric(cells, ["Input tokens"]),
    outputTokens: integerMetric(cells, ["Output tokens"]),
    totalTokens: integerMetric(cells, ["Total tokens"]),
    totalCost: parseExplicitCost(cells),
    byModel: parseModelUsage(lines),
  };
}
