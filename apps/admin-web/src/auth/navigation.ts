export function accountHome(role: "OWNER" | "CHECKIN_STAFF" | "GUEST_MANAGER") {
  return role === "OWNER"
    ? "/"
    : role === "GUEST_MANAGER"
      ? "/reception"
      : "/checkin";
}
