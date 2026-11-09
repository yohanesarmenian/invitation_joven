import { describe, expect, it } from "vitest";
import {
  INITIAL_INVITATION_STAGE,
  nextInvitationStage,
} from "./invitation-opening-state.js";

describe("invitation opening state", () => {
  it("starts at the closed stage", () => {
    expect(INITIAL_INVITATION_STAGE).toBe("closed");
  });

  it("transitions closed -> opening", () => {
    expect(nextInvitationStage("closed")).toBe("opening");
  });

  it("transitions opening -> content without another activation", () => {
    expect(nextInvitationStage("opening")).toBe("content");
  });

  it("keeps content stable with no backwards transition", () => {
    expect(nextInvitationStage("content")).toBe("content");
  });
});
