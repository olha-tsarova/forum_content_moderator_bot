import "dotenv/config";
import { Bot, Context } from "grammy";
import {
  getRestrictedTypes,
  getWarningTtl,
  listTopicRules,
  MessageType,
  resetTopicRule,
  setRestrictedTypes,
} from "./db";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not set in .env");

const bot = new Bot(BOT_TOKEN);

const SUPPORTED_TYPES: MessageType[] = [
  "text",
  "photo",
  "document",
  "video",
  "audio",
  "sticker",
  "voice",
  "video_note",
  "animation",
];

function getMessageType(ctx: Context): MessageType | null {
  const msg = ctx.message;
  if (!msg) return null;
  if (msg.photo) return "photo";
  if (msg.document) return "document";
  if (msg.video) return "video";
  if (msg.audio) return "audio";
  if (msg.sticker) return "sticker";
  if (msg.voice) return "voice";
  if (msg.video_note) return "video_note";
  if (msg.animation) return "animation";
  if (msg.text) return "text";
  return null;
}

function parseTypes(input: string): MessageType[] {
  const values = input
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return values.filter((value): value is MessageType =>
    SUPPORTED_TYPES.includes(value as MessageType)
  );
}

async function isAdmin(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
  return member.status === "administrator" || member.status === "creator";
}

function requireTopic(ctx: Context): number | null {
  const topicId = ctx.message?.message_thread_id;
  return topicId ?? null;
}

async function replyAndCleanup(
  ctx: Context,
  text: string,
  options?: { message_thread_id?: number }
): Promise<void> {
  if (!ctx.chat || !ctx.message) return;

  const chatId = ctx.chat.id;
  const commandMessageId = ctx.message.message_id;

  try {
    const reply = await ctx.reply(text, options);
    const ttlMs = getWarningTtl(chatId);

    setTimeout(() => {
      bot.api.deleteMessage(chatId, commandMessageId).catch((err) => {
        console.error("[delete command] failed:", err);
      });
      bot.api.deleteMessage(chatId, reply.message_id).catch((err) => {
        console.error("[delete command reply] failed:", err);
      });
    }, ttlMs);
  } catch (err) {
    console.error("[command reply] failed:", err);
  }
}

bot.command("setup", async (ctx) => {
  if (!ctx.chat) return;

  const helpLines = [
    "Setup for the current topic:",
    "/restrict text photo document (add restrictions)",
    "/allow text photo (unrestrict selected types)",
    "/allow (remove all restrictions in current topic)",
    "/types",
    "/topics",
    "/reset_topic",
    "",
    "Default behavior: everything is allowed except restricted types.",
    `Supported types: ${SUPPORTED_TYPES.join(", ")}`,
    "Commands can be used only by chat admins.",
  ];
  await replyAndCleanup(ctx, helpLines.join("\n"));
});

bot.command("restrict", async (ctx) => {
  if (!ctx.chat || !ctx.from) return;
  if (!(await isAdmin(ctx))) {
    await replyAndCleanup(ctx, "Only a chat admin can change settings.");
    return;
  }

  const topicId = requireTopic(ctx);
  if (!topicId) {
    await replyAndCleanup(ctx, "Run this command inside the target topic.");
    return;
  }

  const rawArgs = typeof ctx.match === "string" ? ctx.match : "";
  const parsedTypes = parseTypes(rawArgs);
  if (parsedTypes.length === 0) {
    await replyAndCleanup(
      ctx,
      `Please provide at least one type. Example: /restrict text photo\nSupported: ${SUPPORTED_TYPES.join(", ")}`
    );
    return;
  }

  const currentRestricted = getRestrictedTypes(ctx.chat.id, topicId) ?? [];
  const updatedRestricted = Array.from(
    new Set([...currentRestricted, ...parsedTypes])
  );

  if (updatedRestricted.length === currentRestricted.length) {
    await replyAndCleanup(
      ctx,
      `No changes for topic ${topicId}. These types are already restricted: ${currentRestricted.join(
        ", "
      )}`,
      { message_thread_id: topicId }
    );
    return;
  }

  setRestrictedTypes(ctx.chat.id, topicId, updatedRestricted, ctx.from.id);
  await replyAndCleanup(
    ctx,
    `Updated topic ${topicId}: restricted types are ${updatedRestricted.join(", ")}`,
    { message_thread_id: topicId }
  );
});

