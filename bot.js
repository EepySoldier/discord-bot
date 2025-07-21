const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();
const db = require('./db');
const { downloadVideo } = require('./downloader');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.TARGET_CHANNEL_ID) return;

    const activityName = message.content.trim();
    const attachment = message.attachments.first();

    if (!attachment || !attachment.contentType?.startsWith('video')) {
        return message.reply('❌ Please attach a video file.');
    }

    try {
        const timestamp = Date.now();
        const fileExt = path.extname(attachment.name || '.mp4');
        const filename = `${message.id}_${timestamp}${fileExt}`;

        const filepath = await downloadVideo(attachment.url, filename);

        // Insert into database
        const serverId = message.guild.id;
        const userId = message.author.id;
        const username = message.author.tag;
        const fileUrl = `/videos/${filename}`; // path for future serving

        // Ensure user exists
        await db.query(
            `
      INSERT INTO users (discord_user_id, username)
      VALUES ($1, $2)
      ON CONFLICT (discord_user_id) DO NOTHING
      `,
            [userId, username]
        );

        // Ensure server exists
        await db.query(
            `
      INSERT INTO servers (discord_server_id, name, access_code, password_hash)
      VALUES ($1, $2, 'placeholder', 'placeholder')
      ON CONFLICT (discord_server_id) DO NOTHING
      `,
            [serverId, message.guild.name]
        );

        const { rows: userRows } = await db.query(
            `SELECT id FROM users WHERE discord_user_id = $1`,
            [userId]
        );
        const uploaderId = userRows[0].id;

        const { rows: serverRows } = await db.query(
            `SELECT id FROM servers WHERE discord_server_id = $1`,
            [serverId]
        );
        const serverDbId = serverRows[0].id;

        await db.query(
            `INSERT INTO videos (uploader_id, server_id, activity_name, file_url)
       VALUES ($1, $2, $3, $4)`,
            [uploaderId, serverDbId, activityName, fileUrl]
        );

        message.react('✅');
        console.log(`Saved video: ${filename}`);
    } catch (err) {
        console.error('Error saving video:', err);
        message.reply('❌ Failed to save video.');
    }
});

client.login(process.env.DISCORD_TOKEN);
