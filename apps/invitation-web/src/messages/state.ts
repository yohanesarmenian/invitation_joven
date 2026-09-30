import type {
  SubmitPublicGuestMessageRequest,
  SubmitPublicGuestMessageResponse,
} from "../../../../packages/api-client/src/index";

export type GuestMessageResult =
  | { status: "success"; data: SubmitPublicGuestMessageResponse }
  | {
      status: "error";
      kind: "validation" | "unavailable" | "server" | "uncertain";
    };

export function messageCharacterCount(value: string): number {
  return [...value.trim()].length;
}

export function prepareGuestMessage(
  authorName: string,
  message: string,
):
  | { status: "valid"; request: SubmitPublicGuestMessageRequest }
  | { status: "invalid"; authorName?: string; message?: string } {
  const authorError =
    messageCharacterCount(authorName) > 100
      ? "Please keep your name to 100 characters or fewer."
      : undefined;
  const messageError = !message.trim()
    ? "Please write a message for the bride and groom."
    : messageCharacterCount(message) > 1000
      ? "Please keep your message to 1000 characters or fewer."
      : undefined;
  if (authorError || messageError)
    return {
      status: "invalid",
      authorName: authorError,
      message: messageError,
    };
  return {
    status: "valid",
    request: { authorName: authorName.trim() || null, message: message.trim() },
  };
}

export function guestMessageFailureText(
  kind: Extract<GuestMessageResult, { status: "error" }>["kind"],
): string {
  switch (kind) {
    case "validation":
      return "Your message couldn’t be sent. Please check your name and message, then try again.";
    case "unavailable":
      return "This invitation is currently unavailable. Your message couldn’t be sent. Please try again later.";
    case "server":
      return "Your message couldn’t be sent. Your words are still here. Please try again.";
    case "uncertain":
      return "We couldn’t confirm whether your message was sent. Your words are still here. Sending again may send another copy.";
  }
}
