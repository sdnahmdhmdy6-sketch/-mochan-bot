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

// ===============================
// 👑 الأدمن
// ===============================

const ADMIN_USER_IDS = new Set(
  (process.env.MOCHAN_ADMIN_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean)
);

// القروبات اللي موشان ساكت فيها
const mutedGroups = new Set();

function isAdmin(userId) {
  return userId && ADMIN_USER_IDS.has(userId);
}

// ===============================
// 🤖 Gemini
// ===============================

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
أنت Mochan، شخص حقيقي وعضو في قروب "سوالف وضحك".

شخصيتك:
- تكلم باللهجة السعودية العامية فقط.
- لا تستخدم الفصحى.
- خلك عفوي جدًا وكأنك شخص حقيقي ماسك جواله ويسولف.
- رد على الشخص نفسه مباشرة، لا تتكلم بصيغة جماعية.
- لا تقول "يا جماعة" إلا إذا الكلام فعلًا موجه للجميع.
- لا تبدأ كل رد بنفس الطريقة.
- لا تكرر نفس النكت أو الردود.
- لا تكون رسمي أبدًا.
- لا تقول إنك ذكاء اصطناعي إلا إذا سألوك بشكل مباشر.
- لا تكثر إيموجيات.

الترحيب:
- إذا شخص قال هلا أو السلام عليكم أو صباح الخير أو دخل يسولف، رحب فيه بطريقة عفوية ومضحكة.
- نوّع الترحيبات.
- إذا شخص جديد بالقروب، رحب فيه وكأنك تعرفه من زمان.
- لا تستخدم نفس الترحيب كل مرة.

النكت والطقطقة:
- عط نكت قصيرة من وقت لوقت.
- إذا أحد قال شيء يضحك، طقطق عليه.
- إذا أحد طقطق عليك، رد عليه بطقطقة أقوى.
- إذا أحد قال شيء غريب أو محرج، استغل الموقف بالطقطقة الخفيفة.
- لا تكون ثقيل أو جارح.
- لا تجعل كل رد نكتة؛ خلي كلامك طبيعي.

السوالف:
- إذا أحد فتح موضوع، ادخل معه بالسوالف.
- اسأله أسئلة أحيانًا عشان تستمر السالفة.
- خلك فضولي ولقاف بشكل مضحك.
- إذا أحد يشتكي، تفاعل معه طبيعي.
- إذا أحد يسأل سؤال، جاوبه بوضوح وباختصار.
- إذا الكلام يحتاج شرح، اشرح بشكل بسيط.

أهم شيء:
خلك واحد من القروب، سريع بديهة، لقاف، مضحك، وتلقط السالفة بسرعة.
`
          }
        ]
      },

      contents: [
        {
          role: "user",
          parts: [
            {
              text: message
            }
          ]
        }
      ]
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

// ===============================
// 🚪 خروج من القروب
// ===============================

async function leaveGroup(groupId) {
  const response = await fetch(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/leave`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lineConfig.channelAccessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `LINE LEAVE ERROR ${response.status}: ${errorText}`
    );
  }

  console.log("MOCHAN LEFT GROUP:", groupId);
}

// ===============================
// 💬 Webhook
// ===============================

app.post(
  "/webhook",
  middleware(lineConfig),
  async (req, res) => {

    console.log(
      "LINE EVENT RECEIVED:",
      JSON.stringify(req.body)
    );

    res.status(200).end();

    for (const event of req.body.events || []) {

      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      try {

        const message = event.message.text.trim();

        const userId = event.source?.userId;
        const sourceType = event.source?.type;
        const groupId = event.source?.groupId;

        const normalized = message
          .replace(/\s+/g, " ")
          .trim();

        console.log("MESSAGE:", message);
        console.log("USER ID:", userId);

        // =========================================
        // 🆔 معرفة ID المستخدم
        // =========================================

        if (normalized === "موشان هويتي") {

          console.log("================================");
          console.log("MOCHAN USER ID:", userId);
          console.log("SOURCE TYPE:", sourceType);
          console.log("================================");

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text: "تم 😂 شيكي Render Logs، ما راح أطلع الآيدي بالقروب."
            }
          );

          continue;
        }

        // =========================================
        // 👑 معرفة هل الشخص أدمن
        // =========================================

        if (normalized === "موشان من أنا") {

          const reply = isAdmin(userId)
            ? "إيه إيه، أنتِ من الإدارة 👑 لا تستغلين السلطة بس 😂"
            : "أنتِ عضو عادي يا بعدي 😂 لا تحاولين تصيرين مديرة.";

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text: reply
            }
          );

          continue;
        }

        // =========================================
        // 🚪 موشان اطلع
        // =========================================

        if (
          normalized === "موشان اطلع" ||
          normalized === "موشان اطلع من القروب"
        ) {

          if (!isAdmin(userId)) {

            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text: "هههههههه على كيفك؟ أنت مو من الإدارة 😂"
              }
            );

            continue;
          }

          if (sourceType !== "group" || !groupId) {

            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text: "ما أقدر أطلع من هنا، الأمر هذا للقروبات بس 😂"
              }
            );

            continue;
          }

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text: "تم، بسحب نفسي قبل لا أندم 😂"
            }
          );

          await leaveGroup(groupId);

          continue;
        }

        // =========================================
        // 🤐 موشان اسكت
        // =========================================

        if (
          normalized === "موشان اسكت" ||
          normalized === "موشان وضع هدوء"
        ) {

          if (!isAdmin(userId)) {

            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text: "لا تأمرني يا حبيبي 😂"
              }
            );

            continue;
          }

          if (!groupId) continue;

          mutedGroups.add(groupId);

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text: "تم، بسكت 🤐 وإذا سمعتوا صوتي اعتبروني أهوجس."
            }
          );

          continue;
        }

        // =========================================
        // 🗣️ موشان تكلم
        // =========================================

        if (
          normalized === "موشان تكلم" ||
          normalized === "موشان وضع سوالف"
        ) {

          if (!isAdmin(userId)) {

            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text: "وأنت وش دخلك؟ 😂"
              }
            );

            continue;
          }

          if (!groupId) continue;

          mutedGroups.delete(groupId);

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text: "رجعتتت 😂 يلا وش السالفة؟"
            }
          );

          continue;
        }

        // =========================================
        // 🤐 إذا القروب مكتوم
        // =========================================

        if (
          sourceType === "group" &&
          groupId &&
          mutedGroups.has(groupId)
        ) {
          continue;
        }

        // =========================================
        // 🤖 الرد الطبيعي
        // =========================================

        const reply = await askGemini(message);

        console.log("GEMINI RESPONSE:", reply);

        await lineClient.replyMessage(
          event.replyToken,
          {
            type: "text",
            text: reply.slice(0, 5000)
          }
        );

        console.log("REPLY SENT");

      } catch (error) {

        console.error("BOT ERROR:", error);

      }
    }
  }
);

// ===============================
// 🏠 الصفحة الرئيسية
// ===============================

app.get("/", (req, res) => {
  res.send("Mochan is running 🤖");
});

// ===============================
// 🚀 تشغيل السيرفر
// ===============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Mochan running on port ${PORT}`);
});
