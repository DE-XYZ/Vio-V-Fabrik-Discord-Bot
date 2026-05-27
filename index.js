require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Colors } = require('discord.js');
const axios = require('axios');

// ─────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────
const VIOV_API  = 'https://apiv1.vio-v.com/api/v3';
const TOKEN_URL   = 'https://apiv1.vio-v.com/api/oauth2/token';

const NEXT_CAPTURE = 1779831330;

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
let accessToken       = null;
let tokenExpiresAt    = 0;

const factoryState    = new Map();

let statusMessage     = null;

// ─────────────────────────────────────────────
//  Discord client
// ─────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─────────────────────────────────────────────
//  OAuth2 – Client Credentials Grant
// ─────────────────────────────────────────────
async function getAccessToken() {
  const now = Date.now() / 1000;
  if (accessToken && now < tokenExpiresAt - 30) return accessToken;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id',     process.env.VIOV_CLIENT_ID);
  params.append('client_secret', process.env.VIOV_CLIENT_SECRET);
  params.append('scope', 'read.group');

  const res = await axios.post(TOKEN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  accessToken    = res.data.access_token;
  tokenExpiresAt = now + (res.data.expires_in || 3600);
  console.log('[Auth] Token erneuert.');
  return accessToken;
}

// ─────────────────────────────────────────────
//  VioV API – Fabriken abrufen
// ─────────────────────────────────────────────
async function fetchFactories() {
  const token = await getAccessToken();
  const res = await axios.get(`${VIOV_API}/group/factories`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// ─────────────────────────────────────────────
//  Status einer einzelnen Fabrik bestimmen
//  Gibt zurück: 'attackable' | 'under_attack' | 'protected'
// ─────────────────────────────────────────────
function getFactoryStatus(factory) {
  const now       = Math.floor(Date.now() / 1000);
  const capture   = NEXT_CAPTURE;
  const underAtk  = factory.UnderAttack ?? factory.underAttack ?? false;

  if (underAtk) return 'under_attack';
  if (now >= capture) return 'attackable';
  return 'protected';
}

// ─────────────────────────────────────────────
//  Status-Embed bauen
// ─────────────────────────────────────────────
function buildStatusEmbed(factories) {
  const now = Math.floor(Date.now() / 1000);

  const embed = new EmbedBuilder()
    .setTitle('🏭  Fabrik-Übersicht · VioV')
    .setColor(0x2b2d31)
    .setTimestamp()
    .setFooter({ text: 'Aktualisiert jede Minute' });

  if (!factories || factories.length === 0) {
    embed.setDescription('Keine Fabriken gefunden.');
    return embed;
  }

  const lines = factories.map(f => {
    const status = getFactoryStatus(f);
    const name   = f.Name ?? f.name ?? `Fabrik #${f.ID ?? f.id}`;

    let icon, statusText;

    if (status === 'attackable') {
      icon       = '✅';
      statusText = '**Attackierbar!**';
    } else if (status === 'under_attack') {
      icon       = '🟠';
      statusText = '**Wird gerade attackiert!**';
    } else {
      icon       = '🔴';
      statusText = `Attackierbar <t:${NEXT_CAPTURE}:R> (<t:${NEXT_CAPTURE}:f>)`;
    }

    return `${icon}  **${name}** — ${statusText}`;
  });

  embed.setDescription(lines.join('\n'));
  return embed;
}

// ─────────────────────────────────────────────
//  Angriffs-Alert senden (@everyone)
// ─────────────────────────────────────────────
async function sendAttackAlert(channel, factory) {
  const name = factory.Name ?? factory.name ?? `Fabrik #${factory.ID ?? factory.id}`;
  const alert = new EmbedBuilder()
    .setTitle('🚨  FABRIK WIRD ATTACKIERT!')
    .setColor(Colors.Orange)
    .setDescription(`**${name}** wird gerade angegriffen!`)
    .addFields(
      { name: 'NextCapture', value: `<t:${NEXT_CAPTURE}:f>`, inline: true }
    )
    .setTimestamp();

  await channel.send({ content: '@everyone', embeds: [alert] });
}

// ─────────────────────────────────────────────
//  Haupt-Poll-Funktion (läuft jede Minute)
// ─────────────────────────────────────────────
async function poll() {
  try {
    const factories = await fetchFactories();
    const channel   = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return console.error('[Poll] Channel nicht gefunden!');

    for (const factory of factories) {
      const id        = factory.ID ?? factory.id;
      const underAtk  = factory.UnderAttack ?? factory.underAttack ?? false;
      const prev      = factoryState.get(id) ?? { underAttack: false };

      if (underAtk && !prev.underAttack) {
        await sendAttackAlert(channel, factory);
      }

      factoryState.set(id, { underAttack: underAtk });
    }

    const embed = buildStatusEmbed(factories);

    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed] });
    } else {
      statusMessage = await channel.send({ embeds: [embed] });
    }

  } catch (err) {
    console.error('[Poll] Fehler:', err.response?.data ?? err.message);
  }
}

// ─────────────────────────────────────────────
//  Alte Bot-Nachrichten im Channel löschen
// ─────────────────────────────────────────────
async function clearOldBotMessages(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const botMsgs  = messages.filter(m => m.author.id === client.user.id);
 
    if (botMsgs.size === 0) {
      console.log('[Cleanup] Keine alten Nachrichten gefunden.');
      return;
    }
 
    const now      = Date.now();
    const bulk     = botMsgs.filter(m => now - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
    const old      = botMsgs.filter(m => now - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000);
 
    if (bulk.size > 1) {
      await channel.bulkDelete(bulk);
    } else if (bulk.size === 1) {
      await bulk.first().delete();
    }
 
    for (const [, msg] of old) {
      await msg.delete().catch(() => {});
    }
 
    console.log(`[Cleanup] ${botMsgs.size} alte Nachricht(en) gelöscht.`);
  } catch (err) {
    console.error('[Cleanup] Fehler beim Löschen:', err.message);
  }
}

// ─────────────────────────────────────────────
//  Bot ready
// ─────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[Bot] Eingeloggt als ${client.user.tag}`);
 
  const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
  if (channel) {
    await clearOldBotMessages(channel);
  } else {
    console.error('[Bot] Channel nicht gefunden – überprüfe DISCORD_CHANNEL_ID in .env');
  }
 
  await poll();
 
  setInterval(poll, 60_000);
});

client.login(process.env.DISCORD_BOT_TOKEN);