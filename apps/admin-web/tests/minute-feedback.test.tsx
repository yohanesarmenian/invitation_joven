import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionFeedback } from "../components/action-feedback";
import {
  fromWibMinute,
  toWibMinute,
  readWibMinuteEdit,
  wibMinuteTimestamp,
} from "../src/forms/wib-date-time";
describe("minute editing and confirmed-action feedback", () => {
  it("converts midnight and WIB minutes independently of host timezone", () => {
    expect(toWibMinute("2027-01-02T17:30:45.678Z")).toBe("2027-01-03T00:30");
    expect(fromWibMinute("2027-01-03T00:30")).toBe("2027-01-02T17:30:00.000Z");
    expect(fromWibMinute("2027-02-30T10:00")).toBeNull();
    expect(fromWibMinute("2027-01-02T10:00:01")).toBeNull();
  });
  it("preserves unedited precision and distinguishes an explicit minute edit or clear", () => {
    const original = "2027-01-02T10:30:45.678Z";
    const edit = (value: string, valid = true) =>
      readWibMinuteEdit({ value, validity: { badInput: !valid } });
    expect(wibMinuteTimestamp(original, undefined, null)).toBe(original);
    expect(
      wibMinuteTimestamp(original, edit(toWibMinute(original)), null),
    ).toBe("2027-01-02T10:30:00.000Z");
    for (const invalid of [
      edit("", false),
      edit(""),
      edit("2027-01-01T10:30:45.678"),
    ]) {
      expect(invalid.kind).toBe("invalid");
      expect(wibMinuteTimestamp(original, invalid, null)).toBe(original);
    }
    expect(
      wibMinuteTimestamp(original, { kind: "clear", input: "" }, null),
    ).toBeNull();
    expect(wibMinuteTimestamp("", undefined, "")).toBe("");
  });
  it("announces persisted success politely and rejected operations assertively", () => {
    expect(renderToStaticMarkup(<ActionFeedback>{""}</ActionFeedback>)).toBe(
      "",
    );
    const success = renderToStaticMarkup(
      <ActionFeedback tone="success">Event saved successfully.</ActionFeedback>,
    );
    expect(success).toContain('role="status"');
    expect(success).toContain('aria-atomic="true"');
    expect(success).toContain("action-feedback--success");
    expect(
      renderToStaticMarkup(
        <ActionFeedback tone="error">Review the fields.</ActionFeedback>,
      ),
    ).toContain('role="alert"');
    expect(
      renderToStaticMarkup(
        <ActionFeedback tone="warning">
          Check the original result.
        </ActionFeedback>,
      ),
    ).toContain('role="status"');
  });
});
