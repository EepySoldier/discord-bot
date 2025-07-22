const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();
const db = require('./db');
const { downloadVideo } = require('./downloader');
const { uploadToR2 } = require('./uploadToR2');
const path = require('path');
const fs = require('fs').promises;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const commands = [
    new SlashCommandBuilder().setName('channel').setDescription('Configure this channel as the video upload channel'),
    new SlashCommandBuilder().setName('sync').setDescription('Sync old videos from this channel'),
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Slash commands registered');
    } catch (err) {
        console.error('❌ Failed to register commands:', err);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    if (command === 'channel') {
        try {
            const guild = interaction.guild;
            const owner = await guild.fetchOwner();

            if (interaction.user.id !== owner.id) {
                return interaction.reply({ content: '❌ Only the server owner can configure the bot.', ephemeral: true });
            }

            await db.query(`
                INSERT INTO servers (discord_server_id, name, access_code, password_hash, target_channel_id, owner_id)
                VALUES ($1, $2, 'placeholder', 'placeholder', $3, $4)
                    ON CONFLICT (discord_server_id)
                DO UPDATE SET name = $2, target_channel_id = $3, owner_id = $4
            `, [guild.id, guild.name, interaction.channel.id, owner.id]);

            return interaction.reply('✅ This channel is now set as the upload channel.');
        } catch (err) {
            console.error('Error during setup:', err);
            return interaction.reply('❌ Failed to configure the bot.');
        }
    }

    if (command === 'sync') {
        try {
            const guild = interaction.guild;
            const owner = await guild.fetchOwner();

            if (interaction.user.id !== owner.id) {
                return interaction.reply({ content: '❌ Only the server owner can sync old videos.', ephemeral: true });
            }

            const { rows } = await db.query(
                `SELECT id, target_channel_id FROM servers WHERE discord_server_id = $1`,
                [guild.id]
            );
            if (!rows.length || rows[0].target_channel_id !== interaction.channel.id) {
                return interaction.reply('❌ This channel is not configured for uploads.');
            }

            const serverDbId = rows[0].id;
            let lastId = null;
            let fetchedCount = 0;
            let uploadedCount = 0;
            const batchSize = 5;

            await interaction.reply('🔄 Syncing videos... this may take a while.');

            while (true) {
                const fetchOptions = { limit: batchSize };
                if (lastId) fetchOptions.before = lastId;

                const messages = await interaction.channel.messages.fetch(fetchOptions);
                if (messages.size === 0) break;

                const msgsArray = Array.from(messages.values()).reverse();

                for (const msg of msgsArray) {
                    lastId = msg.id;
                    fetchedCount++;

                    const attachment = msg.attachments.first();
                    if (!attachment || !attachment.contentType?.startsWith('video')) continue;

                    const timestamp = Date.now();
                    const fileExt = path.extname(attachment.name || '.mp4');
                    const filename = `${msg.id}_${timestamp}${fileExt}`;

                    try {
                        const filepath = await downloadVideo(attachment.url, filename);
                        const fileUrl = await uploadToR2(filepath, filename);
                        await fs.unlink(filepath);

                        const userId = msg.author.id;
                        const username = msg.author.tag;

                        await db.query(
                            `INSERT INTO users (discord_user_id, username)
                             VALUES ($1, $2) ON CONFLICT (discord_user_id) DO NOTHING`,
                            [userId, username]
                        );

                        await db.query(
                            `INSERT INTO videos (server_id, discord_message_id, activity_name, file_url, video_owner)
                             VALUES ($1, $2, $3, $4, $5)
                             ON CONFLICT (discord_message_id) DO NOTHING`,
                            [serverDbId, msg.id, msg.content || '', fileUrl, msg.author.username]
                        );

                        uploadedCount++;
                        await msg.react('✅');
                    } catch (err) {
                        console.error('❌ Failed to sync a message:', err);
                    }
                }

                if (messages.size < batchSize) break;
            }

            await interaction.followUp(`✅ Sync complete! Scanned ${fetchedCount} messages, uploaded ${uploadedCount} new videos.`);
        } catch (err) {
            console.error('Error during sync:', err);
            interaction.followUp('❌ Sync failed due to an error.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
