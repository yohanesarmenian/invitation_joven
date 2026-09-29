export type InvitationStage = "closed" | "opened" | "content";

export const INITIAL_INVITATION_STAGE: InvitationStage = "closed";

export function nextInvitationStage(stage: InvitationStage): InvitationStage {
  if (stage === "closed") {
    return "opened";
  }
  if (stage === "opened") {
    return "content";
  }
  return "content";
}
