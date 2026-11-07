// The machine-readable report. Its shape is the object audit() returns.

export function formatJson(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
