export type InvitationStage = "closed" | "opening" | "content";

export const INITIAL_INVITATION_STAGE: InvitationStage = "closed";

export function nextInvitationStage(stage: InvitationStage): InvitationStage {
  if (stage === "closed") {
    return "opening";
  }
  if (stage === "opening") {
    return "content";
  }
  return "content";
}
