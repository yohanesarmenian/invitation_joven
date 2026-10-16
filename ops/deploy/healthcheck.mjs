const paths = {
  api: "http://127.0.0.1:4000/health",
  "admin-web": "http://127.0.0.1:3001/login",
  "invitation-web": "http://127.0.0.1:3000/",
};
try {
  const url = paths[process.env.APP];
  if (!url) throw Error("Unsupported APP");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(3500),
  });
  process.exitCode = response.ok ? 0 : 1;
} catch {
  process.exitCode = 1;
}
