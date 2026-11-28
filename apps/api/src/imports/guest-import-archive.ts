import { StringDecoder } from "node:string_decoder";
import { SaxesParser } from "saxes";
import yauzl from "yauzl";

const MAX_ROW = 100_000;
const MAX_COLUMN = 256;
const MAX_EXPANDED_BYTES = 24 * 1024 * 1024;

function address(text: string): { row: number; column: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,5})$/.exec(text);
  if (!match) throw new Error("Invalid workbook cell reference");
  const column = [...match[1]!].reduce(
    (index, letter) => index * 26 + letter.charCodeAt(0) - 64,
    0,
  );
  const row = Number(match[2]);
  if (row > MAX_ROW || column > MAX_COLUMN) {
    throw new Error("Workbook cell reference exceeds its bounds");
  }
  return { row, column };
}

// ExcelJS's document loader materializes ranges before the application can inspect cells.
export async function checkWorkbookArchive(buffer: Buffer) {
  const zip = await yauzl.fromBufferPromise(buffer, { strictFileNames: true });
  const paths = new Set<string>();
  let expanded = 0;
  let rangeCells = 0;
  let dataCells = 0;

  function debitRange(reference: string) {
    const [first, last = first, ...extra] = reference.split(":");
    if (extra.length || !first || !last)
      throw new Error("Invalid workbook range");
    const start = address(first);
    const end = address(last);
    rangeCells +=
      (Math.abs(end.column - start.column) + 1) *
      (Math.abs(end.row - start.row) + 1);
    if (rangeCells > 100_000) throw new Error("Workbook range limit");
  }

  try {
    if (zip.entryCount > 128) throw new Error("Workbook entry limit");
    for await (const entry of zip.eachEntry()) {
      const path = entry.fileName.toLowerCase();
      expanded += entry.uncompressedSize;
      if (
        expanded > MAX_EXPANDED_BYTES ||
        paths.has(path) ||
        path.split("/").includes(".") ||
        /vbaProject|^xl\/externalLinks\/|^xl\/embeddings\//i.test(path)
      ) {
        throw new Error("Workbook archive limit or unsupported content");
      }
      paths.add(path);
      const isWorkbook = path === "xl/workbook.xml";
      const isWorksheet = /xl\/worksheets\/sheet\d+\.xml/.test(path);
      if (isWorksheet && !/^xl\/worksheets\/sheet[1-9]\d*\.xml$/.test(path)) {
        throw new Error("Unexpected workbook sheet path");
      }
      // Drain without retaining the expanded bytes. The ZIP reader verifies actual sizes.
      const stream = await zip.openReadStreamPromise(entry);
      if (!isWorkbook && !isWorksheet) {
        await stream.forEach(() => {});
        continue;
      }
      const parser = new SaxesParser();
      const decoder = new StringDecoder("utf8");
      let definedName: string | null = null;
      let row = 0;
      let columns = new Set<number>();
      const seenRows = new Set<number>();
      const sheetNames = new Set<string>();
      parser.on("doctype", () => {
        throw new Error("Workbook XML doctype");
      });
      parser.on("opentag", ({ name, attributes }) => {
        if (isWorkbook && name === "sheet") {
          const sheetName = attributes.name?.toLowerCase();
          if (!sheetName || sheetNames.has(sheetName))
            throw new Error("Duplicate worksheet name");
          sheetNames.add(sheetName);
        }
        if (isWorkbook && name === "definedName") definedName = "";
        if (isWorksheet && name === "mergeCell")
          debitRange(attributes.ref ?? "");
        if (isWorksheet && name === "row") {
          row = Number(attributes.r);
          if (
            !/^[1-9]\d{0,5}$/.test(attributes.r ?? "") ||
            row < 1 ||
            row > MAX_ROW ||
            seenRows.has(row)
          ) {
            throw new Error("Invalid or duplicate worksheet row");
          }
          seenRows.add(row);
          columns = new Set();
        }
        if (isWorksheet && name === "c") {
          const cell = address(attributes.r ?? "");
          if (
            row !== cell.row ||
            columns.has(cell.column) ||
            ++dataCells > 100_000
          ) {
            throw new Error("Invalid, duplicate or excess worksheet cells");
          }
          columns.add(cell.column);
        }
      });
      const append = (text: string) => {
        if (definedName === null) return;
        definedName += text;
        if (definedName.length > 16_384)
          throw new Error("Workbook named range limit");
      };
      parser.on("text", append);
      parser.on("cdata", append);
      parser.on("closetag", ({ name }) => {
        if (isWorksheet && name === "row") row = 0;
        if (name === "definedName" && definedName !== null) {
          // ExcelJS considers references with absolute addresses even inside loosely
          // formatted names. Require canonical coordinates before it expands them.
          for (const part of definedName.split(",")) {
            const reference = part.slice(part.lastIndexOf("!") + 1).trim();
            if (!reference.includes(":") && !/\$\w+\$\d/.test(reference))
              continue;
            debitRange(reference);
          }
          definedName = null;
        }
      });
      for await (const chunk of stream) parser.write(decoder.write(chunk));
      parser.write(decoder.end()).close();
    }
  } finally {
    zip.close();
  }
}
