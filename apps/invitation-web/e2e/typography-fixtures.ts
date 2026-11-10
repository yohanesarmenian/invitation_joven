// Synthetic display-only fixtures. They add no group RSVP behavior or real data.
export const typographyFixtures = [
  { name: "Ayu", greetingName: "Ayu" },
  {
    name: "Alexandra Putri Maharani dan Keluarga Besar Pranata Kusumawardhana",
    greetingName:
      "Alexandra Putri Maharani dan Keluarga Besar Pranata Kusumawardhana",
  },
  { name: "Yohanes Adrian Pratama", greetingName: "Yohanes Adrian Pratama" },
  { name: "PT Organics", greetingName: null },
  { name: "Teman-teman Gameku", greetingName: "Teman-teman Gameku" },
].map((fixture, index) => ({
  ...fixture,
  credential: `typography-${index + 1}-`.padEnd(43, "x"),
}));
