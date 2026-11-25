import type {
  SubmitPublicGuestMessageRequest,
  SubmitPublicGuestMessageResponse,
} from "../../../../packages/api-client/src/index";

export type GuestMessageResult =
  | { status: "success"; data: SubmitPublicGuestMessageResponse }
  | {
      status: "error";
      kind: "validation" | "unavailable" | "uncertain";
    };

export type GuestMessageReceipt = "saved" | "missing" | "unverified";

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
      ? "Nama tidak boleh lebih dari 100 karakter."
      : undefined;
  const messageError = !message.trim()
    ? "Silakan tulis ucapan untuk kedua mempelai."
    : messageCharacterCount(message) > 1000
      ? "Ucapan tidak boleh lebih dari 1.000 karakter."
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
      return "Ucapan belum terkirim. Periksa nama dan isi ucapan Anda, lalu coba lagi.";
    case "unavailable":
      return "Undangan sedang tidak tersedia sehingga ucapan belum terkirim. Silakan coba lagi nanti.";
    case "uncertain":
      return "Kami belum dapat memastikan apakah ucapan Anda tersimpan. Draf masih tersedia. Periksa ucapan atau kirim ulang ucapan yang sama.";
  }
}
