"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ClosedEnvelopeCover, OpenedCoverStage } from "./invitation-cover";
import {
  INITIAL_INVITATION_STAGE,
  nextInvitationStage,
  type InvitationStage,
} from "./invitation-opening-state";

export function InvitationOpeningFlow({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<InvitationStage>(INITIAL_INVITATION_STAGE);
  const openedButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const advance = useCallback(() => {
    setStage((current) => nextInvitationStage(current));
  }, []);

  useEffect(() => {
    if (stage === "opened") {
      openedButtonRef.current?.focus();
    } else if (stage === "content") {
      contentRef.current?.focus();
    }
  }, [stage]);

  return (
    <div className="invitation-opening-flow">
      {stage === "closed" ? <ClosedEnvelopeCover onOpen={advance} /> : null}
      {stage === "opened" ? (
        <OpenedCoverStage onView={advance} buttonRef={openedButtonRef} />
      ) : null}
      {stage === "content" ? (
        <div
          ref={contentRef}
          tabIndex={-1}
          className="invitation-opening-content"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
