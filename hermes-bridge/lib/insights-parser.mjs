import { stripVTControlCharacters } from "node:util";

const BOX_VERTICAL = /[\u2502\u2503\u2551]/;
const BOX_DRAWING = /[\u2500-\u257f]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const STRICT_INTEGER = /^(?:\d{1,3}(?:,\d{3})*|\d+)$/;
const METRIC_LABELS = [
  "Total sessions",
  "Total messages",
  "User messages",
  "Input tokens",
  "Output tokens",
  "Total tokens",
  "Tool calls",
  "Sessions",
  "Messages",
];
const INSIGHTS_SECTIONS =
  /^(?:overview|models used|model usage|usage by model|models|platforms?|top tools?|top skills?|activity patterns?|notable sessions?|active days?|peak hours?|usage totals?|summary)\b/i;
const MODEL_SECTION_END =
  /^(?:platforms?|top tools?|top skills?|activity patterns?|notable sessions?|active days?|peak hours?|usage totals?|summary)\b/i;
const ENGLISH_MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);
const ENGLISH_MONTH_PATTERN =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

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

function metricLines(lines) {
  const overviewIndex = lines.findIndex((line) =>
    lineCells(line).some((cell) => /^overview$/i.test(cell)),
  );
  if (overviewIndex < 0) return lines;

  const overview = [];
  for (const line of lines.slice(overviewIndex + 1)) {
    const cells = lineCells(line);
    if (cells.some((cell) => INSIGHTS_SECTIONS.test(cell))) break;
    overview.push(line);
  }
  return overview;
}

function parseOverviewMetrics(lines) {
  const values = new Map(METRIC_LABELS.map((label) => [label.toLowerCase(), []]));
  const labelsPattern = METRIC_LABELS.map(escapePattern).join("|");
  const metricPattern = new RegExp(
    `(?:^|\\s)(${labelsPattern})\\s*(?::|=)?\\s*((?:\\d{1,3}(?:,\\d{3})*|\\d+))(?=\\s*(?:(?:${labelsPattern})\\s*(?::|=)?|$))`,
    "gi",
  );

  for (const line of metricLines(lines)) {
    for (const cell of lineCells(line)) {
      for (const match of cell.matchAll(metricPattern)) {
        values.get(match[1].toLowerCase())?.push(parseInteger(match[2]));
      }
    }
  }

  return values;
}

function integerMetric(metrics, labels) {
  return uniqueValue(
    labels.flatMap((label) => metrics.get(label.toLowerCase()) ?? []),
  );
}

function formatDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseIsoDate(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? formatDate(Number(match[1]), Number(match[2]), Number(match[3]))
    : null;
}

function parseEnglishDate(value) {
  const match = value.match(
    new RegExp(`^(${ENGLISH_MONTH_PATTERN})\\s+(\\d{1,2}),\\s+(\\d{4})$`, "i"),
  );
  if (!match) return null;
  const month = ENGLISH_MONTHS.get(match[1].toLowerCase()) ?? null;
  return month
    ? formatDate(Number(match[3]), month, Number(match[2]))
    : null;
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

  const isoDates = label.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const englishDates = [
    ...label.matchAll(
      new RegExp(
        `\\b((?:${ENGLISH_MONTH_PATTERN})\\s+\\d{1,2},\\s+\\d{4})\\b`,
        "gi",
      ),
    ),
  ].map((match) => match[1]);
  const parsedDates =
    isoDates.length === 2
      ? isoDates.map(parseIsoDate)
      : englishDates.length === 2
        ? englishDates.map(parseEnglishDate)
        : [];
  const dayValues = cells.flatMap((cell) => {
    const match = cell.match(
      /^(?:last|past)\s+(\d{1,3}(?:,\d{3})*|\d+)\s+days?$/i,
    );
    return match ? [parseInteger(match[1])] : [];
  });
  const labelDays = label.match(
    /\b(?:last|past)\s+(\d{1,3}(?:,\d{3})*|\d+)\s+days?\b/i,
  );
  if (labelDays) dayValues.push(parseInteger(labelDays[1]));

  return {
    label,
    start: parsedDates[0] ?? null,
    end: parsedDates[1] ?? null,
    days: uniqueValue(dayValues),
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

    const spaced = line.replace(BOX_DRAWING, " ").trim();
    const single = nonEmpty.join(" ").replace(/\s+/g, " ").trim();
    if (/^(?:models used|model usage|usage by model|models)$/i.test(single)) {
      inModelSection = true;
      columns = null;
      pendingModel = "";
      continue;
    }
    if (MODEL_SECTION_END.test(single)) {
      columns = null;
      inModelSection = false;
      pendingModel = "";
      continue;
    }
    if (!inModelSection) continue;

    if (/^model\s+sessions\s+tokens$/i.test(single)) {
      columns = null;
      pendingModel = "";
      continue;
    }

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

    const row = spaced.match(/^(.+?)\s{2,}([\d,]+)\s{2,}([\d,]+)$/);
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
  const metrics = parseOverviewMetrics(lines);

  return {
    period: parsePeriod(cells),
    totalSessions: integerMetric(metrics, ["Total sessions", "Sessions"]),
    totalMessages: integerMetric(metrics, ["Total messages", "Messages"]),
    userMessages: integerMetric(metrics, ["User messages"]),
    toolCalls: integerMetric(metrics, ["Tool calls"]),
    inputTokens: integerMetric(metrics, ["Input tokens"]),
    outputTokens: integerMetric(metrics, ["Output tokens"]),
    totalTokens: integerMetric(metrics, ["Total tokens"]),
    totalCost: parseExplicitCost(cells),
    byModel: parseModelUsage(lines),
  };
}
