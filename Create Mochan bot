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
  res.status(200).end();

  for (const event of req.body.events) {
    if (event.type !== "message" || event.message.type !== "text") {
      continue;
    }

    try {
      const response = await openai.responses.create({
        model: "gpt-5-mini",
        instructions:
          "أنت Mochan، بوت سعودي مضحك في قروب سوالف وضحك. رد على رسائل الأعضاء باللهجة السعودية بشكل طبيعي وسريع. كن خفيف دم، طقطق بدون تجريح، وافهم سياق الكلام. لا تكرر نفس الردود كثيرًا. لا تذكر أنك ذكاء اصطناعي إلا إذا سُئلت.",
        input: event.message.text,
      });

      await lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: response.output_text,
      });
    } catch (error) {
      console.error(error);
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
