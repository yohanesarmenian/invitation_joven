import { describe, expect, it } from "vitest";
import { getListenConfig } from "./listen-config.js";
describe("listen configuration", () => {
  it("preserves the container default and supports explicit daily loopback", () => {
    expect(getListenConfig({})).toEqual({ host: "0.0.0.0", port: 4000 });
    expect(getListenConfig({ API_HOST: "127.0.0.1", PORT: "4200" })).toEqual({
      host: "127.0.0.1",
      port: 4200,
    });
  });
  it.each(["", "0", "-1", "65536", "4200x"])(
    "rejects invalid port %s",
    (PORT) => expect(() => getListenConfig({ PORT })).toThrow(),
  );
  it("rejects unexpected hosts", () =>
    expect(() => getListenConfig({ API_HOST: "192.168.1.2" })).toThrow());
});
