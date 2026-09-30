import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GuestMessageForm } from "./guest-message-form";
import {
  guestMessageFailureText,
  messageCharacterCount,
  prepareGuestMessage,
} from "../../src/messages/state";

describe("GuestMessageForm and its validation", () => {
  it("renders labelled optional author and required multiline message controls", () => {
    const action = vi.fn();
    const html = renderToStaticMarkup(
      createElement(GuestMessageForm, { submitAction: action }),
    );
    expect(html).toContain('aria-label="Guest message"');
    expect(html).toContain("Your name");
    expect(html).toContain("(optional)");
    expect(html).toContain("Your message");
    expect(html).toContain("(required)");
    expect(html).toContain('rows="6" required=""');
    expect(html).toContain("Send Message");
    expect(html).toContain("0 / 1000 characters");
    expect(html).not.toMatch(/maxLength|later phase|<ul|<ol|type="hidden"/);
    expect(action).not.toHaveBeenCalled();
  });
  it.each(["", "   ", "\n\n"])(
    "rejects an empty normalized message",
    (message) => {
      expect(prepareGuestMessage("", message).status).toBe("invalid");
    },
  );
  it.each(["x", "💐"])(
    "accepts the message boundary and rejects one extra code point",
    (character) => {
      expect(
        prepareGuestMessage("", `  ${character.repeat(1000)}  `).status,
      ).toBe("valid");
      expect(prepareGuestMessage("", character.repeat(1001))).toMatchObject({
        status: "invalid",
        message: expect.any(String),
      });
      expect(messageCharacterCount(`  ${character.repeat(1000)}  `)).toBe(1000);
    },
  );
  it.each(["x", "💐"])(
    "accepts the author boundary and rejects one extra code point",
    (character) => {
      expect(
        prepareGuestMessage(` ${character.repeat(100)} `, "Wishes").status,
      ).toBe("valid");
      expect(
        prepareGuestMessage(character.repeat(101), "Wishes"),
      ).toMatchObject({ status: "invalid", authorName: expect.any(String) });
    },
  );
  it("normalizes only outer whitespace, preserving internal spaces and newlines", () => {
    expect(
      prepareGuestMessage(
        "  Jo  ",
        "  Congratulations!\n\nGod bless you both!  ",
      ),
    ).toEqual({
      status: "valid",
      request: {
        authorName: "Jo",
        message: "Congratulations!\n\nGod bless you both!",
      },
    });
    expect(prepareGuestMessage(" \n ", "  Love  and joy! ")).toEqual({
      status: "valid",
      request: { authorName: null, message: "Love  and joy!" },
    });
  });
  it("keeps HTML-like text and Markdown as untransformed plain text", () => {
    const message = '<script>alert("x")</script>\n**Love**';
    expect(prepareGuestMessage("<b>Jo</b>", message)).toEqual({
      status: "valid",
      request: { authorName: "<b>Jo</b>", message },
    });
  });
  it("counts code points, rather than graphemes or UTF-16 units", () => {
    expect(messageCharacterCount("💐")).toBe(1);
    expect(messageCharacterCount("e\u0301")).toBe(2);
  });
  it("explains uncertainty and the consequence of explicit resubmission", () => {
    expect(guestMessageFailureText("uncertain")).toContain(
      "Sending again may send another copy",
    );
    expect(guestMessageFailureText("unavailable")).not.toMatch(
      /archived|credential|unknown/,
    );
  });
});
