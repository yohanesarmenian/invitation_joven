import { describe, expect, it } from "vitest";
import {
  INITIAL_INVITATION_STAGE,
  nextInvitationStage,
} from "./invitation-opening-state.js";

describe("invitation opening state", () => {
  it("starts at the closed stage", () => {
    expect(INITIAL_INVITATION_STAGE).toBe("closed");
  });

  it("transitions closed -> opened", () => {
    expect(nextInvitationStage("closed")).toBe("opened");
  });

  it("transitions opened -> content", () => {
    expect(nextInvitationStage("opened")).toBe("content");
  });

  it("keeps content stable with no backwards transition", () => {
    expect(nextInvitationStage("content")).toBe("content");
  });
});
