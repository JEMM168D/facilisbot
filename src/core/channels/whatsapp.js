/**
 * WhatsApp Cloud API (Meta Official) and Twilio Ingress & Sender
 * Engine is passed via config._engine by the Worker/Server router.
 */

/**
 * WhatsApp Cloud API (Meta Official) and Twilio Ingress & Sender
 */
export class WhatsAppHandler {
  /**
   * Handle Meta Webhook Verification Challenge (GET /webhook/whatsapp)
   */
  static handleVerification(reqUrl, config) {
    const url = new URL(reqUrl, 'http://localhost');
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const expectedToken = config.channels?.whatsapp?.verifyToken || 'yunque_verify_token_123';

    if (mode === 'subscribe' && token === expectedToken) {
      return { status: 200, body: challenge };
    }
    return { status: 403, body: 'Verification token mismatch' };
  }

  /**
   * Handle Incoming Meta WhatsApp Webhook Event (POST /webhook/whatsapp)
   */
  static async handleCloudApiWebhook(body, config) {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value || !value.messages || value.messages.length === 0) {
        return { status: 200, message: 'No message event' };
      }

      const messageObj = value.messages[0];
      const contactObj = value.contacts?.[0] || {};
      const fromNumber = messageObj.from;
      const userName = contactObj.profile?.name || fromNumber;
      const phoneNumberId = value.metadata?.phone_number_id || config.channels?.whatsapp?.phoneNumberId;
      const accessToken = config.channels?.whatsapp?.accessToken;

      let userText = '';
      if (messageObj.type === 'text') {
        userText = messageObj.text?.body || '';
      } else if (messageObj.type === 'button') {
        userText = messageObj.button?.text || '';
      } else if (messageObj.type === 'interactive') {
        userText = messageObj.interactive?.button_reply?.title || messageObj.interactive?.list_reply?.title || '';
      } else {
        userText = `[Mensaje recibido de tipo: ${messageObj.type}]`;
      }

      // Process message through core bot engine
      const engine = config._engine;
      if (!engine) return { status: 500, error: 'Engine no disponible' };

      const response = await engine.processMessage({
        channel: 'whatsapp',
        userId: fromNumber,
        userName,
        text: userText
      });

      // Send outbound reply back to WhatsApp user
      if (response.reply && accessToken && phoneNumberId) {
        await this.sendCloudApiMessage({
          phoneNumberId,
          accessToken,
          to: fromNumber,
          text: response.reply
        });
      }

      return { status: 200, success: true, response };
    } catch (err) {
      console.error('[WhatsApp Cloud API] Error procesando mensaje:', err.message);
      return { status: 500, error: err.message };
    }
  }

  /**
   * Send WhatsApp message via Meta Cloud API
   */
  static async sendCloudApiMessage({ phoneNumberId, accessToken, to, text }) {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text }
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[WhatsApp Cloud API] Error enviando mensaje:', err);
    }
    return res.ok;
  }

  /**
   * Handle Twilio WhatsApp Webhook (POST /webhook/twilio/whatsapp)
   */
  static async handleTwilioWebhook(formData, config) {
    const from = (formData.From || '').replace('whatsapp:', '');
    const body = formData.Body || '';
    const profileName = formData.ProfileName || from;

    const engine = config._engine;
    if (!engine) return { status: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Engine no disponible' };

    const response = await engine.processMessage({
      channel: 'whatsapp',
      userId: from,
      userName: profileName,
      text: body
    });

    // Return TwiML XML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${this.escapeXml(response.reply)}</Message>
</Response>`;

    return {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: twiml
    };
  }

  static escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
  }
}
