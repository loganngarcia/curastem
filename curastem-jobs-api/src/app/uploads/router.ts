import { extractToken } from "../auth/session.ts";
import { enforceUserRateLimit } from "../security/rateLimit.ts";
import {
  handleAttachmentDownload,
  handleAttachmentUpload,
} from "./attachments.ts";
import {
  handleResumeDelete,
  handleResumeDownload,
  handleResumeProcess,
  handleResumeUpload,
} from "./handlers.ts";
import type { Env } from "../../shared/types.ts";
import { requireAppCsrf, withAppCors } from "../security.ts";

export async function handleUploadRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  method: string
): Promise<Response | null> {
  if (path === "/uploads/resume" && method === "PUT") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    const sess = extractToken(request);
    const rl = await enforceUserRateLimit(env, request, {
      scope: "upload_resume",
      limit: 10,
      userId: sess,
    });
    if (rl) return withAppCors(request, rl);
    return withAppCors(request, await handleResumeUpload(request, env, ctx));
  }
  if (path === "/uploads/resume/process" && method === "POST") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    const sess = extractToken(request);
    const rl = await enforceUserRateLimit(env, request, {
      scope: "process_resume",
      limit: 10,
      userId: sess,
    });
    if (rl) return withAppCors(request, rl);
    return withAppCors(request, await handleResumeProcess(request, env));
  }
  if (path === "/uploads/resume" && method === "GET") {
    return withAppCors(request, await handleResumeDownload(request, env));
  }
  if (path === "/uploads/resume" && method === "DELETE") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    return withAppCors(request, await handleResumeDelete(request, env));
  }
  if (path === "/uploads/attachment" && method === "POST") {
    const csrf = requireAppCsrf(request);
    if (csrf) return withAppCors(request, csrf);
    const sess = extractToken(request);
    const rl = await enforceUserRateLimit(env, request, {
      scope: "upload_attachment",
      limit: 60,
      userId: sess,
    });
    if (rl) return withAppCors(request, rl);
    return withAppCors(request, await handleAttachmentUpload(request, env));
  }
  if (path.startsWith("/uploads/attachment/") && method === "GET") {
    const rawKey = decodeURIComponent(path.slice("/uploads/attachment/".length));
    return withAppCors(request, await handleAttachmentDownload(request, env, rawKey));
  }
  return null;
}
