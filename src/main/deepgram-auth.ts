import type { DeepgramAuth } from "../shared/types";

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";

/**
 * Exchanges the long-lived Deepgram API key (kept in the main process) for a
 * short-lived access token the renderer can use to open its WebSocket. The
 * renderer only ever sees the API key itself if the key can't mint tokens.
 */
export async function getDeepgramAuth(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeepgramAuth> {
  try {
    const response = await fetchImpl(GRANT_URL, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    if (response.ok) {
      const body = (await response.json()) as { access_token?: unknown };
      if (typeof body.access_token === "string" && body.access_token) {
        return { scheme: "bearer", credential: body.access_token };
      }
    }
    if (response.status === 401) {
      throw new Error("Your Deepgram API key was rejected. Check it in Settings.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Your Deepgram")) throw error;
    // Network hiccup or a key without token permissions: fall back below.
  }
  return { scheme: "token", credential: apiKey };
}
