import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { mapSubmitPublicGuestMessageRequest } from "./public-guest-message.dto.js";

const CREDENTIAL = "A".repeat(43);

function expectValidationError(action: () => unknown) {
  try {
    action();
    throw new Error("Expected validation error.");
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: null,
      message: "Validation error",
    });
  }
}

describe("mapSubmitPublicGuestMessageRequest", () => {
  it("normalizes message and authorName while preserving internal newlines", () => {
    expect(
      mapSubmitPublicGuestMessageRequest(CREDENTIAL, {
        authorName: "  Jo  ",
        message: "  Congratulations!\nHave a wonderful life.  ",
      }),
    ).toEqual({
      authorName: "Jo",
      message: "Congratulations!\nHave a wonderful life.",
      publicCredential: CREDENTIAL,
    });
  });

  it("treats omitted, null, and blank authorName as anonymous", () => {
    expect(
      mapSubmitPublicGuestMessageRequest(CREDENTIAL, {
        message: "Hello",
      }).authorName,
    ).toBeNull();
    expect(
      mapSubmitPublicGuestMessageRequest(CREDENTIAL, {
        authorName: null,
        message: "Hello",
      }).authorName,
    ).toBeNull();
    expect(
      mapSubmitPublicGuestMessageRequest(CREDENTIAL, {
        authorName: "  \n  ",
        message: "Hello",
      }).authorName,
    ).toBeNull();
  });

  it("counts Unicode code points for message and authorName boundaries", () => {
    const maxMessage = ` ${"🙂".repeat(1000)} `;
    const maxAuthor = ` ${"🎉".repeat(100)} `;

    expect(
      mapSubmitPublicGuestMessageRequest(CREDENTIAL, {
        authorName: maxAuthor,
        message: maxMessage,
      }),
    ).toMatchObject({
      authorName: "🎉".repeat(100),
      message: "🙂".repeat(1000),
    });

    expectValidationError(() =>
      mapSubmitPublicGuestMessageRequest(CREDENTIAL, {
        message: "🙂".repeat(1001),
      }),
    );
    expectValidationError(() =>
      mapSubmitPublicGuestMessageRequest(CREDENTIAL, {
        authorName: "🎉".repeat(101),
        message: "Hello",
      }),
    );
  });

  it("rejects missing, empty, whitespace-only, wrong-type, and extra-field payloads", () => {
    const invalidPayloads: unknown[] = [
      null,
      [],
      {},
      { message: "" },
      { message: "   " },
      { message: "\n\n" },
      { message: 1 },
      { message: { text: "Hello" } },
      { authorName: 1, message: "Hello" },
      { authorName: { name: "Jo" }, message: "Hello" },
      { invitationId: "11111111-1111-4111-8111-111111111111", message: "Hello" },
      { isHidden: true, message: "Hello" },
      { id: "11111111-1111-4111-8111-111111111111", message: "Hello" },
      { createdAt: "2026-09-30T00:00:00.000Z", message: "Hello" },
    ];

    for (const payload of invalidPayloads) {
      expectValidationError(() =>
        mapSubmitPublicGuestMessageRequest(CREDENTIAL, payload),
      );
    }
  });
});
