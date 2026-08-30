import { config } from "../config.js";

export async function sendTelegram(text: string): Promise<void> {
  if (!config.telegram.configured) throw new Error("Telegram is not configured");
  const res = await fetch(
    `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    // Never include the token in the error surface.
    throw new Error(`Telegram API responded with HTTP ${res.status}`);
  }
}
