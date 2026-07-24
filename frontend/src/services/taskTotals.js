export function normalizeTaskTotals(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.map((row) => [String(row?.status || ""), Number(row?.count || 0)]),
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([status, count]) => [status, Number(count || 0)]),
    );
  }

  return {};
}
