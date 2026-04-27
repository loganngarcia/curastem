/**
 * Data export routes (GDPR / CCPA right-to-portability).
 *
 *   GET /auth/export/estimate
 *     Returns row counts + rough byte estimate so the client can decide
 *     whether to stream the download directly or show an "we'll email you"
 *     message. Fast: COUNT-only queries, no full data scan. ~50ms.
 *
 *   GET /auth/export
 *     Full JSON export of everything we hold for the user.
 *     Capped at 15 MB; returns 202 with { deferred: true } when over the
 *     cap so the client knows to show the manual-request message.
 *
 * Both routes fire a best-effort webhook (ADMIN_WEBHOOK_URL secret) so the
 * admin gets a Discord/Slack ping on every export request — critical when
 * the export is deferred and manual follow-up is needed.
 */

import type { Env } from "../../shared/types.ts";
import { readSession } from "./session.ts";
import { Errors, jsonOk } from "../../shared/utils/errors.ts";
import { logger } from "../../shared/utils/logger.ts";

// ~bytes per row type — conservative estimates for the size check.
const BYTES_PER_CHAT = 300;
const BYTES_PER_MESSAGE = 400;
const BYTES_PER_DOC = 2_000;
const BYTES_PER_APP = 2_000;
const EXPORT_BYTE_CAP = 15_000_000; // 15 MB

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/export/estimate
// ─────────────────────────────────────────────────────────────────────────────

export async function handleExportEstimate(
    request: Request,
    env: Env
): Promise<Response> {
    const active = await readSession(request, env);
    if (!active) return Errors.unauthorized("Not signed in");

    const uid = active.user.id;

    const row = await env.JOBS_DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM chats        WHERE user_id = ?) AS chat_count,
           (SELECT COUNT(*) FROM chat_messages WHERE user_id = ?) AS message_count,
           (SELECT COUNT(*) FROM docs          WHERE user_id = ?) AS doc_count,
           (SELECT COUNT(*) FROM apps          WHERE user_id = ?) AS app_count`
    )
        .bind(uid, uid, uid, uid)
        .first<{
            chat_count: number;
            message_count: number;
            doc_count: number;
            app_count: number;
        }>();

    const counts = row ?? {
        chat_count: 0,
        message_count: 0,
        doc_count: 0,
        app_count: 0,
    };

    const estimated_bytes =
        counts.chat_count * BYTES_PER_CHAT +
        counts.message_count * BYTES_PER_MESSAGE +
        counts.doc_count * BYTES_PER_DOC +
        counts.app_count * BYTES_PER_APP +
        4_000; // profile + metadata overhead

    return jsonOk({ ...counts, estimated_bytes, cap: EXPORT_BYTE_CAP });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/export
// ─────────────────────────────────────────────────────────────────────────────

export async function handleExport(
    request: Request,
    env: Env
): Promise<Response> {
    const active = await readSession(request, env);
    if (!active) return Errors.unauthorized("Not signed in");

    const uid = active.user.id;
    const userEmail = active.user.email ?? "(no email)";
    const userName = active.user.display_name ?? userEmail;

    // Run all queries in parallel — D1 batch would also work but parallel
    // prepare+all is cleaner here since each query has different params.
    const [profile, chats, messages, docs, apps] = await Promise.all([
        env.JOBS_DB.prepare(
            `SELECT full_name, headline, location, bio, skills, interests,
                    resume_file_name, resume_uploaded_at
             FROM profile WHERE user_id = ?`
        )
            .bind(uid)
            .first(),

        env.JOBS_DB.prepare(
            `SELECT id, title, pinned, created_at, updated_at
             FROM chats WHERE user_id = ? ORDER BY updated_at DESC`
        )
            .bind(uid)
            .all(),

        env.JOBS_DB.prepare(
            `SELECT chat_id, role, content, created_at
             FROM chat_messages WHERE user_id = ?
             ORDER BY chat_id, created_at ASC`
        )
            .bind(uid)
            .all(),

        env.JOBS_DB.prepare(
            `SELECT id, title, content, doc_type, created_at, updated_at
             FROM docs WHERE user_id = ? ORDER BY updated_at DESC`
        )
            .bind(uid)
            .all(),

        env.JOBS_DB.prepare(
            `SELECT id, company, role, status, content, created_at, updated_at
             FROM apps WHERE user_id = ? ORDER BY updated_at DESC`
        )
            .bind(uid)
            .all(),
    ]);

    // Attach messages to their parent chat for a friendlier structure.
    const msgsByChat = new Map<string, unknown[]>();
    for (const msg of messages.results ?? []) {
        const m = msg as { chat_id: string };
        if (!msgsByChat.has(m.chat_id)) msgsByChat.set(m.chat_id, []);
        msgsByChat.get(m.chat_id)!.push(msg);
    }

    const chatsWithMessages = (chats.results ?? []).map((c) => {
        const chat = c as { id: string };
        return { ...c, messages: msgsByChat.get(chat.id) ?? [] };
    });

    const payload = {
        exported_at: new Date().toISOString(),
        user: {
            id: uid,
            email: active.user.email,
            display_name: active.user.display_name,
        },
        profile: profile ?? null,
        chats: chatsWithMessages,
        docs: docs.results ?? [],
        apps: apps.results ?? [],
    };

    const json = JSON.stringify(payload, null, 2);

    // Notify admin regardless of size; deferred flag tells them manual work
    // is needed when over cap.
    const deferred = json.length > EXPORT_BYTE_CAP;
    notifyAdmin(env, {
        user: userName,
        email: userEmail,
        size_kb: Math.round(json.length / 1024),
        deferred,
    }).catch((err) =>
        logger.warn("admin_webhook_failed", { error: String(err) })
    );

    if (deferred) {
        logger.info("export_deferred", {
            uid,
            size_bytes: json.length,
        });
        return jsonOk({ deferred: true, email: active.user.email });
    }

    logger.info("export_served", { uid, size_bytes: json.length });

    return new Response(json, {
        status: 200,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="curastem-export-${new Date().toISOString().slice(0, 10)}.json"`,
            "Cache-Control": "no-store",
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin webhook (Discord / Slack / generic)
// ─────────────────────────────────────────────────────────────────────────────

async function notifyAdmin(
    env: Env,
    info: {
        user: string;
        email: string;
        size_kb: number;
        deferred: boolean;
    }
): Promise<void> {
    const url = (env as unknown as Record<string, string>).ADMIN_WEBHOOK_URL;
    if (!url) return; // Secret not set — log-only mode.

    const icon = info.deferred ? "🔴" : "🟢";
    const action = info.deferred
        ? `DEFERRED — manually export and email to **${info.email}**`
        : `served as inline download (~${info.size_kb} KB)`;

    // Discord format (also accepted by most Slack-compatible endpoints).
    const body = JSON.stringify({
        content:
            `${icon} **Data export request**\n` +
            `User: ${info.user} (${info.email})\n` +
            `Size: ~${info.size_kb} KB\n` +
            `Action: ${action}`,
        // Slack fallback key
        text:
            `${icon} Data export: ${info.user} (${info.email}) — ` +
            `${info.size_kb} KB — ${action}`,
    });

    await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
}
