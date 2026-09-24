// Requests the page started from <head>, before any module loaded (see
// index.html). Each is handed out once; later calls fetch afresh.
export function earlyFetch(url, options) {
  const early = window.__early?.[url];
  if (early) {
    delete window.__early[url];
    return early;
  }
  return fetch(url, options);
}

// Fetch JSON from this site's API. Errors carry the server's message.
export async function getJSON(url, { signal } = {}) {
  const response = await earlyFetch(url, { signal });
  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    // An abort while the body streams must reach the caller as an abort, not
    // as an empty payload that looks like success. Non-JSON error pages fall
    // through to the status text below.
    if (error.name === "AbortError") throw error;
  }
  if (!response.ok) {
    throw new Error(body?.error || `伺服器回應 ${response.status}`);
  }
  if (body === null) throw new Error("伺服器回應的格式不正確。");
  return body;
}

// The county goes in the query string: behind Vercel's Python runtime a
// non-ASCII path segment does not reliably reach Flask intact.
export const regionUrl = (name, suffix = "", params = {}) =>
  `/api/region${suffix}?${new URLSearchParams({ name, ...params })}`;
