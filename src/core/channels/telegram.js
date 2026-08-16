import { botEngine } from '../engine.js';

/**
 * Telegram Bot API Handler (Webhook & Polling modes)
 */
export class TelegramHandler {
  /**
   * Handle incoming Telegram webhook event (POST /webhook/telegram)
   */
  static async handleWebhook(update, config) {
    try {
      const message = update.message || update.edited_message || update.callback_query?.message;
      if (!message || (!message.text && !update.callback_query)) {
        return { status: 200, message: 'Non-text update ignored' };
      }

      const chatId = message.chat?.id || update.callback_query?.from?.id;
      const from = message.from || update.callback_query?.from || {};
      const userName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || `tg_${chatId}`;
      const text = update.callback_query ? update.callback_query.data : message.text;
      const botToken = config.channels?.telegram?.botToken;

      // Process message
      const response = await botEngine.processMessage({
        channel: 'telegram',
        userId: String(chatId),
        userName,
        text
      });

      // Send reply
      if (response.reply && botToken) {
        await this.sendMessage({
          botToken,
          chatId,
          text: response.reply
        });
      }

      return { status: 200, success: true, response };
    } catch (err) {
      console.error('[Telegram] Error procesando update:', err.message);
      return { status: 500, error: err.message };
    }
  }

  /**
   * Send outbound message via Telegram Bot API
   */
  static async sendMessage({ botToken, chatId, text, parseMode = 'Markdown' }) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode
        })
      });

      if (!res.ok) {
        // Fallback without parse_mode if markdown has formatting mismatches
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text
          })
        });
      }
      return true;
    } catch (err) {
      console.error('[Telegram] Error enviando mensaje:', err.message);
      return false;
    }
  }

  /**
   * Long-polling worker for local testing without public IP
   */
  static startPolling(config) {
    const botToken = config.channels?.telegram?.botToken;
    if (!botToken) {
      console.log('[Telegram Polling] Token no configurado, modo polling omitido.');
      return null;
    }

    console.log('[Telegram Polling] Iniciando modo polling para Telegram Bot...');
    let isRunning = true;
    let offset = 0;

    const poll = async () => {
      while (isRunning) {
        try {
          const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=30`);
          if (res.ok) {
            const data = await res.json();
            if (data.ok && Array.isArray(data.result)) {
              for (const update of data.result) {
                offset = update.update_id + 1;
                await this.handleWebhook(update, config);
              }
            }
          }
        } catch (err) {
          // network pause
          await new Promise(r => setTimeout(r, 4000));
        }
      }
    };

    poll();

    return {
      stop: () => { isRunning = false; }
    };
  }
}
