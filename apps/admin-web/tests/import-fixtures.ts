import type {
  GuestImportValidateResponse,
  GuestImportCommitResponse,
} from "@wedding-invitation/api-client/src/index";
export const preview: GuestImportValidateResponse = {
  previewId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  expiresAt: "2099-01-01T00:00:00.000Z",
  summary: { totalRows: 3, validRows: 2, warningRows: 1, errorRows: 1 },
  rows: [
    {
      rowNumber: 2,
      status: "VALID",
      errors: [],
      warnings: [],
      parsed: {
        displayName: "Sample Cedar household",
        greetingName: "Cedar family",
        allowPlusOne: false,
        maxAdditionalChildren: 2,
        rsvpDeadlineLocal: "2027-01-16 18:30",
        rsvpDeadlineAt: "2027-01-16T11:30:00.000Z",
        invitees: [
          { fullName: "Example Adult", category: "ADULT", label: "Parent" },
          { fullName: "Example Child", category: "CHILD", label: null },
        ],
        eligibleEventSlugs: ["ceremony", "reception"],
      },
    },
    {
      rowNumber: 5,
      status: "VALID_WITH_WARNINGS",
      errors: [],
      warnings: [
        {
          rowNumber: 5,
          column: "displayName",
          field: "displayName",
          code: "POSSIBLE_DUPLICATE",
          message: "Possible duplicate household.",
        },
      ],
      parsed: {
        displayName: "Sample Maple household",
        greetingName: null,
        allowPlusOne: true,
        maxAdditionalChildren: 0,
        rsvpDeadlineLocal: null,
        rsvpDeadlineAt: null,
        invitees: [
          { fullName: "Example Guest", category: "ADULT", label: null },
        ],
        eligibleEventSlugs: [],
      },
    },
    {
      rowNumber: 8,
      status: "ERROR",
      errors: [
        {
          rowNumber: 8,
          column: "invitees",
          field: "invitees",
          code: "INVALID_JSON",
          message: "Invalid invitees JSON.",
        },
      ],
      warnings: [],
    },
  ],
};
export const receipt: GuestImportCommitResponse = {
  importBatch: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "COMMITTED",
    createdInvitationCount: 2,
    createdInviteeCount: 3,
    warningCount: 1,
  },
};
