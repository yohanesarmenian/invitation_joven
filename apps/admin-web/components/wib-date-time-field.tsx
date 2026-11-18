"use client";

import { useId, useRef } from "react";
import {
  readWibMinuteEdit,
  toWibMinute,
  wibMinuteError,
  type WibMinuteEdit,
} from "../src/forms/wib-date-time";

export function WibDateTimeField({
  id: inputId,
  label,
  clearLabel,
  original,
  edit,
  onEdit,
  disabled,
  error,
  help,
}: {
  id?: string;
  label: string;
  clearLabel: string;
  original: string | null;
  edit?: WibMinuteEdit;
  onEdit: (edit: WibMinuteEdit) => void;
  disabled?: boolean;
  error?: string;
  help?: string;
}) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const input = useRef<HTMLInputElement>(null);
  const message = edit?.kind === "invalid" ? wibMinuteError : error;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={input}
        aria-invalid={Boolean(message)}
        aria-describedby={
          [help && `${id}-help`, message && `${id}-error`]
            .filter(Boolean)
            .join(" ") || undefined
        }
        disabled={disabled}
        step="60"
        type="datetime-local"
        // The browser owns the draft, including edits made before hydration.
        // Editors remount this field when explicitly loading saved data.
        defaultValue={toWibMinute(original)}
        onInput={(event) => onEdit(readWibMinuteEdit(event.currentTarget))}
      />
      {help && (
        <p className="hint" id={`${id}-help`}>
          {help}
        </p>
      )}
      {message && (
        <p className="field-error" id={`${id}-error`}>
          {message}
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          // Reset incomplete segments even when the exposed value is already empty.
          if (input.current) input.current.value = "";
          onEdit({ kind: "clear", input: "" });
        }}
      >
        {clearLabel}
      </button>
    </div>
  );
}
