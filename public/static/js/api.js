// Fetch JSON from this site's API. Errors carry the server's message.
export async function getJSON(url, { signal } = {}) {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error pages fall through to the status text below.
  }
  if (!response.ok) {
    throw new Error(body?.error || `伺服器回應 ${response.status}`);
  }
  return body;
}

// The county goes in the query string: behind Vercel's Python runtime a
// non-ASCII path segment does not reliably reach Flask intact.
export const regionUrl = (name, suffix = "", params = {}) =>
  `/api/region${suffix}?${new URLSearchParams({ name, ...params })}`;
