const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");
const OpenAI = require("openai");

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/webhook", middleware(lineConfig), async (req, res) => {
  console.log("LINE EVENT RECEIVED:", JSON.stringify(req.body));

  res.status(200).end();

  for (const event of req.body.events || []) {
    if (event.type !== "message" || event.message.type !== "text") {
      continue;
    }

    try {
      console.log("MESSAGE:", event.message.text);

      const response = await openai.responses.create({
        model: "gpt-5-mini",
        instructions:
          "أنت Mochan، بوت سعودي مضحك في قروب سوالف وضحك. رد باللهجة السعودية بشكل طبيعي وسريع. كن خفيف دم وطقطق بدون تجريح. افهم سياق الكلام ولا تكرر نفس الردود كثيرًا. لا تذكر أنك ذكاء اصطناعي إلا إذا سُئلت.",
        input: event.message.text,
      });

      console.log("OPENAI RESPONSE:", response.output_text);

      await lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: response.output_text || "وش ذا الكلام؟ 😂",
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
