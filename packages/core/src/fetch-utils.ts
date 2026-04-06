import type { Page } from "patchright";

const JSON_CONTENT_TYPE = "application/json";

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: JSON_CONTENT_TYPE,
    "Content-Type": JSON_CONTENT_TYPE,
    ...extra,
  };
}

// ── Node-side helpers (no browser needed) ────────────────────────────────────

/**
 * HTTP GET with JSON response, executed from Node.js (not the browser).
 * Use for unauthenticated public endpoints. For authenticated endpoints that
 * require browser cookies, use fetchGetWithinPage instead.
 */
export async function fetchGet<T>(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, { method: "GET", headers: jsonHeaders(extraHeaders) });
  if (!res.ok) {
    throw new Error(`fetchGet: request to ${url} returned status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * HTTP POST with JSON body, executed from Node.js (not the browser).
 * Use for unauthenticated public endpoints.
 */
export async function fetchPost<T>(
  url: string,
  data: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: jsonHeaders(extraHeaders),
    body: JSON.stringify(data),
  });
  return res.json() as Promise<T>;
}

/**
 * GraphQL query, executed from Node.js (not the browser).
 * Throws if the response contains a `errors` array.
 */
export async function fetchGraphql<T>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const result = await fetchPost<{
    data?: T;
    errors?: Array<{ message: string }>;
  }>(url, { operationName: null, query, variables }, extraHeaders);

  if (result.errors?.length) {
    throw new Error(`GraphQL error: ${result.errors[0]?.message ?? "unknown"}`);
  }
  return result.data as T;
}

// ── In-page helpers (execute inside the browser context) ─────────────────────
//
// These are the most powerful fetch utilities. By running fetch() inside the
// browser page via page.evaluate(), the request automatically inherits the
// page's cookies, CORS context, and any session headers. This lets adapters
// call a site's own internal JSON APIs without extracting tokens into Node.js.
//
// Example: LinkedIn's Voyager API, Hapoalim's REST API, any site's internal XHR.

/**
 * Execute a GET fetch inside the browser page context, inheriting the page's
 * cookies and session. Returns parsed JSON, or null on 204 / parse error.
 *
 * @param ignoreErrors  When true, JSON parse errors return null instead of throwing.
 */
export async function fetchGetWithinPage<T>(
  page: Page,
  url: string,
  ignoreErrors = false,
): Promise<T | null> {
  const [rawResult, status] = await page.evaluate(
    async (innerUrl: string): Promise<[string | null, number]> => {
      let response: Response | undefined;
      try {
        response = await fetch(innerUrl, { credentials: "include" });
        if (response.status === 204) return [null, response.status];
        return [await response.text(), response.status];
      } catch (e) {
        const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
        throw new Error(
          `fetchGetWithinPage error: ${msg}, url: ${innerUrl}, status: ${response?.status ?? "n/a"}`,
        );
      }
    },
    url,
  );

  if (rawResult === null) return null;

  try {
    return JSON.parse(rawResult) as T;
  } catch (e) {
    if (!ignoreErrors) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `fetchGetWithinPage parse error: ${msg}, url: ${url}, status: ${status}`,
      );
    }
    return null;
  }
}

/**
 * Execute a POST fetch inside the browser page context, inheriting the page's
 * cookies and session. Returns parsed JSON, or null on 204 / parse error.
 *
 * @param extraHeaders   Additional headers merged into the request.
 * @param ignoreErrors   When true, JSON parse errors return null instead of throwing.
 */
export async function fetchPostWithinPage<T>(
  page: Page,
  url: string,
  data: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
  ignoreErrors = false,
): Promise<T | null> {
  const rawResult = await page.evaluate(
    async ([innerUrl, innerData, innerHeaders]: [
      string,
      Record<string, unknown>,
      Record<string, string>,
    ]): Promise<string | null> => {
      const response = await fetch(innerUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...innerHeaders,
        },
        body: JSON.stringify(innerData),
      });
      if (response.status === 204) return null;
      return response.text();
    },
    [url, data, extraHeaders] as [string, Record<string, unknown>, Record<string, string>],
  );

  if (rawResult === null) return null;

  try {
    return JSON.parse(rawResult) as T;
  } catch (e) {
    if (!ignoreErrors) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `fetchPostWithinPage parse error: ${msg}, url: ${url}`,
      );
    }
    return null;
  }
}
