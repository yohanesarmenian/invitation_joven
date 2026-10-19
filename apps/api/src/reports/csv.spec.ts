import { expect, it } from "vitest";
import { csv, csvCell } from "./csv.js";
it("neutralizes spreadsheet formulas after whitespace and escapes Unicode/newlines/quotes", () => {
  for (const value of [
    "=1+1",
    "  +1",
    "\t@SUM(A1)",
    "\r-1",
    "\ufeff=1",
    "\u0000=1",
  ])
    expect(csvCell(value)).toBe(`"'${value}"`);
  expect(
    csv(
      ["name", "notes"],
      [["Jo & Venta", 'Vegetarian, "please"\nありがとう']],
    ),
  ).toBe(
    '\ufeff"name","notes"\r\n"Jo & Venta","Vegetarian, ""please""\nありがとう"\r\n',
  );
  expect(csvCell(3)).toBe('"3"');
});
