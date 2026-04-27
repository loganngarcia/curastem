/**
 * Paginated doc + app listings for the signed-in user.
 *
 *   GET /docs?cursor=&limit=20
 *   GET /apps?cursor=&limit=20
 *
 * These back the "Show more [down chevron]" pattern in the sidebar. Unlike
 * chats (infinite scroll, ordered by recency), doc/app lists tend to be
 * explicitly expanded by the user. Same cursor encoding as chats — (updated_at, id).
 */

import type { AppRow, DocRow, Env } from "../../shared/types.ts";
import { readSession } from "../auth/session.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import { listApps, listDocs } from "./data.ts";

export async function handleListUserDocs(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const url = new URL(request.url);
  const limit = parseIntOr(url.searchParams.get("limit"), 20);
  const cursor = url.searchParams.get("cursor");
  const since = url.searchParams.get("since");
  const sinceSec = since != null ? parseIntOr(since, 0) : null;

  const { docs, next_cursor } = await listDocs(env.JOBS_DB, active.user.id, {
    limit,
    cursor,
    sinceSec,
  });
  return jsonOk({ docs: docs.map(toPublicDoc), next_cursor });
}

export async function handleListUserApps(request: Request, env: Env): Promise<Response> {
  const active = await readSession(request, env);
  if (!active) return Errors.unauthorized("Not signed in");

  const url = new URL(request.url);
  const limit = parseIntOr(url.searchParams.get("limit"), 20);
  const cursor = url.searchParams.get("cursor");
  const since = url.searchParams.get("since");
  const sinceSec = since != null ? parseIntOr(since, 0) : null;

  const { apps, next_cursor } = await listApps(env.JOBS_DB, active.user.id, {
    limit,
    cursor,
    sinceSec,
  });
  return jsonOk({ apps: apps.map(toPublicApp), next_cursor });
}

function parseIntOr(v: string | null | undefined, def: number): number {
  if (v == null) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function toPublicDoc(d: DocRow) {
  return {
    id: d.id,
    chat_id: d.chat_id,
    kind: d.kind,
    title: d.title,
    doc_company: d.doc_company,
    html: d.html,
    created_at: d.created_at * 1000,
    updated_at: d.updated_at * 1000,
  };
}

function toPublicApp(a: AppRow) {
  let payload: unknown = null;
  try {
    payload = JSON.parse(a.payload_json);
  } catch {
    payload = null;
  }
  return {
    id: a.id,
    chat_id: a.chat_id,
    kind: a.kind,
    title: a.title,
    payload,
    created_at: a.created_at * 1000,
    updated_at: a.updated_at * 1000,
  };
}
