const TOKEN_PLACEHOLDER = "__POSTHOG_PROJECT_TOKEN__";
const PAGE_PREFIX = "/api/posthog";
const US_API_ORIGIN = "https://us.i.posthog.com";
const US_ASSETS_ORIGIN = "https://us-assets.i.posthog.com";
const BODY_LIMIT_BYTES = 1_000_000;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);
const API_PREFIXES = ["/e", "/batch", "/decide", "/flags", "/s", "/engage", "/i", "/api", "/capture"];

function response(status, body = "") {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}

function isAllowedPath(pathname) {
  if (pathname.startsWith("/static/") || pathname === "/static") return true;
  if (pathname.startsWith("/array/") || pathname === "/array") return true;
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

function substitute(value, projectToken) {
  return value
    .replaceAll(TOKEN_PLACEHOLDER, projectToken)
    .replaceAll(encodeURIComponent(TOKEN_PLACEHOLDER), encodeURIComponent(projectToken));
}

export async function onRequest(context) {
  const request = context.request;
  const incomingUrl = new URL(request.url);
  if (!ALLOWED_METHODS.has(request.method)) return response(405, "Method not allowed.");
  if (incomingUrl.pathname !== PAGE_PREFIX && !incomingUrl.pathname.startsWith(PAGE_PREFIX + "/")) {
    return response(404, "Not found.");
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== incomingUrl.origin) return response(403, "Forbidden.");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return response(403, "Forbidden.");
  }

  const projectToken = context.env && context.env.POSTHOG_PROJECT_TOKEN;
  if (typeof projectToken !== "string" || !/^phc_[A-Za-z0-9_-]{12,}$/.test(projectToken)) {
    return response(503, "Analytics is not configured.");
  }

  const path = incomingUrl.pathname.slice(PAGE_PREFIX.length) || "/";
  if (!isAllowedPath(path)) return response(404, "Not found.");
  const assetRequest = path.startsWith("/static") || path.startsWith("/array");
  const upstreamUrl = new URL(assetRequest ? US_ASSETS_ORIGIN : US_API_ORIGIN);
  upstreamUrl.pathname = substitute(path, projectToken);
  upstreamUrl.search = substitute(incomingUrl.search, projectToken);

  const headers = new Headers();
  const accept = request.headers.get("accept");
  const contentType = request.headers.get("content-type");
  if (accept) headers.set("accept", accept);
  if (contentType) headers.set("content-type", contentType);

  let body;
  if (request.method === "POST") {
    const encoding = (request.headers.get("content-encoding") || "").toLowerCase();
    if (encoding && encoding !== "identity") return response(415, "Compressed requests are not supported.");
    const length = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > BODY_LIMIT_BYTES) return response(413, "Request too large.");
    const normalizedType = (contentType || "").toLowerCase();
    if (normalizedType && !normalizedType.includes("application/json") &&
        !normalizedType.includes("application/x-www-form-urlencoded") &&
        !normalizedType.includes("text/plain")) {
      return response(415, "Unsupported content type.");
    }
    const requestText = await request.text();
    if (new TextEncoder().encode(requestText).byteLength > BODY_LIMIT_BYTES) {
      return response(413, "Request too large.");
    }
    body = substitute(requestText, projectToken);
  }

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers,
      body,
      redirect: "manual"
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of ["set-cookie", "location", "access-control-allow-origin",
      "access-control-allow-credentials", "content-length"]) responseHeaders.delete(name);
    responseHeaders.set("x-content-type-options", "nosniff");

    const upstreamType = (responseHeaders.get("content-type") || "").toLowerCase();
    if (upstreamType.includes("application/json") || upstreamType.includes("+json")) {
      const text = await upstream.text();
      responseHeaders.delete("content-encoding");
      responseHeaders.set("cache-control", "no-store");
      return new Response(text.replaceAll(projectToken, TOKEN_PLACEHOLDER), {
        status: upstream.status,
        headers: responseHeaders
      });
    }

    const responseBody = request.method === "HEAD" || upstream.status === 204 || upstream.status === 304
      ? null
      : upstream.body;
    return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
  } catch {
    return response(502, "Analytics upstream unavailable.");
  }
}
