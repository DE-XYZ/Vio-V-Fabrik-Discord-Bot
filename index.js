require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Colors } = require('discord.js');
const axios = require('axios');

const API_BASE  = 'https://apiv1.vio-v.com/api/v3';
const TOKEN_URL = 'https://apiv1.vio-v.com/api/oauth2/token';

let accessToken    = null;
let tokenExpiresAt = 0;

// Map: factoryId → { ts, attacked }
// attacked = true wenn nextCapture bereits in der Vergangenheit war
const knownState = new Map();

let statusMessage     = null;
let lastSuccessfulPoll = Date.now();
let ownerPinged        = false; // verhindert Spam

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── OAuth2 Token ──────────────────────────────────────────────────────────────
async function getAccessToken() {
  const now = Date.now() / 1000;
  if (accessToken && now < tokenExpiresAt - 30) return accessToken;

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.VIOV_CLIENT_ID,
    client_secret: process.env.VIOV_CLIENT_SECRET,
    scope:         'read.group',
  });

  const res      = await axios.post(TOKEN_URL, body);
  accessToken    = res.data.access_token;
  tokenExpiresAt = now + (res.data.expires_in ?? 3600);
  console.log('[Auth] Token erneuert.');
  return accessToken;
}

// ── API ───────────────────────────────────────────────────────────────────────
async function fetchFactories() {
  const token = await getAccessToken();
  const res   = await axios.get(`${API_BASE}/group/factories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data; // [{ ID, GroupID, NextCapture }, ...]
}

// ── Embed ─────────────────────────────────────────────────────────────────────
function buildEmbed(factories) {
  const now = Math.floor(Date.now() / 1000);

  const lines = factories.map(f => {
    const id = f.ID ?? f.id;
    const ts = f.NextCapture ?? f.nextCapture;
    if (now >= ts) {
      return `✅  **Fabrik ${id}** — Attackierbar`;
    }
    return `🔴  **Fabrik ${id}** — Attackierbar <t:${ts}:R>`;
  });

  return new EmbedBuilder()
    .setTitle('🏭  Fabrik-Übersicht')
    .setDescription(lines.length > 0 ? lines.join('\n') : 'Eure Gruppierung besitzt momentan keine Fabriken :(')
    .setColor(0x2b2d31)
    .setFooter({ text: 'Aktualisiert jede Minute' })
    .setTimestamp();
}

// ── Alert ─────────────────────────────────────────────────────────────────────
async function sendAttackAlert(channel, factory) {
  const id = factory.ID ?? factory.id;
  const ts = factory.NextCapture ?? factory.nextCapture;
  const alert = new EmbedBuilder()
    .setTitle('🚨  FABRIK WIRD ATTACKIERT!')
    .setDescription(`**Fabrik ${id}** wird gerade attackiert!`)
    .addFields({ name: 'NextCapture', value: `<t:${ts}:f>`, inline: true })
    .setColor(Colors.Red)
    .setTimestamp();

  await channel.send({ content: '@everyone', embeds: [alert] });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function clearOldBotMessages(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const botMsgs  = messages.filter(m => m.author.id === client.user.id);
  if (botMsgs.size === 0) return;

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const bulk   = botMsgs.filter(m => m.createdTimestamp > cutoff);
  const stale  = botMsgs.filter(m => m.createdTimestamp <= cutoff);

  if (bulk.size > 1)        await channel.bulkDelete(bulk);
  else if (bulk.size === 1) await bulk.first().delete();

  for (const [, msg] of stale) await msg.delete().catch(() => {});

  console.log(`[Cleanup] ${botMsgs.size} Nachricht(en) gelöscht.`);
}

// ── Poll ──────────────────────────────────────────────────────────────────────
async function poll() {
  const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
  if (!channel) return console.error('[Poll] Channel nicht gefunden!');

  let factories;
  try {
    factories = await fetchFactories();
  } catch (err) {
    return console.error('[Poll] API-Fehler:', err.response?.data ?? err.message);
  }

  for (const f of factories) {
    const id   = f.ID ?? f.id;
    const ts   = f.NextCapture ?? f.nextCapture;
    const prev = knownState.get(id);

    // Alert nur wenn NextCapture sich verändert hat UND der neue Wert in der
    // Zukunft liegt → Fabrik wurde attackiert, Timer wurde neu gesetzt
    const now = Math.floor(Date.now() / 1000);
    if (prev !== undefined && ts !== prev.ts && ts > now) {
      await sendAttackAlert(channel, f).catch(console.error);
    }

    knownState.set(id, { ts });
  }

  const embed = buildEmbed(factories);
  try {
    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed] });
    } else {
      statusMessage = await channel.send({ embeds: [embed] });
    }
    lastSuccessfulPoll = Date.now();
  } catch (err) {
    console.error('[Embed] Fehler beim Aktualisieren:', err.message);
    try {
      const owner = await client.users.fetch(process.env.DISCORD_OWNER_ID);
      for (let i = 0; i < 3; i++) {
        await channel.send(`<@${owner.id}> ⚠️ Restarte den Bot – ein Fehler ist aufgetreten!`);
      }
    } catch (pingErr) {
      console.error('[Embed] Owner konnte nicht gepingt werden:', pingErr.message);
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`[Bot] Eingeloggt als ${client.user.tag}`);

  const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
  if (channel) await clearOldBotMessages(channel).catch(console.error);

  await poll();
  setInterval(poll, 60_000);

  // Watchdog: prüft alle 2 Minuten ob der letzte Poll nicht länger als 5 Minuten her ist
  setInterval(async () => {
    const staleSince = Date.now() - lastSuccessfulPoll;
    if (staleSince < 5 * 60 * 1000) {
      ownerPinged = false; // Reset wenn alles wieder normal läuft
      return;
    }
    if (ownerPinged) return; // Nicht mehrfach pingen

    console.error(`[Watchdog] Kein erfolgreicher Poll seit ${Math.floor(staleSince / 60000)} Minuten!`);
    try {
      const ch = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
      if (ch) {
        for (let i = 0; i < 3; i++) {
          await ch.send(`<@${process.env.DISCORD_OWNER_ID}> ⚠️ Restarte den Bot – ein Fehler ist aufgetreten! (Kein Update seit ${Math.floor(staleSince / 60000)} Minuten)`);
        }
        ownerPinged = true;
      }
    } catch (err) {
      console.error('[Watchdog] Ping fehlgeschlagen:', err.message);
    }
  }, 2 * 60 * 1000);
});

client.login(process.env.DISCORD_BOT_TOKEN);