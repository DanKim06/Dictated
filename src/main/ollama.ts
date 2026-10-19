import type { Meeting, OllamaStatus } from "../shared/types";
import { assertSummarizable, buildSummaryPrompt, SYSTEM_PROMPT } from "./summarizer";

// Ollama serves open-source models on localhost, so summaries cost nothing
// and the transcript never leaves the machine.
export const OLLAMA_URL = "http://127.0.0.1:11434";

const NOT_RUNNING =
  "Ollama isn't running. Install it from ollama.com, open it, then run `ollama pull llama3.2` in a terminal.";

export async function getOllamaStatus(fetchImpl: typeof fetch = fetch): Promise<OllamaStatus> {
  try {
    const response = await fetchImpl(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { running: false, models: [] };
    const body = (await response.json()) as { models?: { name?: unknown }[] };
    const models = (body.models ?? []).flatMap((m) => (typeof m.name === "string" ? [m.name] : []));
    return { running: true, models: models.sort() };
  } catch {
    return { running: false, models: [] };
  }
}

/**
 * Ollama's default context window (a few thousand tokens) silently drops the
 * start of a long transcript, so size it to the prompt. A token is roughly
 * 3.5 characters of English; leave room for the reply. Capped so the KV cache
 * fits in the memory of an ordinary laptop.
 */
export function contextWindowFor(prompt: string): number {
  const needed = Math.ceil(prompt.length / 3.5) + 2048;
  const rounded = Math.ceil(needed / 2048) * 2048;
  return Math.min(Math.max(rounded, 8192), 32768);
}

/** Some reasoning models print their thinking inline; it isn't part of the notes. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

interface ChatChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

export async function summarizeWithOllama(
  meeting: Meeting,
  model: string,
  onDelta: (text: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  assertSummarizable(meeting);
  const prompt = buildSummaryPrompt(meeting);

  let response: Response;
  try {
    response = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        options: { num_ctx: contextWindowFor(prompt), temperature: 0.2 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch {
    throw new Error(NOT_RUNNING);
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    if (response.status === 404) {
      throw new Error(`The model "${model}" isn't installed. Run \`ollama pull ${model}\` in a terminal.`);
    }
    throw new Error(`Ollama error ${response.status}: ${detail || response.statusText}`);
  }

  // The reply streams as newline-delimited JSON. A network chunk can end
  // mid-line, so keep the unfinished tail until the next chunk arrives.
  let text = "";
  let buffer = "";
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as ChatChunk;
    if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
    const delta = chunk.message?.content ?? "";
    if (delta) {
      text += delta;
      onDelta(delta);
    }
  };

  const decoder = new TextDecoder();
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handleLine);
  }
  handleLine(buffer + decoder.decode());

  const summary = stripThinking(text);
  if (!summary) throw new Error(`"${model}" returned an empty summary. Try a larger model.`);
  return summary;
}
