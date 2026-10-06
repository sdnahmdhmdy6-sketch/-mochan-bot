const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");
const { Pool } = require("pg");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 10000;

// =========================
// ENVIRONMENT
// =========================

const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET?.trim();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const DATABASE_URL = process.env.DATABASE_URL?.trim();

if (!ACCESS_TOKEN) {
  console.error("❌ LINE_CHANNEL_ACCESS_TOKEN is missing or empty.");
  process.exit(1);
}

if (!CHANNEL_SECRET) {
  console.error("❌ LINE_CHANNEL_SECRET is missing or empty.");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing or empty.");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing or empty.");
  process.exit(1);
}

console.log("✅ Environment variables loaded.");

// =========================
// LINE
// =========================

const lineConfig = {
  channelAccessToken: ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET
};

const lineClient = new Client(lineConfig);

// =========================
// DATABASE
// =========================

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// =========================
// ADMINS
// كل أدمن في خانة مستقلة:
// MOCHAN_ADMIN_1
// MOCHAN_ADMIN_2
// MOCHAN_ADMIN_3
// ...إلخ
// =========================

const ADMIN_USER_IDS = new Set(
  Object.keys(process.env)
    .filter(key => /^MOCHAN_ADMIN_\d+$/.test(key))
    .map(key => process.env[key]?.trim())
    .filter(Boolean)
);

console.log(
  `👑 Admins loaded: ${ADMIN_USER_IDS.size}`
);

function isAdmin(userId) {
  return ADMIN_USER_IDS.has(userId);
}

// =========================
// DATABASE SETUP
// =========================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      group_id TEXT PRIMARY KEY,
      approved BOOLEAN DEFAULT FALSE,
      muted BOOLEAN DEFAULT FALSE,
      approved_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      group_id TEXT,
      user_id TEXT,
      display_name TEXT,
      last_seen TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      group_id TEXT,
      user_id TEXT,
      display_name TEXT,
      message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ Database ready.");
}

// =========================
// GROUP
// =========================

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
    UPDATE groups
    SET muted = $2,
        updated_at = NOW()
    WHERE group_id = $1
    `,
    [groupId, muted]
  );
}

// =========================
// MEMBERS
// =========================

async function saveMember(groupId, userId, displayName) {
  await pool.query(
    `
    INSERT INTO members
      (group_id, user_id, display_name, last_seen)
    VALUES
      ($1, $2, $3, NOW())
    ON CONFLICT (group_id, user_id)
    DO UPDATE SET
      display_name = $3,
      last_seen = NOW()
    `,
    [groupId, userId, displayName]
  );
}

async function getLineDisplayName(groupId, userId) {
  try {
    const profile = await lineClient.getGroupMemberProfile(
      groupId,
      userId
    );

    return profile.displayName || "عضو";
  } catch (error) {
    console.error(
      "⚠️ Could not get LINE profile:",
      error.message
    );

    return "عضو";
  }
}

// =========================
// MESSAGES
// =========================

async function saveMessage(
  groupId,
  userId,
  displayName,
  message
) {
  await pool.query(
    `
    INSERT INTO messages
      (group_id, user_id, display_name, message)
    VALUES
      ($1, $2, $3, $4)
    `,
    [groupId, userId, displayName, message]
  );

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

// =========================
// AI
// =========================

const openai = new OpenAI({
  apiKey: GEMINI_API_KEY,
  baseURL:
    "https://generativelanguage.googleapis.com/v1beta/openai/"
});

async function askMochan(
  displayName,
  message,
  recentMessages
) {
  const history = recentMessages
    .map(
      item =>
        `${item.display_name}: ${item.message}`
    )
    .join("\n");

  const prompt = `
أنت موشان، عضو حقيقي في قروب سعودي اسمه "سوالف وضحك".

تكلم باللهجة السعودية بشكل طبيعي جدًا.
كن عفوي وخفيف دم.
لا تتكلم كأنك روبوت.
لا تقل إنك ذكاء اصطناعي إلا إذا سُئلت بشكل مباشر.
تفاعل مع السالفة الحالية.
استخدم اسم الشخص أحيانًا بشكل طبيعي.
لا تكرر الاسم في كل رسالة.
لا تطول في الرد بدون سبب.

اسم الشخص:
${displayName}

رسالته:
${message}

