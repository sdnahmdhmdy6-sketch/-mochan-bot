const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");
const { Pool } = require("pg");

const app = express();

// ===============================
// ⚙️ LINE
// ===============================

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);

// ===============================
// 🗄️ PostgreSQL
// ===============================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("error", (error) => {
  console.error("POSTGRES ERROR:", error);
});

// ===============================
// 👑 الأدمن
// ===============================

const ADMIN_USER_IDS = new Set(
  (process.env.MOCHAN_ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

function isAdmin(userId) {
  return userId && ADMIN_USER_IDS.has(userId);
}

// ===============================
// 🧱 إنشاء الجداول
// ===============================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      group_id TEXT PRIMARY KEY,
      approved BOOLEAN NOT NULL DEFAULT FALSE,
      muted BOOLEAN NOT NULL DEFAULT FALSE,
      approved_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT,
      display_name TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("DATABASE READY");
}

// ===============================
// 🔐 القروبات
// ===============================

async function getGroup(groupId) {
  const result = await pool.query(
    `SELECT * FROM groups WHERE group_id = $1`,
    [groupId]
  );

  return result.rows[0] || null;
}

async function approveGroup(groupId, userId) {
  await pool.query(
    `
    INSERT INTO groups
      (group_id, approved, muted, approved_by, updated_at)
    VALUES
      ($1, TRUE, FALSE, $2, NOW())
    ON CONFLICT (group_id)
    DO UPDATE SET
      approved = TRUE,
      approved_by = $2,
      updated_at = NOW()
    `,
    [groupId, userId]
  );
}

async function unapproveGroup(groupId) {
  await pool.query(
    `
    UPDATE groups
    SET approved = FALSE,
        updated_at = NOW()
    WHERE group_id = $1
    `,
    [groupId]
  );
}

async function setMuted(groupId, muted) {
  await pool.query(
    `
    INSERT INTO groups
      (group_id, approved, muted, updated_at)
    VALUES
      ($1, TRUE, $2, NOW())
    ON CONFLICT (group_id)
    DO UPDATE SET
      muted = $2,
      updated_at = NOW()
    `,
    [groupId, muted]
  );
}

// ===============================
// 👤 حفظ اسم العضو
// ===============================

async function saveMember(groupId, userId, displayName) {
  if (!groupId || !userId) return;

  await pool.query(
    `
    INSERT INTO members
      (group_id, user_id, display_name, last_seen)
    VALUES
      ($1, $2, $3, NOW())
    ON CONFLICT (group_id, user_id)
    DO UPDATE SET
      display_name = COALESCE($3, members.display_name),
      last_seen = NOW()
    `,
    [groupId, userId, displayName || null]
  );
}

// ===============================
// 🔎 جلب اسم العضو
// ===============================

async function getMemberName(groupId, userId) {
  const result = await pool.query(
    `
    SELECT display_name
    FROM members
    WHERE group_id = $1 AND user_id = $2
    `,
    [groupId, userId]
  );

  return result.rows[0]?.display_name || null;
}

// ===============================
// 📜 حفظ الرسائل
// ===============================

async function saveMessage(
  groupId,
  userId,
  displayName,
  message
) {
  if (!groupId || !message) return;

  await pool.query(
    `
    INSERT INTO messages
      (group_id, user_id, display_name, message)
    VALUES
      ($1, $2, $3, $4)
    `,
    [
      groupId,
      userId || null,
      displayName || null,
      message,
    ]
  );

  // نخلي قاعدة البيانات خفيفة:
  // نحذف الرسائل الأقدم من آخر 100 رسالة في كل قروب.
  await pool.query(
    `
    DELETE FROM messages
    WHERE group_id = $1
      AND id NOT IN (
        SELECT id
        FROM messages
        WHERE group_id = $1
        ORDER BY id DESC
        LIMIT 100
      )
    `,
    [groupId]
  );
}

// ===============================
// 🧠 جلب آخر السوالف
// ===============================

async function getRecentMessages(groupId) {
  const result = await pool.query(
    `
    SELECT display_name, message
    FROM messages
    WHERE group_id = $1
    ORDER BY id DESC
    LIMIT 15
    `,
    [groupId]
  );

  return result.rows.reverse();
}

// ===============================
// 🤖 Gemini
// ===============================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.5-flash-lite";

async function askGemini({
  message,
  displayName,
  groupId,
}) {
  const recentMessages = groupId
    ? await getRecentMessages(groupId)
    : [];

  const conversation = recentMessages
    .map((item) => {
      const name = item.display_name || "عضو";
      return `${name}: ${item.message}`;
    })
    .join("\n");

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
- رد على الشخص نفسه مباشرة.
- استخدم اسم الشخص أحيانًا إذا كان مناسبًا، ولا تكرره في كل رد.
- لا تتكلم بصيغة جماعية إذا الكلام موجه لشخص واحد.
- لا تبدأ كل رد بنفس الطريقة.
- لا تكرر نفس النكت أو الردود.
- لا تكون رسمي أبدًا.
- لا تقول إنك ذكاء اصطناعي إلا إذا سألوك بشكل مباشر.
- لا تكثر إيموجيات.

الترحيب:
- إذا شخص قال هلا أو السلام عليكم أو صباح الخير، رحب فيه بشكل عفوي.
- نوّع الترحيبات.
- إذا شخص جديد، رحب فيه وكأنك تعرفه من زمان.
- لا تستخدم نفس الترحيب كل مرة.

النكت والطقطقة:
- عط نكت قصيرة من وقت لوقت.
- إذا أحد قال شيء يضحك، طقطق عليه.
- إذا أحد طقطق عليك، رد عليه بطقطقة أقوى.
- إذا أحد قال شيء غريب أو محرج، استغل الموقف بطقطقة خفيفة.
- لا تكون جارح.
- لا تجعل كل رد نكتة.

السوالف:
- إذا أحد فتح موضوع، ادخل معه.
- اسأل أسئلة أحيانًا عشان تستمر السالفة.
- خلك فضولي ولقاف بشكل مضحك.
- إذا أحد يشتكي، تفاعل معه طبيعي.
- إذا أحد يسأل سؤال، جاوبه بوضوح وباختصار.
- إذا الكلام يحتاج شرح، اشرح ببساطة.

الذاكرة والسياق:
- اعتبر السوالف السابقة الموجودة أمامك سياقًا حقيقيًا للقروب.
- إذا كان الكلام مرتبطًا برسالة سابقة، اربط بينهم.
- لا تخترع معلومات عن الأعضاء.
- إذا ما تعرف معلومة عن شخص، لا تدعي أنك تعرفها.
- لا تذكر للمستخدم أنك تحفظ الرسائل أو تستخدم قاعدة بيانات.
- استخدم المعلومات السابقة فقط بطريقة طبيعية.

المهم:
خلك واحد من القروب، سريع بديهة، لقاف، مضحك، وتلقط السالفة بسرعة.

اسم الشخص الحالي:
${displayName || "غير معروف"}

آخر السوالف:
${conversation || "ما فيه سوالف سابقة."}
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
    console.error(
      "GEMINI ERROR:",
      JSON.stringify(data)
    );

    throw new Error(
      `Gemini API error: ${response.status}`
    );
  }

  const reply =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

  return reply || "وش تقول إنت 😂";
}