bot.command("allow", async (ctx) => {
  if (!ctx.chat || !ctx.from) return;
  if (!(await isAdmin(ctx))) {
    await replyAndCleanup(ctx, "Only a chat admin can change settings.");
    return;
  }

  const topicId = requireTopic(ctx);
  if (!topicId) {
    await replyAndCleanup(ctx, "Run this command inside the target topic.");
    return;
  }

  const restrictedTypes = getRestrictedTypes(ctx.chat.id, topicId) ?? [];
  if (restrictedTypes.length === 0) {
    await replyAndCleanup(
      ctx,
      `Topic ${topicId} has no restrictions right now.`,
      {
        message_thread_id: topicId,
      }
    );
    return;
  }

  const rawArgs = typeof ctx.match === "string" ? ctx.match : "";
  const parsedTypes = parseTypes(rawArgs);

  if (parsedTypes.length === 0) {
    resetTopicRule(ctx.chat.id, topicId);
    await replyAndCleanup(
      ctx,
      `All restrictions were removed for topic ${topicId}. Everything is now allowed.`,
      { message_thread_id: topicId }
    );
    return;
  }

  const updatedRestricted = restrictedTypes.filter(
    (item) => !parsedTypes.includes(item)
  );

  if (updatedRestricted.length === 0) {
    resetTopicRule(ctx.chat.id, topicId);
    await replyAndCleanup(
      ctx,
      `All restrictions were removed for topic ${topicId}. Everything is now allowed.`,
      { message_thread_id: topicId }
    );
    return;
  }

  setRestrictedTypes(ctx.chat.id, topicId, updatedRestricted, ctx.from.id);
  await replyAndCleanup(
    ctx,
    `Updated topic ${topicId}: restricted types are ${updatedRestricted.join(", ")}`,
    { message_thread_id: topicId }
  );
});

bot.command("types", async (ctx) => {
  if (!ctx.chat) return;

  const topicId = requireTopic(ctx);
  if (!topicId) {
    await replyAndCleanup(ctx, "Run this command inside the target topic.");
    return;
  }

  const restricted = getRestrictedTypes(ctx.chat.id, topicId);
  if (!restricted || restricted.length === 0) {
    await replyAndCleanup(
      ctx,
      `No restrictions are configured for topic ${topicId}. Everything is allowed.`
    );
    return;
  }

  await replyAndCleanup(
    ctx,
    `Restricted types for topic ${topicId}: ${restricted.join(", ")}`,
    { message_thread_id: topicId }
  );
});

bot.command("topics", async (ctx) => {
  if (!ctx.chat) return;
  const rules = listTopicRules(ctx.chat.id);

  if (rules.length === 0) {
    await replyAndCleanup(ctx, "No topics are configured for this chat yet.");
    return;
  }

  const lines = rules.map(
    (rule) => `Topic ${rule.topicId}: ${rule.restrictedTypes.join(", ")}`
  );
  await replyAndCleanup(ctx, lines.join("\n"));
});

bot.command("reset_topic", async (ctx) => {
  if (!ctx.chat) return;
  if (!(await isAdmin(ctx))) {
    await replyAndCleanup(ctx, "Only a chat admin can change settings.");
    return;
  }

  const topicId = requireTopic(ctx);
  if (!topicId) {
    await replyAndCleanup(ctx, "Run this command inside the target topic.");
    return;
  }

  resetTopicRule(ctx.chat.id, topicId);
  await replyAndCleanup(ctx, `Rule for topic ${topicId} has been deleted.`, {
    message_thread_id: topicId,
  });
});

bot.on("message", async (ctx) => {
  if (!ctx.chat) return;
  if (ctx.message.text?.startsWith("/")) return;

  const topicId = ctx.message.message_thread_id;
  if (!topicId) return;

  const restricted = getRestrictedTypes(ctx.chat.id, topicId);
  if (!restricted || restricted.length === 0) return;

  const type = getMessageType(ctx);
  if (!type || !restricted.includes(type)) return;

  try {
    await ctx.deleteMessage();
  } catch (err) {
    console.error(`[delete] failed for msg ${ctx.message.message_id}:`, err);
    return;
  }

  const username = ctx.from?.username
    ? `@${ctx.from.username}`
    : ctx.from?.first_name ?? "User";

  try {
    const warning = await ctx.reply(
      `${username}, this type is restricted in this topic. Restricted types: ${restricted.join(
        ", "
      )}`,
      { message_thread_id: topicId }
    );

    setTimeout(() => {
      bot.api
        .deleteMessage(ctx.chat.id, warning.message_id)
        .catch((err) =>
          console.error(`[delete warning] failed:`, err)
        );
    }, getWarningTtl(ctx.chat.id));
  } catch (err) {
    console.error(`[reply] failed:`, err);
  }
});

bot.catch((err) => {
  console.error("[bot error]", err);
});

console.log("Bot is starting...");
bot.start({
  onStart: () => console.log("Bot is running"),
});
