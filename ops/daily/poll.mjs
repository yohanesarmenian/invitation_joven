// The loop itself owns its deadline. Promise.race around an infinite polling
// promise would leave live timers and requests after the caller timed out.
export async function poll(read, timeout, reason, interval = 200) {
  const expires = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    if (Date.now() >= expires) break;
    await new Promise((done) =>
      setTimeout(done, Math.min(interval, expires - Date.now())),
    );
  } while (Date.now() < expires);
  throw Error(reason);
}
