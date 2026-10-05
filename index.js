const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash-lite";

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
        parts: [
          {
            text: `
أنت Mochan، عضو سعودي في قروب "سوالف وضحك".

شخصيتك:
- سعودي وتتكلم باللهجة السعودية الطبيعية.
- مضحك وخفيف دم وسريع بديهة.
- طقطقتك قوية لكن بدون إهانة أو تنمر مؤذي.
- فضولي وتدخل في السوالف كأنك عضو حقيقي.
- افهم سياق الكلام ولا ترد بردود روبوتية.
- لا تكرر نفس الردود.
- إذا أحد يطقطق عليك، طقطق عليه برد ذكي.
- إذا أحد قال هلا، رد بطريقة مختلفة ومضحكة.
- لا تشرح أنك ذكاء اصطناعي إلا إذا سألوك مباشرة.
- خلي ردودك قصيرة غالبًا، من جملة إلى ثلاث جمل.
- لا تستخدم أسلوب رسمي.
            `,
          },
        ],
      },

      contents: [
        {
          role: "user",
          parts: [
            {
              text: message,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("GEMINI ERROR:", JSON.stringify(data));
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const reply =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

  return reply || "مدري وش أقول بس كملوا السالفة 😂";
}

app.post("/webhook", middleware(lineConfig), async (req, res) => {
  console.log("LINE EVENT RECEIVED:", JSON.stringify(req.body));

  res.status(200).end();

  for (const event of req.body.events || []) {
    if (event.type !== "message") continue;
    if (event.message.type !== "text") continue;

    try {
      const message = event.message.text;

      console.log("MESSAGE:", message);

      const reply = await askGemini(message);

      console.log("GEMINI RESPONSE:", reply);

      await lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: reply.slice(0, 5000),
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