آخر السوالف:
${history}
`;

  const response = await openai.chat.completions.create({
    model: "gemini-3.5-flash-lite",
    messages: [
      {
        role: "system",
        content: prompt
      },
      {
        role: "user",
        content: message
      }
    ],
    temperature: 0.9,
    max_tokens: 300
  });

  return (
    response.choices?.[0]?.message?.content?.trim() ||
    "وش تقول أنت 😂"
  );
}

// =========================
// REPLY
// =========================

async function replyMessage(replyToken, text) {
  await lineClient.replyMessage(replyToken, {
    type: "text",
    text
  });
}

// =========================
// WEBHOOK
// =========================

app.post(
  "/webhook",
  middleware(lineConfig),
  async (req, res) => {
    try {
      const events = req.body.events || [];

      for (const event of events) {
        // =========================
        // JOIN
        // =========================

        if (event.type === "join") {
          console.log("👋 Mochan joined a group.");
          continue;
        }

        // =========================
        // TEXT ONLY
        // =========================

        if (
          event.type !== "message" ||
          event.message?.type !== "text"
        ) {
          continue;
        }

        const text = event.message.text.trim();
        const source = event.source;

        if (source.type !== "group") {
          continue;
        }

        const groupId = source.groupId;
        const userId = source.userId;

        const displayName =
          await getLineDisplayName(
            groupId,
            userId
          );

        // =========================
        // ID
        // =========================

        if (text === "موشان هويتي") {
          console.log(`👤 USER ID: ${userId}`);

          await replyMessage(
            event.replyToken,
            "تم تسجيل هويتك عندي، ما راح أطلعها بالقروب."
          );

          continue;
        }

        // =========================
        // WHO AM I
        // =========================

        if (text === "موشان من أنا") {
          const reply = isAdmin(userId)
            ? "أنت من الإداريين عندي 👑"
            : "أنت عضو بالقروب، وأموري معك طيبة 😂";

          await replyMessage(
            event.replyToken,
            reply
          );

          continue;
        }

        // =========================
        // APPROVE GROUP
        // =========================

        if (
          text === "موشان اعتمد القروب" ||
          text === "موشان اعتماد القروب"
        ) {
          if (!isAdmin(userId)) {
            await replyMessage(
              event.replyToken,
              "ما عندك صلاحية تعتمد القروب."
            );

            continue;
          }

          await approveGroup(
            groupId,
            userId
          );

          await replyMessage(
            event.replyToken,
            "تم اعتماد القروب 👑 خلاص صرت واحد منكم، الله يعينكم علي 😂"
          );

          continue;
        }

        // =========================
        // UNAPPROVE
        // =========================

        if (
          text === "موشان الغي اعتماد القروب" ||
          text === "موشان احذف القروب"
        ) {
          if (!isAdmin(userId)) {
            await replyMessage(
              event.replyToken,
              "ما عندك صلاحية."
            );

            continue;
          }

          await unapproveGroup(groupId);

          await replyMessage(
            event.replyToken,
            "تم إلغاء اعتماد القروب."
          );

          continue;
        }

        // =========================
        // LEAVE
        // =========================

        if (
          text === "موشان اطلع" ||
          text === "موشان اطلع من القروب"
        ) {
          if (!isAdmin(userId)) {
            await replyMessage(
              event.replyToken,
              "ما عندك صلاحية تطلعني 😂"
            );

            continue;
          }

          await unapproveGroup(groupId);

          await replyMessage(
            event.replyToken,
            "خلاص باي، الله يسامحكم 😂"
          );

          try {
            await lineClient.leaveGroup(groupId);
          } catch (error) {
            console.error(
              "❌ Leave group error:",
              error.message
            );
          }

          continue;
        }

        // =========================
        // MUTE
        // =========================

        if (
          text === "موشان اسكت" ||
          text === "موشان وضع هدوء"
        ) {
          if (!isAdmin(userId)) {
            await replyMessage(
              event.replyToken,
              "ما عندك صلاحية تسكتني 😂"
            );

            continue;
          }

          const group = await getGroup(groupId);

          if (!group?.approved) {
            await replyMessage(
              event.replyToken,
              "القروب مو معتمد عندي."
            );

            continue;
          }

          await setMuted(groupId, true);

          await replyMessage(
            event.replyToken,
            "تم تفعيل وضع الهدوء 🤐"
          );

          continue;
        }

        // =========================
        // UNMUTE
        // =========================

        if (
          text === "موشان تكلم" ||
          text === "موشان وضع سوالف"
        ) {
          if (!isAdmin(userId)) {
            await replyMessage(
              event.replyToken,
              "ما عندك صلاحية."
            );

            continue;
          }

          const group = await getGroup(groupId);

          if (!group?.approved) {
            await replyMessage(
              event.replyToken,
              "القروب مو معتمد عندي."
            );

            continue;
          }

          await setMuted(groupId, false);

          await replyMessage(
            event.replyToken,
            "رجعت سوالف، الله يستر 😂"
          );

          continue;
        }

        // =========================
        // CHECK APPROVAL
        // =========================

        const group = await getGroup(groupId);

        if (!group?.approved) {
          continue;
        }

        if (group.muted) {
          continue;
        }

        // =========================
        // SAVE MEMBER
        // =========================

        await saveMember(
          groupId,
          userId,
          displayName
        );

        // =========================
        // SAVE MESSAGE
        // =========================

        await saveMessage(
          groupId,
          userId,
          displayName,
          text
        );

        // =========================
        // MEMORY
        // =========================

        const recentMessages =
          await getRecentMessages(groupId);

        // =========================
        // AI RESPONSE
        // =========================

        try {
          const answer =
            await askMochan(
              displayName,
              text,
              recentMessages
            );

          await replyMessage(
            event.replyToken,
            answer
          );
        } catch (error) {
          console.error(
            "❌ AI ERROR:",
            error.message
          );

          await replyMessage(
            event.replyToken,
            "لحظة مخي علق 😂 عطوني شوي."
          );
        }
      }

      res.sendStatus(200);
    } catch (error) {
      console.error(
        "❌ WEBHOOK ERROR:",
        error
      );

      res.sendStatus(500);
    }
  }
);

// =========================
// HOME
// =========================

app.get("/", (req, res) => {
  res.send("Mochan is running 🤖");
});

// =========================
// START
// =========================

async function start() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `🚀 Mochan running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "❌ STARTUP ERROR:",
      error
    );

    process.exit(1);
  }
}

start();
