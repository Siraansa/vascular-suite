const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Simple in-memory store (messages persist while Glitch is running)
// For production use Supabase - but this works great to start
let messages = [];

// ── Twilio webhook — Twilio calls this when a patient WhatsApps you
app.post('/webhook/whatsapp', (req, res) => {
  const from = (req.body.From || '').replace('whatsapp:', '');
  const body = req.body.Body || '';
  const sid  = req.body.MessageSid || '';
  
  if(from && body) {
    messages.unshift({
      id: Date.now(),
      phone: from,
      message: body,
      direction: 'inbound',
      status: 'unread',
      twilio_sid: sid,
      created_at: new Date().toISOString()
    });
    // Keep last 200 messages
    if(messages.length > 200) messages = messages.slice(0, 200);
    console.log('New WhatsApp from', from, ':', body.substring(0, 50));
  }
  
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// ── GET messages — VascularSuite calls this when staff click Refresh
app.get('/messages', (req, res) => {
  res.json({ messages });
});

// ── POST send — VascularSuite calls this to send a reply
app.post('/send', async (req, res) => {
  try {
    const { to, body, twilioSid, twilioToken, twilioFrom } = req.body;
    if(!to || !body) return res.status(400).json({ error: 'Missing to or body' });

    const params = new URLSearchParams();
    params.append('From', 'whatsapp:' + twilioFrom);
    params.append('To',   'whatsapp:' + to);
    params.append('Body', body);

    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(twilioSid + ':' + twilioToken).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      }
    );
    const data = await r.json();
    if(!r.ok) throw new Error(data.message || 'Twilio error ' + r.status);

    // Save outbound message
    messages.unshift({
      id: Date.now(),
      phone: to,
      message: body,
      direction: 'outbound',
      status: 'sent',
      created_at: new Date().toISOString()
    });

    res.json({ success: true, sid: data.sid });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'VascularSuite WhatsApp server running',
    messages: messages.length,
    time: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('VascularSuite server on port', PORT));
