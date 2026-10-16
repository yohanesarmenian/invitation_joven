// Security check deliberately includes ASCII controls before a formula.
// eslint-disable-next-line no-control-regex
const formulaPrefix = /^[\s\ufeff\u0000-\u001f]*[=+\-@]/u;
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && formulaPrefix.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csv(
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  return (
    "\ufeff" +
    [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
