import type { AdminGuestMessageListResponse } from "@wedding-invitation/api-client/src/index";

export const messageItem: AdminGuestMessageListResponse["items"][number] = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  invitation: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "Sample household",
  },
  authorName: "Guest Author",
  message: "Congratulations from <script>window.__xss = true</script>",
  createdAt: "2026-10-01T03:00:00.000Z",
  isHidden: false,
};

export const hiddenMessageItem: AdminGuestMessageListResponse["items"][number] =
  {
    ...messageItem,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    authorName: null,
    message: "A private line\nwith spacing",
    createdAt: "2026-10-01T02:00:00.000Z",
    isHidden: true,
  };

export const messageList: AdminGuestMessageListResponse = {
  items: [messageItem, hiddenMessageItem],
  page: { number: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
};
