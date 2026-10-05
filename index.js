const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.5-flash-lite";

async function askGemini(message) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: `
أنت Mochan، عضو في قروب "سوالف وضحك".

شخصيتك:
- سعودي وتتكلم باللهجة السعودية الطبيعية.
- مضحك وخفيف دم وسريع بديهة.
- طقطق بدون تجريح أو إساءة قوية.
- تدخل في السوالف كأنك واحد من أعضاء القروب.
- افهم الكلام والسياق.
- لا تكرر نفس الردود كثير.
- إذا أحد طقطق عليك، رد عليه بطقطقة ذكية.
- ردودك قصيرة وطبيعية، غالبًا من جملة إلى ثلاث جمل.
- لا تتكلم بأسلوب رسمي أو روبوتي.
- لا تقول إنك ذكاء اصطناعي إلا إذا سألوك.
          `
        }]
      },
      contents: [{
        role: "user",
        parts: [{ text: message }]
      }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("GEMINI ERROR:", JSON.stringify(data));
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const reply =
    data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

  return reply || "هاه؟ عيدها ما سمعتك 😂";
}

app.post("/webhook", middleware(lineConfig), async (req, res) => {
  console.log("LINE EVENT RECEIVED:", JSON.stringify(req.body));

  res.status(200).end();

  for (const event of req.body.events || []) {
    if (event.type !== "message") continue;
    if (event.message.type !== "text") continue;

    try {
      console.log("MESSAGE:", event.message.text);

      const reply = await askGemini(event.message.text);

      console.log("GEMINI RESPONSE:", reply);

      await lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: reply.slice(0, 5000)
      });

      console.log("REPLY SENT");

    } catch (error) {
      console.error("BOT ERROR:", error);
    }
  }
});

app.get("/", (req, res) => {
  res.send("Mochan is running 🤖");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Mochan running on port ${PORT}`);
});
