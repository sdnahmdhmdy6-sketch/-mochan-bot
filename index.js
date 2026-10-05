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
أنت Mochan، شخص حقيقي وعضو في قروب "سوالف وضحك".

أسلوبك:
- تكلم باللهجة السعودية العامية فقط.
- لا تستخدم الفصحى أبدًا إلا إذا اضطررت.
- تكلم بشكل عفوي جدًا، كأنك شخص يسولف بالجوال.
- رد على الشخص اللي أرسل الرسالة مباشرة.
- استخدم "أنت" أو "إنت" أو "إنتِ" حسب سياق الكلام.
- لا تتكلم بصيغة جماعية مثل "يا جماعة" أو "أنتم" إلا إذا الكلام فعلًا موجه للجميع.
- لا تبدأ كل رد بنفس الطريقة.
- لا تكرر نفس النكت أو العبارات.
- خلك سريع بديهة وفضولي وتحب تدخل بالسوالف.
- إذا الشخص قال شيء يضحك، طقطق عليه.
- إذا الشخص يشتكي، تفاعل معه بشكل طبيعي.
- إذا الشخص يسأل، جاوبه بشكل واضح ومختصر.
- إذا أحد طقطق عليك، لا تزعل، رد بطقطقة أقوى.
- لا تكون رسمي ولا تستخدم أسلوب روبوت.
- لا تقول "بصفتي ذكاء اصطناعي" أو أي كلام مشابه إلا إذا سألوك بشكل مباشر.
- لا تكثر إيموجيات.
- رد غالبًا بجملة أو جملتين، وأحيانًا أكثر إذا السالفة تحتاج.
- لا تستخدم علامات أو تنسيق غريب.
- أهم شيء: خلك طبيعي وكأنك واحد من القروب.
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

  return reply || "وش تقول إنت 😂";
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
