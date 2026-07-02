import "dotenv/config";
import { Bot, Context } from "grammy";
import {
  getAllowedTypes,
  getWarningTtl,
  listTopicRules,
  MessageType,
  resetTopicRule,
  setAllowedTypes,
} from "./db";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not set in .env");

const bot = new Bot(BOT_TOKEN);

const ALLOWED_TYPES: MessageType[] = [
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
    ALLOWED_TYPES.includes(value as MessageType)
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

bot.command("setup", async (ctx) => {
  if (!ctx.chat) return;

  const helpLines = [
    "Setup for the current topic:",
    "/allow text photo document",
    "/types",
    "/topics",
    "/reset_topic",
    "",
    `Available types: ${ALLOWED_TYPES.join(", ")}`,
    "Commands can be used only by chat admins.",
  ];
  await ctx.reply(helpLines.join("\n"));
});

bot.command("allow", async (ctx) => {
  if (!ctx.chat || !ctx.from) return;
  if (!(await isAdmin(ctx))) {
    await ctx.reply("Only a chat admin can change settings.");
    return;
  }

  const topicId = requireTopic(ctx);
  if (!topicId) {
    await ctx.reply("Run this command inside the target topic.");
    return;
  }

  const rawArgs = typeof ctx.match === "string" ? ctx.match : "";
  const parsedTypes = parseTypes(rawArgs);
  if (parsedTypes.length === 0) {
    await ctx.reply(
      `Please provide at least one type. Example: /allow text photo\nAvailable: ${ALLOWED_TYPES.join(", ")}`
    );
    return;
  }

  setAllowedTypes(ctx.chat.id, topicId, parsedTypes, ctx.from.id);
  await ctx.reply(
    `Updated topic ${topicId}: allowed types are ${parsedTypes.join(", ")}`,
    { message_thread_id: topicId }
  );
});

bot.command("types", async (ctx) => {
  if (!ctx.chat) return;

  const topicId = requireTopic(ctx);
  if (!topicId) {
    await ctx.reply("Run this command inside the target topic.");
    return;
  }

  const allowed = getAllowedTypes(ctx.chat.id, topicId);
  if (!allowed) {
    await ctx.reply(`No rule is configured for topic ${topicId} yet.`);
    return;
  }

  await ctx.reply(
    `Allowed types for topic ${topicId}: ${allowed.join(", ")}`,
    { message_thread_id: topicId }
  );
});

bot.command("topics", async (ctx) => {
  if (!ctx.chat) return;
  const rules = listTopicRules(ctx.chat.id);

  if (rules.length === 0) {
    await ctx.reply("No topics are configured for this chat yet.");
    return;
  }

  const lines = rules.map(
    (rule) => `Topic ${rule.topicId}: ${rule.allowedTypes.join(", ")}`
  );
  await ctx.reply(lines.join("\n"));
});

bot.command("reset_topic", async (ctx) => {
  if (!ctx.chat) return;
  if (!(await isAdmin(ctx))) {
    await ctx.reply("Only a chat admin can change settings.");
    return;
  }

  const topicId = requireTopic(ctx);
  if (!topicId) {
    await ctx.reply("Run this command inside the target topic.");
    return;
  }

  resetTopicRule(ctx.chat.id, topicId);
  await ctx.reply(`Rule for topic ${topicId} has been deleted.`, {
    message_thread_id: topicId,
  });
});

bot.on("message", async (ctx) => {
  if (!ctx.chat) return;
  if (ctx.message.text?.startsWith("/")) return;

  const topicId = ctx.message.message_thread_id;
  if (!topicId) return;

  const allowed = getAllowedTypes(ctx.chat.id, topicId);
  if (!allowed) return;

  const type = getMessageType(ctx);
  if (!type || allowed.includes(type)) return;

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
      `${username}, only these types are allowed in this topic: ${allowed.join(
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
