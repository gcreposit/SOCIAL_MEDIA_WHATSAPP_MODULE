

https://wasenderapi.com/help/messaging/using-webhooks



# 🪝 Webhooks Integration Guide — WasenderApi



## Introduction to Webhooks

Webhooks allow your application to receive **real-time notifications** about payloads happening in your WhatsApp sessions.  
With **WasenderApi webhooks**, you can build interactive applications that respond to message delivery status, incoming messages, session status changes, and more.

> ⚠️ **Important:**  
> Webhooks provide a powerful way to integrate WhatsApp messaging with your systems.  
> Ensure your webhook endpoint is **secure** and can handle the expected volume of payloads.

---

## Enabling Webhooks

You can enable webhooks when creating a new WhatsApp session or by updating an existing session.

### 🆕 When Creating a New Session

1. Navigate to **WhatsApp Sessions → Create Session**  
2. Fill in your session details (name, phone number)  
3. In the **Webhook** section, enter your webhook URL (e.g., `https://your-domain.com/webhook`)  
4. Check the **Enable Webhook Notifications** option  
5. Select the webhook payloads you want to receive notifications for  
6. Click **Create Session** to save your settings  

### ♻️ For Existing Sessions

1. Go to **WhatsApp Sessions** and select the session you want to modify  
2. Click the **Edit** button  
3. Scroll to the **Webhook** section  
4. Enter your webhook URL and enable the webhook option  
5. Select the payloads you want to receive  
6. Save your changes  

---

## Available Webhook Payloads

You can subscribe to any combination of the following payloads:

| Event | Description |
|:------|:-------------|
| `message.sent` | Triggered when a message is sent from your WhatsApp session |
| `session.status` | Triggered when your WhatsApp session status changes |
| `qrcode.updated` | Triggered when a new QR code is generated |
| `messages.upsert` | Triggered when a new message is received |
| `messages.update` | Triggered when a message is updated |
| `messages.delete` | Triggered when a message is deleted |
| `message-receipt.update` | Triggered when a message receipt status changes |
| `messages.reaction` | Triggered when someone reacts to a message |
| `chats.upsert` | Triggered when a new chat is created |
| `chats.update` | Triggered when a chat is updated |
| `chats.delete` | Triggered when a chat is deleted |
| `groups.upsert` | Triggered when a new group is created |
| `groups.update` | Triggered when a group is updated |
| `group-participants.update` | Triggered when participants in a group change |
| `contacts.upsert` | Triggered when a new contact is added |
| `contacts.update` | Triggered when a contact is updated |

---

## Setting Up Your Webhook Endpoint

Your webhook endpoint should be a **publicly accessible URL** that can receive **POST** requests.

### Example — Express.js Implementation

```javascript
// Example webhook endpoint in Express.js
const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// Verify webhook signature to ensure it's from WasenderApi
function verifySignature(req) {
  const signature = req.headers['x-webhook-signature'];
  const webhookSecret = 'YOUR_WEBHOOK_SECRET'; // Store securely in environment variables
  if (!signature || !webhookSecret) return false;
  if (signature !== webhookSecret) return false;
  return true;
}

app.post('/webhook', (req, res) => {
  // Verify the request is from WasenderApi
  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process the webhook payload
  const payload = req.body;
  console.log('Received webhook payload:', payload.event);

  // Handle different payload events
  switch (payload.event) {
    case 'message.sent':
      console.log('Message sent:', payload.data.id);
      break;
    case 'session.status':
      console.log('Session status changed to:', payload.data.status);
      break;
    case 'messages.upsert':
      console.log('New message received:', payload.data.key.id);
      break;
    case 'messages.update':
      console.log('Message updated:', payload.data.key.id);
      break;
    case 'messages.delete':
      console.log('Message deleted:', payload.data.key.id);
      break;
    case 'message-receipt.update':
      console.log('Message receipt updated:', payload.data.key.id);
      break;
    case 'messages.reaction':
      console.log('Message reaction:', payload.data.key.id);
      break;
    case 'chats.upsert':
      console.log('New chat created:', payload.data.id);
      break;
    case 'chats.update':
      console.log('Chat updated:', payload.data.id);
      break;
    case 'chats.delete':
      console.log('Chat deleted:', payload.data.id);
      break;
    case 'groups.upsert':
      console.log('New group created:', payload.data.id);
      break;
    case 'groups.update':
      console.log('Group updated:', payload.data.id);
      break;
    case 'group-participants.update':
      console.log('Group participants updated:', payload.data.id);
      break;
    case 'contacts.upsert':
      console.log('New contact added:', payload.data.id);
      break;
    case 'contacts.update':
      console.log('Contact updated:', payload.data.id);
      break;
  }

  // Always respond with 200 OK to acknowledge receipt
  res.status(200).json({ received: true });
});

app.listen(3000, () => {
  console.log('Webhook server listening on port 3000');
});

Webhook Security

To ensure webhook requests are genuinely from WasenderApi, each request includes a signature header:
X-Webhook-Signature: <signature>

You can verify this signature using your webhook secret.

🔐 Important Notes

When you enable webhooks, a webhook secret is automatically generated for your session.

You can view this secret in your session management screen.

Always store this secret securely and never expose it in client-side code.

Webhook Payload Format
Example — Message Sent Payload
{
  "event": "message.sent",
  "timestamp": 1633456789,
  "data": {
    "id": "message-id-123",
    "to": "+1234567890",
    "status": "sent",
    "type": "text",
    "content": "Hello from WasenderApi!"
  }
}

Example — Session Status Change Payload
{
  "event": "session.status",
  "timestamp": 1633456789,
  "data": {
    "status": "connected", 
    "session_id": "your session api_key"
  }
}


💡 For complete documentation of all webhook payload formats, please refer to the WasenderApi API Documentation.

Best Practices

✅ Respond quickly:
Your webhook endpoint should respond with a 200 OK status code as quickly as possible.

⚙️ Process asynchronously:
Handle time-consuming operations after acknowledging the webhook.

🔁 Implement retry logic:
Be prepared to handle temporary failures in webhook delivery.

📊 Monitor webhook deliveries:
Set up logging to track webhook deliveries and processing.

🔒 Secure your endpoint:
Always verify the webhook signature and use HTTPS.

Troubleshooting
Common Issues
Issue	Cause / Fix
Webhook not receiving payloads	Verify that your endpoint is publicly accessible and that webhooks are enabled for your session
Invalid signature errors	Ensure you’re using the correct webhook secret for verification
Timeout errors	Make sure your webhook responds within a reasonable time (under 60 seconds)