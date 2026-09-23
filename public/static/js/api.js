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

export const regionUrl = (name, suffix = "") => `/api/region/${encodeURIComponent(name)}${suffix}`;
