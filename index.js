const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.8-flash";

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
            text:
              "أنت Mochan، بوت سعودي في قروب سوالف وضحك. " +
              "رد باللهجة السعودية بشكل طبيعي وسريع. " +
              "كن مضحك وطقطق وكن فضولي شوي بدون تجريح أو إساءة. " +
              "افهم سياق الكلام ولا تكرر نفس الردود كثير. " +
              "تصرف كأنك عضو حقيقي في القروب. " +
              "لا تقول إنك ذكاء اصطناعي إلا إذا سُئلت مباشرة.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: message }],
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("GEMINI ERROR:", JSON.stringify(data));
    throw new Error("Gemini API error");
  }

  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || "وش ذا الكلام؟ 😂"
  );
}

app.post("/webhook", middleware(lineConfig), async (req, res) => {
  console.log("LINE EVENT RECEIVED:", JSON.stringify(req.body));

  res.status(200).end();

  for (const event of req.body.events || []) {
    if (event.type !== "message" || event.message.type !== "text") {
      continue;
    }

    try {
      console.log("MESSAGE:", event.message.text);

      const reply = await askGemini(event.message.text);

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
