import type { RsvpFailure } from "./result";

export type RsvpNotice = {
  tone: "success" | "conflict" | "closed" | "error";
  title: string;
  message: string;
  recovery: "reload" | "retry" | "correct" | "none";
  section?: "events" | "attendees" | "attendance";
};

const domainMessages: Record<
  string,
  { message: string; section: "events" | "attendees" }
> = {
  EVENT_NOT_ALLOWED: {
    message:
      "Salah satu sesi yang dipilih sudah tidak tersedia untuk undangan ini. Silakan periksa kembali pilihan sesi Anda.",
    section: "events",
  },
  EVENT_NOT_SELECTED: {
    message: "Silakan pilih setidaknya satu sesi yang akan Anda hadiri.",
    section: "events",
  },
  PLUS_ONE_NOT_ALLOWED: {
    message:
      "Undangan ini tidak mencakup pendamping tambahan. Silakan periksa kembali daftar tamu yang akan hadir.",
    section: "attendees",
  },
  ADDITIONAL_CHILD_LIMIT_EXCEEDED: {
    message:
      "Jumlah anak tambahan melebihi batas undangan ini. Silakan periksa kembali jumlahnya.",
    section: "attendees",
  },
  RSVP_ATTENDEE_INVALID: {
    message:
      "Sebagian data kehadiran tidak valid atau sudah berubah. Silakan periksa kembali siapa yang akan hadir.",
    section: "attendees",
  },
  RSVP_PARTY_INVALID: {
    message:
      "Silakan periksa daftar tamu. Daftar yang disimpan harus sesuai dengan pilihan kehadiran Anda.",
    section: "attendees",
  },
  RSVP_SESSION_COUNTS_MISMATCH: {
    message:
      "Semua sesi yang dipilih harus dihadiri oleh rombongan yang sama. Silakan periksa kembali pilihan sesi.",
    section: "events",
  },
  RSVP_SESSION_CONFIGURATION_UNSUPPORTED: {
    message:
      "Sesi untuk undangan ini telah berubah. Buka ulang undangan atau hubungi kedua mempelai untuk bantuan.",
    section: "events",
  },
};

export function rsvpFailureNotice(failure: RsvpFailure): RsvpNotice {
  if (failure.kind === "api") {
    if (
      failure.httpStatus === 404 &&
      failure.code === "INVITATION_NOT_AVAILABLE"
    ) {
      return {
        tone: "closed",
        title: "Undangan tidak tersedia",
        message: "Undangan ini sudah tidak tersedia.",
        recovery: "none",
      };
    }
    if (
      failure.httpStatus === 409 &&
      failure.code === "RSVP_VERSION_CONFLICT"
    ) {
      return {
        tone: "conflict",
        title: "Jawaban RSVP Anda telah berubah",
        message:
          "RSVP ini diperbarui setelah Anda membuka halaman. Draf perubahan Anda masih tersedia. Jika Anda memuat ulang RSVP, draf akan diganti dengan jawaban yang tersimpan.",
        recovery: "reload",
      };
    }
    if (failure.httpStatus === 422 && failure.code === "RSVP_DEADLINE_PASSED") {
      return {
        tone: "closed",
        title: "RSVP sudah ditutup",
        message:
          "Batas waktu RSVP telah lewat. Undangan masih bisa dibuka. Penyimpanan jawaban baru dan perubahan sudah ditutup.",
        recovery: "none",
      };
    }
    if (
      failure.httpStatus === 409 &&
      failure.code === "RSVP_LOCKED_AFTER_CHECKIN"
    )
      return {
        tone: "closed",
        title: "RSVP sudah ditutup",
        message: "Hubungi kedua mempelai jika Anda memerlukan bantuan.",
        recovery: "none",
      };
    const domain =
      failure.code !== null && Object.hasOwn(domainMessages, failure.code)
        ? domainMessages[failure.code]
        : undefined;
    if (failure.httpStatus === 422 && domain) {
      return {
        tone: "error",
        title: "Periksa jawaban Anda",
        ...domain,
        recovery: "correct",
      };
    }
    if (failure.httpStatus === 400) {
      return {
        tone: "error",
        title: "Periksa jawaban Anda",
        message:
          "Jawaban ini belum tersimpan. Silakan periksa dan perbaiki jawaban Anda, lalu coba lagi.",
        recovery: "correct",
        section: "attendance",
      };
    }
  }
  return {
    tone: "error",
    title: "Penyimpanan RSVP belum terverifikasi",
    message:
      "Kami belum dapat memastikan apakah jawaban Anda tersimpan. Muat ulang RSVP sebelum mengirim jawaban lagi.",
    recovery: "reload",
  };
}

export function rsvpLoadFailureNotice(
  failure: RsvpFailure,
  replacingDraft: boolean,
): RsvpNotice {
  const notice = rsvpFailureNotice(failure);
  if (notice.tone === "closed")
    return {
      ...notice,
      recovery: failure.code === "INVITATION_NOT_AVAILABLE" ? "reload" : "none",
    };
  return {
    tone: "error",
    title: "Jawaban RSVP belum bisa dimuat",
    message: replacingDraft
      ? "Draf perubahan Anda masih tersedia. Jika Anda memuat ulang RSVP, draf akan diganti dengan jawaban yang tersimpan. Silakan muat ulang sebelum mengirim jawaban."
      : "Kami belum bisa memuat jawaban RSVP Anda. Silakan muat ulang sebelum mengirim jawaban.",
    recovery: "reload",
  };
}

export function rsvpSuccessNotice(status: "ACCEPTED" | "DECLINED"): RsvpNotice {
  return {
    tone: "success",
    recovery: "none",
    title:
      status === "ACCEPTED"
        ? "Terima kasih atas konfirmasi Anda"
        : "Terima kasih telah memberi kabar",
    message: `${status === "ACCEPTED" ? "Konfirmasi kehadiran Anda telah tersimpan. Kami menantikan kehadiran Anda." : "Jawaban Anda telah tersimpan sebagai tidak hadir."} Anda dapat memperbarui jawaban sebelum batas waktu RSVP.`,
  };
}