// ===============================
// 🚪 الخروج
// ===============================

async function leaveGroup(groupId) {
  const response = await fetch(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(
      groupId
    )}/leave`,
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
// 👤 الحصول على اسم عضو القروب
// ===============================

async function getLineDisplayName(
  groupId,
  userId
) {
  if (!groupId || !userId) return null;

  try {
    const profile =
      await lineClient.getGroupMemberProfile(
        groupId,
        userId
      );

    return profile.displayName || null;
  } catch (error) {
    console.error(
      "PROFILE ERROR:",
      error.message
    );

    return null;
  }
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
        const message =
          event.message.text.trim();

        const userId =
          event.source?.userId;

        const sourceType =
          event.source?.type;

        const groupId =
          event.source?.groupId;

        const normalized = message
          .replace(/\s+/g, " ")
          .trim();

        console.log(
          "MESSAGE:",
          message
        );

        console.log(
          "USER ID:",
          userId
        );

        // ===============================
        // 🆔 هويتي
        // ===============================

        if (
          normalized === "موشان هويتي"
        ) {
          console.log(
            "================================"
          );

          console.log(
            "MOCHAN USER ID:",
            userId
          );

          console.log(
            "SOURCE TYPE:",
            sourceType
          );

          console.log(
            "================================"
          );

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text:
                "تم 😂 شيكي Render Logs، ما راح أطلع الآيدي بالقروب.",
            }
          );

          continue;
        }

        // ===============================
        // 👑 من أنا
        // ===============================

        if (
          normalized === "موشان من أنا"
        ) {
          const reply = isAdmin(userId)
            ? "إيه إيه، أنتِ من الإدارة 👑 لا تستغلين السلطة بس 😂"
            : "أنتِ عضو عادي يا بعدي 😂 لا تحاولين تصيرين مديرة.";

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text: reply,
            }
          );

          continue;
        }

        // ===============================
        // 🔐 اعتماد القروب
        // ===============================

        if (
          normalized ===
            "موشان اعتمد القروب" ||
          normalized ===
            "موشان اعتماد القروب"
        ) {
          if (!isAdmin(userId)) {
            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text:
                  "ههههه لا يا حبيبي 😂 الاعتماد للأدمن بس.",
              }
            );

            continue;
          }

          if (
            sourceType !== "group" ||
            !groupId
          ) {
            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text:
                  "الأمر هذا للقروبات بس 😂",
              }
            );

            continue;
          }

          await approveGroup(
            groupId,
            userId
          );

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text:
                "تم اعتماد القروب 👑 خلاص صرت واحد منكم، الله يعينكم علي 😂",
            }
          );

          continue;
        }

        // ===============================
        // 🗑️ إلغاء اعتماد القروب
        // ===============================

        if (
          normalized ===
            "موشان الغي اعتماد القروب" ||
          normalized ===
            "موشان احذف القروب"
        ) {
          if (!isAdmin(userId)) {
            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text:
                  "لا لا، هذي صلاحيات الإدارة 😂",
              }
            );

            continue;
          }

          if (!groupId) continue;

          await unapproveGroup(
            groupId
          );

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text:
                "تم إلغاء اعتماد القروب، بسكت من الحين 🤐",
            }
          );

          continue;
        }

        // ===============================
        // 🚪 اطلع
        // ===============================

        if (
          normalized === "موشان اطلع" ||
          normalized ===
            "موشان اطلع من القروب"
        ) {
          if (!isAdmin(userId)) {
            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text:
                  "هههههههه على كيفك؟ أنت مو من الإدارة 😂",
              }
            );

            continue;
          }

          if (
            sourceType !== "group" ||
            !groupId
          ) {
            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text:
                  "ما أقدر أطلع من هنا، الأمر هذا للقروبات بس 😂",
              }
            );

            continue;
          }

          await unapproveGroup(
            groupId
          );

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text:
                "تم، بسحب نفسي قبل لا أندم 😂",
            }
          );

          await leaveGroup(groupId);

          continue;
        }

        // ===============================
        // 🤐 اسكت
        // ===============================

        if (
          normalized === "موشان اسكت" ||
          normalized ===
            "موشان وضع هدوء"
        ) {
          if (!isAdmin(userId)) {
            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text:
                  "لا تأمرني يا حبيبي 😂",
              }
            );

            continue;
          }

          if (!groupId) continue;

          await setMuted(
            groupId,
            true
          );

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text:
                "تم، بسكت 🤐 وإذا سمعتوا صوتي اعتبروني أهوجس.",
            }
          );

          continue;
        }

        // ===============================
        // 🗣️ تكلم
        // ===============================

        if (
          normalized === "موشان تكلم" ||
          normalized ===
            "موشان وضع سوالف"
        ) {
          if (!isAdmin(userId)) {
            await lineClient.replyMessage(
              event.replyToken,
              {
                type: "text",
                text:
                  "وأنت وش دخلك؟ 😂",
              }
            );

            continue;
          }

          if (!groupId) continue;

          await setMuted(
            groupId,
            false
          );

          await lineClient.replyMessage(
            event.replyToken,
            {
              type: "text",
              text:
                "رجعتتت 😂 يلا وش السالفة؟",
            }
          );

          continue;
        }

        // ===============================
        // 🔒 أي قروب غير معتمد
        // ===============================

        if (
          sourceType === "group" &&
          groupId
        ) {
          const group =
            await getGroup(groupId);

          if (!group?.approved) {
            console.log(
              "UNAPPROVED GROUP:",
              groupId
            );

            continue;
          }

          if (group.muted) {
            continue;
          }
        }

        // ===============================
        // 👤 اسم العضو
        // ===============================

        let displayName = null;

        if (
          sourceType === "group" &&
          groupId &&
          userId
        ) {
          displayName =
            await getLineDisplayName(
              groupId,
              userId
            );

          if (!displayName) {
            displayName =
              await getMemberName(
                groupId,
                userId
              );
          }

          await saveMember(
            groupId,
            userId,
            displayName
          );
        }

        // ===============================
        // 💾 حفظ الرسالة
        // ===============================

        if (
          sourceType === "group" &&
          groupId
        ) {
          await saveMessage(
            groupId,
            userId,
            displayName,
            message
          );
        }

        // ===============================
        // 🤖 الرد
        // ===============================

        const reply =
          await askGemini({
            message,
            displayName,
            groupId,
          });

        console.log(
          "GEMINI RESPONSE:",
          reply
        );

        await lineClient.replyMessage(
          event.replyToken,
          {
            type: "text",
            text: reply.slice(
              0,
              5000
            ),
          }
        );

        console.log(
          "REPLY SENT"
        );

      } catch (error) {
        console.error(
          "BOT ERROR:",
          error
        );
      }
    }
  }
);

// ===============================
// 🏠 الصفحة الرئيسية
// ===============================

app.get("/", (req, res) => {
  res.send(
    "Mochan is running 🤖"
  );
});

// ===============================
// 🚀 تشغيل السيرفر
// ===============================

const PORT =
  process.env.PORT || 3000;

async function startServer() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      () => {
        console.log(
          `Mochan running on port ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "DATABASE STARTUP ERROR:",
      error
    );

    process.exit(1);
  }
}

startServer();
