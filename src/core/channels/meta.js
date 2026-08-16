/**
 * Meta Instagram Direct Messages and Facebook Messenger Ingress
 * Engine is passed via config._engine by the Worker/Server router.
 */

/**
 * Meta Instagram Direct Messages and Facebook Messenger Ingress
 */
export class MetaDMsHandler {
  /**
   * Handle Webhook Verification Challenge (GET /webhook/meta)
   */
  static handleVerification(reqUrl, config) {
    const url = new URL(reqUrl, 'http://localhost');
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const expectedToken = config.channels?.instagram?.verifyToken || config.channels?.messenger?.verifyToken || 'yunque_meta_verify_123';

    if (mode === 'subscribe' && token === expectedToken) {
      return { status: 200, body: challenge };
    }
    return { status: 403, body: 'Meta verify token mismatch' };
  }

  /**
   * Handle Incoming Instagram / Messenger webhook event (POST /webhook/meta)
   */
  static async handleWebhook(body, config) {
    try {
      const entry = body.entry?.[0];
      const messaging = entry?.messaging?.[0];

      if (!messaging || !messaging.message || messaging.message.is_echo) {
        return { status: 200, message: 'Non-user message event' };
      }

      const senderId = messaging.sender?.id;
      const userText = messaging.message?.text || '[Contenido multimedia recibido]';
      const isInstagram = body.object === 'instagram';
      const channel = isInstagram ? 'instagram' : 'messenger';
      const accessToken = isInstagram
        ? (config.channels?.instagram?.accessToken || config.channels?.messenger?.accessToken)
        : (config.channels?.messenger?.accessToken || config.channels?.instagram?.accessToken);

      // Process with Bot Engine
      const engine = config._engine;
      if (!engine) return { status: 500, error: 'Engine no disponible' };

      const response = await engine.processMessage({
        channel,
        userId: senderId,
        userName: `${channel}_${senderId.slice(-4)}`,
        text: userText
      });

      // Send outbound message
      if (response.reply && accessToken) {
        await this.sendMessage({
          accessToken,
          recipientId: senderId,
          text: response.reply
        });
      }

      return { status: 200, success: true, response };
    } catch (err) {
      console.error('[Meta DMs] Error procesando evento:', err.message);
      return { status: 500, error: err.message };
    }
  }

  /**
   * Send outbound message via Meta Graph API for Instagram/Messenger
   */
  static async sendMessage({ accessToken, recipientId, text }) {
    const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${accessToken}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text }
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[Meta DMs] Error enviando mensaje:', err);
    }
    return res.ok;
  }
}
