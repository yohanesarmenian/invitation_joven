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
      "One of the selected events is no longer available for this invitation. Please review your event choices.",
    section: "events",
  },
  EVENT_NOT_SELECTED: {
    message: "Please select at least one event to attend.",
    section: "events",
  },
  PLUS_ONE_NOT_ALLOWED: {
    message:
      "This invitation does not currently include a plus one. Please review who will be attending.",
    section: "attendees",
  },
  ADDITIONAL_CHILD_LIMIT_EXCEEDED: {
    message:
      "The number of additional children exceeds this invitation’s allowance. Please review the child count.",
    section: "attendees",
  },
  RSVP_ATTENDEE_INVALID: {
    message:
      "Some attendance details are invalid or no longer current. Please review who will be attending.",
    section: "attendees",
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
        title: "Invitation unavailable",
        message: "This invitation is no longer available.",
        recovery: "none",
      };
    }
    if (
      failure.httpStatus === 409 &&
      failure.code === "RSVP_VERSION_CONFLICT"
    ) {
      return {
        tone: "conflict",
        title: "Your RSVP has changed",
        message:
          "This RSVP has been updated since you opened the page. Your changes are still here. Reloading the latest RSVP will replace them with the saved response.",
        recovery: "reload",
      };
    }
    if (failure.httpStatus === 422 && failure.code === "RSVP_DEADLINE_PASSED") {
      return {
        tone: "closed",
        title: "RSVP is closed",
        message:
          "The reply deadline has passed. No further responses or changes can be saved. The invitation remains available.",
        recovery: "none",
      };
    }
    if (
      failure.httpStatus === 422 &&
      failure.code === "RSVP_LOCKED_AFTER_CHECKIN"
    )
      return {
        tone: "closed",
        title: "RSVP is closed",
        message:
          "Your household has checked in. Reception staff can assist you.",
        recovery: "none",
      };
    const domain =
      failure.code !== null && Object.hasOwn(domainMessages, failure.code)
        ? domainMessages[failure.code]
        : undefined;
    if (failure.httpStatus === 422 && domain) {
      return {
        tone: "error",
        title: "Please review your response",
        ...domain,
        recovery: "correct",
      };
    }
    if (failure.httpStatus === 400) {
      return {
        tone: "error",
        title: "Please review your response",
        message:
          "We couldn’t save these details. Please check your response and try again after making a correction.",
        recovery: "correct",
        section: "attendance",
      };
    }
  }
  return {
    tone: "error",
    title: "We couldn’t confirm the save",
    message:
      "We could not confirm whether your response was saved. Reload the latest RSVP before making another submission.",
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
    title: "RSVP details couldn’t be loaded",
    message: replacingDraft
      ? "Your changes are still here. Reloading will replace them with the latest saved response. Please try reloading again before submitting."
      : "We couldn’t load your RSVP details. Please try loading them again before responding.",
    recovery: "reload",
  };
}

export function rsvpSuccessNotice(status: "ACCEPTED" | "DECLINED"): RsvpNotice {
  return {
    tone: "success",
    recovery: "none",
    title:
      status === "ACCEPTED"
        ? "Thank you for your RSVP"
        : "Thank you for letting us know",
    message: `${status === "ACCEPTED" ? "Your acceptance has been saved. We look forward to celebrating with you." : "Your response has been saved as not attending."} You can update your response before the reply deadline.`,
  };
}
