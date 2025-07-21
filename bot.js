// bot.js (snippet with changes only)
const {Client, GatewayIntentBits} = require('discord.js');
require('dotenv').config();
const db = require('./db');
const {downloadVideo} = require('./downloader');
const {uploadToR2} = require('./uploadToR2');
const path = require('path');
const fs = require('fs').promises;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const prefix = "ab!";

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();

    // --- Handle !setup ---
    if (content === `${prefix}channel`) {
        try {
            const owner = await message.guild.fetchOwner();
            if (message.author.id !== owner.id) {
                return message.reply('❌ Only the server owner can configure the bot.');
            }

            await db.query(`
                INSERT INTO servers (discord_server_id, name, access_code, password_hash, target_channel_id, owner_id)
                VALUES ($1, $2, 'placeholder', 'placeholder', $3, $4) ON CONFLICT (discord_server_id)
    DO
                UPDATE SET name = $2, target_channel_id = $3, owner_id = $4
            `, [message.guild.id, message.guild.name, message.channel.id, owner.id]);

            return message.reply(`✅ This channel is now set as the upload channel.`);
        } catch (err) {
            console.error('Error during setup:', err);
            return message.reply('❌ Failed to configure the bot.');
        }
    } else if (content === `${prefix}sync`) {
        try {
            const owner = await message.guild.fetchOwner();
            if (message.author.id !== owner.id) {
                return message.reply('❌ Only the server owner can sync old videos.');
            }

            // Get server config
            const { rows } = await db.query(
                `SELECT id, target_channel_id FROM servers WHERE discord_server_id = $1`,
                [message.guild.id]
            );
            if (!rows.length || rows[0].target_channel_id !== message.channel.id) {
                return message.reply('❌ This channel is not configured for uploads.');
            }
            const serverDbId = rows[0].id;

            let lastId = null;
            let fetchedCount = 0;
            let uploadedCount = 0;
            const batchSize = 5;

            await message.reply('🔄 Syncing videos... this may take a while.');

            while (true) {
                const fetchOptions = { limit: batchSize };
                if (lastId) fetchOptions.before = lastId;

                const messages = await message.channel.messages.fetch(fetchOptions);
                if (messages.size === 0) break;

                // Process from oldest to newest within the batch for chronological order
                const msgsArray = Array.from(messages.values()).reverse();

                for (const msg of msgsArray) {
                    lastId = msg.id;
                    fetchedCount++;

                    const attachment = msg.attachments.first();
                    if (!attachment || !attachment.contentType?.startsWith('video')) {
                        continue; // skip non-video
                    }

                    // Sync the video
                    const timestamp = Date.now();
                    const fileExt = path.extname(attachment.name || '.mp4');
                    const filename = `${msg.id}_${timestamp}${fileExt}`;

                    try {
                        const filepath = await downloadVideo(attachment.url, filename);
                        const fileUrl = await uploadToR2(filepath, filename);
                        await fs.unlink(filepath);

                        // Insert user if not exists
                        const userId = msg.author.id;
                        const username = msg.author.tag;
                        await db.query(
                            `INSERT INTO users (discord_user_id, username) VALUES ($1, $2) ON CONFLICT (discord_user_id) DO NOTHING`,
                            [userId, username]
                        );

                        // Insert video record
                        await db.query(
                            `INSERT INTO videos (server_id, activity_name, file_url, video_owner) VALUES ($1, $2, $3, $4)`,
                            [serverDbId, msg.content || 'Unnamed Activity', fileUrl, msg.author.username]
                        );

                        uploadedCount++;
                        console.log(`📦 Synced video from ${msg.author.tag}`);

                        // React with ✅
                        try {
                            await msg.react('✅');
                        } catch (reactErr) {
                            console.error('Failed to add reaction:', reactErr);
                        }
                    } catch (err) {
                        console.error('❌ Failed to sync a message:', err);
                    }
                }

                // If fewer than batchSize messages were fetched, we reached the end
                if (messages.size < batchSize) break;
            }

            await message.reply(`✅ Sync complete! Scanned ${fetchedCount} messages, uploaded ${uploadedCount} new videos.`);
        } catch (err) {
            console.error('Error during sync:', err);
            message.reply('❌ Sync failed due to an error.');
        }
    }

    // --- Check if channel is the configured upload channel ---
    const {rows} = await db.query(
        `SELECT id, target_channel_id
         FROM servers
         WHERE discord_server_id = $1`,
        [message.guild.id]
    );

    if (!rows.length || rows[0].target_channel_id !== message.channel.id) return;

    // --- Video upload handling ---
    const activityName = content;
    const attachment = message.attachments.first();

    if (!attachment || !attachment.contentType?.startsWith('video')) {
        return message.reply('❌ Please attach a video file.');
    }

    try {
        const timestamp = Date.now();
        const fileExt = path.extname(attachment.name || '.mp4');
        const filename = `${message.id}_${timestamp}${fileExt}`;

        const filepath = await downloadVideo(attachment.url, filename);
        const fileUrl = await uploadToR2(filepath, filename);

        // Clean up temp files
        await fs.unlink(filepath);

        const serverDbId = rows[0].id;
        const userId = message.author.id;
        const username = message.author.tag;

        // Ensure user exists
        await db.query(`
            INSERT INTO users (discord_user_id, username)
            VALUES ($1, $2) ON CONFLICT (discord_user_id) DO NOTHING
        `, [userId, username]);

        // Save video metadata
        await db.query(`
            INSERT INTO videos (server_id, activity_name, file_url, video_owner)
            VALUES ($1, $2, $3, $4)
        `, [serverDbId, activityName, fileUrl, message.author.username]);

        message.react('✅');
        console.log(`📦 Saved video: ${filename}`);
    } catch (err) {
        console.error('Error saving video:', err);
        message.reply('❌ Failed to save video.');
    }
});

client.login(process.env.DISCORD_TOKEN);
