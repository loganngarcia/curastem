/**
 * Consistent structured error responses for the REST API.
 *
 * Every error returned by this API is a JSON object with:
 *   { error: { code: string, message: string } }
 *
 * HTTP status codes are standard. No HTML error pages, no stack traces in prod.
 */

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

function jsonError(code: string, message: string, status: number): Response {
  const body: ApiError = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Errors = {
  unauthorized(message = "Missing or invalid API key"): Response {
    return jsonError("UNAUTHORIZED", message, 401);
  },

  forbidden(message = "Access denied"): Response {
    return jsonError("FORBIDDEN", message, 403);
  },

  notFound(resource = "Resource"): Response {
    return jsonError("NOT_FOUND", `${resource} not found`, 404);
  },

  /**
   * Valid id, but this representation is not offered through the API (e.g. source
   * text too thin to syndicate). Prefer over NOT_FOUND so clients are not misled
   * into retrying as if the id were wrong.
   */
  jobUnavailable(
    message = "This posting is not available in the job catalog."
  ): Response {
    return jsonError("JOB_UNAVAILABLE", message, 410);
  },

  methodNotAllowed(): Response {
    return jsonError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  },

  rateLimited(retryAfterSeconds: number): Response {
    const resp = jsonError(
      "RATE_LIMITED",
      `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
      429
    );
    resp.headers.set("Retry-After", String(retryAfterSeconds));
    return resp;
  },

  badRequest(message: string): Response {
    return jsonError("BAD_REQUEST", message, 400);
  },

  internal(message = "An unexpected error occurred"): Response {
    return jsonError("INTERNAL_ERROR", message, 500);
  },
};

/** Wrap a successful JSON response with standard headers. */
export function jsonOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
