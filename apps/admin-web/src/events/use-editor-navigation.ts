"use client";

import { useEffect } from "react";

type EditorState = { pending: boolean; blocked: boolean; dirty: boolean };

export function useEditorNavigation(
  getState: () => EditorState,
  onBlocked: () => void,
) {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const { pending, blocked, dirty } = getState();
      if (pending || blocked || dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const protectLink = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target ||
        anchor.origin !== location.origin ||
        anchor.href === location.href ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const { pending, blocked } = getState();
      if (pending || blocked) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onBlocked();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", protectLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", protectLink, true);
    };
  }, [getState, onBlocked]);
}
