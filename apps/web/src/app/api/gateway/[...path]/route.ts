import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
const COOKIE = "apiforge_session";

async function gateway(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (!path.length || path.some((p) => !/^[a-zA-Z0-9_-]+$/.test(p)))
    return NextResponse.json({ message: "Invalid route." }, { status: 400 });
  const webOrigin = process.env.WEB_ORIGIN || "http://127.0.0.1:3000";
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== webOrigin
  ) {
    return NextResponse.json(
      { message: "Request origin rejected." },
      { status: 403 },
    );
  }
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    if (Number(request.headers.get("content-length")) > 1600000)
      return NextResponse.json(
        { message: "Payload too large." },
        { status: 413 },
      );
    body = await request.text();
      if (Buffer.byteLength(body) > 1600000)
      return NextResponse.json(
        { message: "Payload too large." },
        { status: 413 },
      );
  }
  try {
    const origin = process.env.API_ORIGIN || "http://127.0.0.1:8100";
    const upstream = await fetch(
      `${origin}/api/v1/${path.join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
      },
    );
    const json = await upstream
      .json()
      .catch(() => ({ message: "The backend response was invalid." }));
    if (
      path[0] === "auth" &&
      ["login", "register"].includes(path[1]) &&
      upstream.ok &&
      json.data?.token
    ) {
      jar.set(COOKIE, json.data.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 43200,
      });
      delete json.data.token;
    }
    if (
      (["logout", "logout-all", "reset-password"].includes(path[1]) &&
        upstream.ok) ||
      upstream.status === 401
    )
      jar.delete(COOKIE);
    return NextResponse.json(json, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { message: "The API is unavailable. Start the backend and try again." },
      { status: 502 },
    );
  }
}
export {
  gateway as GET,
  gateway as POST,
  gateway as PUT,
  gateway as PATCH,
  gateway as DELETE,
};
