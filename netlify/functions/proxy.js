// Netlify Function: simple CORS proxy, restricted to the Redwood docs host.
// Usage from the browser: /.netlify/functions/proxy?url=<encoded full URL>

const ALLOWED_HOST = "documentation.runmyjobs.cloud";

export default async (req) => {
  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url");

  if (!target) {
    return new Response("Missing 'url' query parameter", { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid 'url' parameter", { status: 400 });
  }

  if (parsed.hostname !== ALLOWED_HOST) {
    return new Response(`Host not allowed: ${parsed.hostname}`, {
      status: 403,
    });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RedwoodApiExplorer/1.0)",
      },
      redirect: "follow",
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return new Response(`Upstream fetch failed: ${err.message}`, {
      status: 502,
    });
  }
};

export const config = {
  path: "/.netlify/functions/proxy",
};
