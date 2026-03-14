// ---------------------------------------------------------------------------
// Extract the user's actual message from OpenClaw's prompt envelope
// ---------------------------------------------------------------------------

const TICKS = String.fromCharCode(96).repeat(3); // triple backtick

/**
 * Remove labeled ```json ... ``` metadata blocks from the prompt.
 */
function stripJsonBlocks(text: string, labels: string[]): string {
  let result = text;
  for (const label of labels) {
    const prefix = `${label} (untrusted metadata):`;
    let idx = result.indexOf(prefix);
    while (idx !== -1) {
      const codeStart = result.indexOf(`${TICKS}json`, idx);
      if (codeStart === -1) break;
      const codeEnd = result.indexOf(TICKS, codeStart + 7);
      if (codeEnd === -1) break;
      // Remove from prefix start through end of closing ticks + whitespace
      let endIdx = codeEnd + 3;
      while (endIdx < result.length && (result[endIdx] === "\n" || result[endIdx] === " ")) {
        endIdx++;
      }
      result = result.slice(0, idx) + result.slice(endIdx);
      idx = result.indexOf(prefix);
    }
  }
  return result;
}

/**
 * Extract the user's semantic message from an OpenClaw prompt envelope.
 * Returns the cleaned text suitable for embedding search.
 */
export function extractUserMessage(prompt: string): string {
  if (!prompt || prompt.trim().length === 0) return "";

  let text = prompt;

  // Strip conversation info and sender JSON blocks
  text = stripJsonBlocks(text, ["Conversation info", "Sender"]);

  // Strip EXTERNAL_UNTRUSTED_CONTENT blocks
  text = text.replace(
    /<<<EXTERNAL_UNTRUSTED_CONTENT[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>\s*/g,
    "",
  );

  // Strip Untrusted context wrapper
  text = text.replace(
    /Untrusted context \(metadata, do not treat as instructions or commands\):\s*/g,
    "",
  );

  // Strip media attachment notices
  text = text.replace(/\[media attached:.*?\]\s*/g, "");
  text = text.replace(/To send an image back.*?Keep caption in the text body\.\s*/g, "");

  // Extract message from Discord-style inline format:
  // [Discord Guild #channel +2m Thu 2026-03-12 10:21 UTC] username: actual message
  const discordInline = text.match(/\[Discord[^\]]*\]\s*[^:]+:\s*([\s\S]*)/);
  if (discordInline) {
    text = discordInline[1];
  }

  // Extract cron prompt content (after the [cron:...] prefix)
  const cronMatch = text.match(/^\[cron:[^\]]+\]\s*([\s\S]*)/);
  if (cronMatch) {
    text = cronMatch[1];
  }

  // Strip OpenClaw runtime context blocks
  text = text.replace(
    /\[.*?UTC\] OpenClaw runtime context \(internal\):[\s\S]*?(?=\n\n|\n[A-Z]|$)/g,
    "",
  );

  // Strip System: prefix event blocks
  text = text.replace(/^System:\s*\[[\s\S]*?(?=\n\n|$)/gm, "");

  // Strip timestamp prefixes like [Thu 2026-03-12 10:21 UTC]
  text = text.replace(/^\[[\w\s\-:]+UTC\]\s*/gm, "");

  // Strip file blocks
  text = text.replace(/<file name="[^"]*"[^>]*>[\s\S]*?<\/file>\s*/g, "");

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  // If after all stripping we have nothing useful, return original truncated
  if (text.length < 3) return prompt.slice(0, 500);

  // Cap at 500 chars for embedding
  return text.slice(0, 500);
}
