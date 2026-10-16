import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";
import { PrismaService } from "./prisma.service.js";
it("stores true UTC instants and reads raw SQL timestamps independently of PostgreSQL server timezone", async () => {
  const original = process.env.DATABASE_URL!;
  const configured = new URL(original);
  configured.searchParams.set(
    "options",
    "-c timezone=Asia/Jakarta -c application_name=timezone_qa",
  );
  process.env.DATABASE_URL = configured.toString();
  const prisma = new PrismaService(),
    raw = new Client({ connectionString: original }),
    id = randomUUID(),
    instant = new Date("2027-01-16T11:30:00.000Z");
  try {
    await raw.connect();
    await raw.query("SET TIME ZONE 'Asia/Jakarta'");
    const session = await prisma.$queryRaw<
      Array<{ timezone: string; application: string }>
    >`SELECT current_setting('TimeZone') AS timezone,current_setting('application_name') AS application`;
    expect(session[0]).toEqual({ timezone: "UTC", application: "timezone_qa" });
    await prisma.event.create({
      data: {
        id,
        slug: `timezone-${id}`,
        name: "Synthetic timezone proof",
        displayOrder: 1999000001,
        startsAt: instant,
        endsAt: new Date("2027-01-16T13:30:00.000Z"),
      },
    });
    const read = (
      await raw.query<{ start: Date; end: Date }>(
        "SELECT starts_at AS start,ends_at AS end FROM events WHERE id=$1",
        [id],
      )
    ).rows[0]!;
    expect(read.start.toISOString()).toBe(instant.toISOString());
    expect(read.end.toISOString()).toBe("2027-01-16T13:30:00.000Z");
  } finally {
    await prisma.event.deleteMany({ where: { id } });
    await prisma.$disconnect();
    await raw.end();
    process.env.DATABASE_URL = original;
  }
});
