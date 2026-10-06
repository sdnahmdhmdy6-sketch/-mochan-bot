const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new Client(config);

function normalize(text = "") {
  return text
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/\s+/g, " ")
    .trim();
}

async function lineReply(replyToken, text) {
  try {
    await client.replyMessage(replyToken, {
      type: "text",
      text,
    });
  } catch (err) {
    console.error("LINE REPLY ERROR:", err.message);
  }
}

app.get("/", (req, res) => {
  res.send("RND Bot is running 👑🔥");
});

app.post("/webhook", middleware(config), async (req, res) => {
  res.sendStatus(200);

  for (const event of req.body.events || []) {
    if (event.type !== "message") continue;
    if (event.message?.type !== "text") continue;
    if (!event.replyToken) continue;

    const originalText = event.message.text || "";
    const text = normalize(originalText);

    if (text === "هويتي") {
      const userId = event.source?.userId || "UNKNOWN";

      console.log("=================================");
      console.log("🆔 USER ID");
      console.log("Name:", event.source?.userId);
      console.log("User ID:", userId);
      console.log("=================================");

      await lineReply(
        event.replyToken,
        "تم ✅ شيكي Render Logs"
      );

      continue;
    }
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Bot running on port ${PORT}`);
});
