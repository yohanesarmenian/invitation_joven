export function getListenConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.API_HOST ?? "0.0.0.0";
  const source = env.PORT ?? "4000";
  if (!["127.0.0.1", "::1", "0.0.0.0"].includes(host))
    throw new Error("API_HOST must be an explicit supported bind address.");
  if (!/^[1-9]\d{0,4}$/.test(source) || Number(source) > 65535)
    throw new Error("PORT must be a valid TCP port.");
  return { host, port: Number(source) };
}
