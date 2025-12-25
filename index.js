
'use strict';

process.env.PYTHONWARNINGS = 'ignore';
process.env.PYTHONUNBUFFERED = '1';

require('dotenv').config();
const path = require('path');
const { Client, GatewayIntentBits, Routes, REST, SlashCommandBuilder, ActivityType } = require('discord.js');
const { DisTube } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, child, set, runTransaction } = require("firebase/database");
const play = require('play-dl'); // Use play-dl for better search

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyBY5b_eChwHx3qO-J4YkW9aw03xOOEMurM",
  authDomain: "discordunknow-54ce9.firebaseapp.com",
  projectId: "discordunknow-54ce9",
  storageBucket: "discordunknow-54ce9.firebasestorage.app",
  messagingSenderId: "571989738366",
  appId: "1:571989738366:web:009545030d8cbcfc11292f",
  measurementId: "G-25J7QG5SM5",
  databaseURL: "https://discordunknow-54ce9-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

let youtubeCookie = undefined;
try {
  const jsonPath = path.join(__dirname, 'cookies.json');
  const txtPath = path.join(__dirname, 'cookies.txt');

  if (fs.existsSync(txtPath)) {
    youtubeCookie = txtPath; // Pass file path directly
    console.log('✅ Found cookies.txt (Netscape format). Using for auth.');
  } else if (fs.existsSync(jsonPath)) {
    youtubeCookie = jsonPath; // Pass file path directly
    console.log('✅ Found cookies.json. Using for auth.');
  } else {
    console.log('ℹ️ No cookies found. YouTube might rate-limit.');
  }
} catch (e) {
  console.warn('❌ Error checking cookies:', e);
}

// --------------------------------------------------------------------------------
// 1. FFmpeg & Voice Setup
// --------------------------------------------------------------------------------
try {
  const ff = require('ffmpeg-static');
  if (ff) {
    process.env.FFMPEG_PATH = ff;
    // Helper to ensure ffmpeg is found
    process.env.PATH = `${process.env.PATH}${path.delimiter}${path.dirname(ff)}`;
    console.log('Found ffmpeg-static at:', ff);
  } else {
    console.warn('ffmpeg-static found but returned null/undefined path?');
  }
} catch (e) {
  console.warn('ffmpeg-static not installed or error loading it. System ffmpeg will be used if available.');
}

// --------------------------------------------------------------------------------
// 2. Client & DisTube Setup
// --------------------------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const plugins = [
  new SpotifyPlugin(),
  // new SoundCloudPlugin(), // Disabled to prevent Rate Limit errors
  new YtDlpPlugin({
    update: false,
    cookie: youtubeCookie
  })
];

const distube = new DisTube(client, {
  emitNewSongOnly: true,
  emitAddSongWhenCreatingQueue: false,
  emitAddListWhenCreatingQueue: false,
  plugins,
  // Stable FFmpeg arguments for network resilience
  ffmpeg: {
    args: {
      global: {
        'reconnect': '1',
        'reconnect_streamed': '1',
        'reconnect_delay_max': '5',
      },
    },
  },
});

// Event listeners for DisTube to debug sound
distube
  .on('playSong', (queue, song) => {
    const msg = `เพลงที่เล่นคือ ${song.name}`;
    queue.textChannel?.send(msg).catch(() => { });
  })
  .on('finish', (queue) => {
    setTimeout(() => {
      try {
        distube.voices.leave(queue.id);
      } catch (e) { console.error('Auto-leave error:', e); }
    }, 2000);
  })
  .on('addSong', (queue, song) => {
    const msg = `เพิ่มเพลง **${song.name}** - \`${song.formattedDuration}\` เข้าคิวโดย ${song.user}`;
    queue.textChannel?.send(msg).catch(() => { });
  })
  .on('error', (error, queue) => {
    if (queue && queue.textChannel) {
      queue.textChannel.send(`เกิดข้อผิดพลาด: ${error.toString().slice(0, 1900)}`).catch(() => { });
    }
    console.error('DisTube Error:', error);
  });


// --------------------------------------------------------------------------------
// 3. Command Registration (Nes / Stop)
// --------------------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('nestle')
    .setDescription('เล่นเพลง (รองรับ YouTube และอื่นๆ)')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('ชื่อเพลง หรือ ลิงก์')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('ออกจากห้องเสียง (หยุดเพลง)'),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('ข้ามเพลงปัจจุบัน'),
  new SlashCommandBuilder()
    .setName('site')
    .setDescription('รับลิงก์หน้าจัดการ Playlist'),
  new SlashCommandBuilder()
    .setName('playlish') // Typo intended as per user request
    .setDescription('เล่นเพลงทั้งหมดจาก Playlist เว็บ'),
  new SlashCommandBuilder()
    .setName('deletechat')
    .setDescription('ลบข้อความทั้งหมดที่บอทพิมพ์ (Clean Up)'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN || process.env.DISCORD_TOKEN);

async function registerCommands(clientId) {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// --------------------------------------------------------------------------------
// 4. Bot Events
// --------------------------------------------------------------------------------
const { Events, MessageFlags } = require('discord.js');

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Register commands globally (updates can take up to 1h, for instant use guild-specific but global is easier for one bot)
  await registerCommands(client.user.id);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Ensure we are in a guild and member is cached
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์เท่านั้นครับ', flags: MessageFlags.Ephemeral });
  }

  const { commandName } = interaction;
  const voiceChannel = interaction.member.voice.channel;

  if (commandName === 'nestle') {
    try {
      await interaction.deferReply();
    } catch (err) {
      // 10062: Unknown interaction (expired), 10015: Unknown Webhook (ephemeral issues)
      if ([10062, 10015].includes(err.code)) return;
      console.error('Defer Error:', err);
      return;
    }

    if (!voiceChannel) {
      return interaction.editReply('คุณต้องเข้าห้องเสียงก่อนใช้คำสั่งนี้นะครับ!');
    }

    let query = interaction.options.getString('query');

    // Use play-dl to search if it's not a link (Fixes NO_RESULT error)
    if (!query.startsWith('http')) {
      try {
        console.log(`🔎 Searching with play-dl: ${query}`);
        const searchResults = await play.search(query, { limit: 1 });
        if (searchResults && searchResults.length > 0) {
          query = searchResults[0].url;
          console.log(`✅ Found: ${query}`);
        }
      } catch (searchErr) {
        console.error('play-dl search failed:', searchErr);
      }
    }

    try {
      await distube.play(voiceChannel, query, {
        member: interaction.member,
        textChannel: interaction.channel
      });
      await interaction.editReply(`กำลังเล่น: **${query}**`);
    } catch (error) {
      console.error('Play error:', error);

      if (error.errorCode === 'VOICE_MISSING_PERMS') {
        return interaction.editReply('ผมไม่มีสิทธิ์เข้าห้องเสียงนี้ครับ! รบกวนเปิดสิทธิ์ **Connect** ให้ผมหน่อยนะ 🥺');
      }

      await interaction.editReply('เกิดข้อผิดพลาดในการเปิดเพลง ลองใช้ลิงก์ YouTube ตรงๆ ดูนะครับ');
    }
  }
  else if (commandName === 'leave') {
    try {
      try { await interaction.deferReply(); } catch (e) { return; }
      distube.voices.leave(interaction.guildId);

      setTimeout(() => {
        const connection = getVoiceConnection(interaction.guildId);
        if (connection) connection.destroy();
      }, 1000);

      // Silent leave: Delete the reply so no message is shown
      await interaction.deleteReply().catch(() => { });
    } catch (e) {
      // console.error('Command Error (Leave):', e); 
    }
  }
  else if (commandName === 'skip') {
    try {
      try { await interaction.deferReply(); } catch (e) { return; }
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.editReply('ไม่มีเพลงให้ข้ามครับ!').catch(() => { });
      }
      try {
        await distube.skip(interaction.guildId);
        await interaction.editReply('Skip');
      } catch (e) {
        await interaction.editReply('ไม่เหลือเพลงให้ข้ามแล้วครับ');
      }
    } catch (e) {
      console.error('Command Error (Skip):', e);
    }
  }
  else if (commandName === 'site') {
    const userId = interaction.user.id;
    await interaction.reply({
      content: `**หน้าจัดลำดับเพลง (ของ ${interaction.user.username})**\n[คลิกที่นี่เพื่อจัดการ Playlist](https://discordunknow-g4zs.vercel.app/?uid=${userId})`,
      flags: MessageFlags.Ephemeral
    });
  }
  else if (commandName === 'playlish') {
    await interaction.deferReply();

    if (!voiceChannel) {
      return interaction.editReply('คุณต้องเข้าห้องเสียงก่อนใช้คำสั่งนี้นะครับ!');
    }

    try {
      const userId = interaction.user.id;
      const dbRef = ref(db);
      // Read from updated path: playlists/{userId}
      const snapshot = await get(child(dbRef, `playlists/${userId}`));

      if (!snapshot.exists()) {
        return interaction.editReply('Playlist ของคุณว่างเปล่าครับ! ไปเพิ่มเพลงที่ `/site` ในเว็บก่อนนะ');
      }

      const data = snapshot.val();
      // Helper to sort if data is array-like or object
      const playlist = Array.isArray(data) ? data : Object.values(data);
      const validSongs = playlist.filter(url => url && typeof url === 'string');

      if (validSongs.length === 0) {
        return interaction.editReply('Playlist ของคุณว่างเปล่าครับ!');
      }

      await interaction.editReply(`กำลังโหลด **${validSongs.length}** เพลงจาก Playlist ของคุณ...`);

      for (const url of validSongs) {
        try {
          await distube.play(voiceChannel, url, {
            member: interaction.member,
            textChannel: interaction.channel,
            skip: false
          });
        } catch (err) {
          console.error('Failed to load song:', url, err);
        }
      }

      await interaction.followUp('เพิ่มเพลงเข้าคิวเรียบร้อยครับ!');

    } catch (e) {
      console.error('Playlish Error:', e);
      await interaction.editReply('เกิดข้อผิดพลาดในการโหลด Playlist');
    }
  }
  else if (commandName === 'deletechat') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      // Fetch last 100 messages
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      // Filter only bot's messages
      const botMessages = messages.filter(msg => msg.author.id === client.user.id);

      if (botMessages.size > 0) {
        try {
          // Try Bulk Delete first (Faster, but needs 'Manage Messages' permission)
          await interaction.channel.bulkDelete(botMessages, true);
          await interaction.editReply(`✅ ลบข้อความของฉันแบบ Turbo ไปแล้ว **${botMessages.size}** ข้อความครับ!`);
        } catch (err) {
          if (err.code === 50013) {
            // Fallback: Delete one by one (Slower, but works without extra permission)
            await interaction.editReply('⚠️ ไม่มีสิทธิ์ "จัดการข้อความ" (Bulk Delete)... กำลังลบทีละข้อความครับ (อาจช้าหน่อย)...');
            let count = 0;
            for (const msg of botMessages.values()) {
              try { await msg.delete(); count++; } catch (e) { /* Ignore deleted */ }
            }
            await interaction.editReply(`✅ ลบข้อความของฉัน (Manual Mode) ไปแล้ว **${count}** ข้อความครับ!`);
          } else {
            throw err;
          }
        }
      } else {
        await interaction.editReply('❓ ไม่พบข้อความของฉันใน 100 ข้อความล่าสุดครับ');
      }
    } catch (e) {
      console.error('Delete Chat Error:', e);
      await interaction.editReply('❌ เกิดข้อผิดพลาดในการลบ (อาจไม่มีสิทธิ์ Manage Messages หรือข้อความเก่าเกิน 14 วัน)');
    }
  }
});

// --------------------------------------------------------------------------------
// 5. Start
// --------------------------------------------------------------------------------
const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ Error: Token not found in .env files!');
  console.error('   Please check if .env exists and has TOKEN=... inside.');
} else {
  console.log(`🔑 Token found! (Length: ${token.length}) - Attempting login...`);
  if (token.includes(' ')) console.warn('⚠️ Warning: Token seems to have spaces. Please remove them in .env!');
}

client.on('ready', () => {
  console.log(`✅ ${client.user.tag} is online!`);

  // Set Custom Status (Like Pekky)
  client.user.setActivity('/nestle | v1.1.4 Lastversion', { type: ActivityType.Listening });
  console.log(`📊 Stats: ${client.guilds.cache.size} Servers, ${client.users.cache.size} Users`);

  // Update Firebase Stats every 5 seconds
  setInterval(() => {
    try {
      // 1. General Bot Stats
      const statsRef = ref(db, 'stats/bot_status');
      set(statsRef, {
        ping: client.ws.ping,
        uptime: process.uptime(),
        servers: client.guilds.cache.size,
        users: client.users.cache.size,
        last_updated: Date.now()
      });

      // 2. Active Session Tracking (Ping Monitor)
      const sessions = [];
      console.log(`[DEBUG] Syncing... Active Voice Connections: ${distube.voices.collection.size}`); // Debug Log
      distube.voices.collection.forEach((voice) => {
        // voice.connection.ping.udp is the voice latency (often more relevant for music)
        // If not available, fall back to ws ping or a random jitter for realism if undefined
        const voicePing = voice.connection?.ping?.udp ?? voice.connection?.ping?.ws ?? client.ws.ping;

        sessions.push({
          guildId: voice.id,
          name: voice.channel?.guild?.name || `Room #${voice.id.slice(-4)}`,
          ping: Math.round(voicePing),
          channelName: voice.channel?.name || 'Unknown Channel'
        });
      });
      console.log('[DEBUG] Sessions payload:', JSON.stringify(sessions)); // Debug Payload

      const sessionsRef = ref(db, 'stats/active_sessions');
      set(sessionsRef, sessions);

    } catch (err) {
      console.error('Firebase Stats Error:', err);
    }
  }, 5000);
});

// --------------------------------------------------------------------------------
// 6. Global Error Handling (Prevent Crashes)
// --------------------------------------------------------------------------------
client.on('error', (error) => {
  console.error('⚠️ Discord Client Error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('⚠️ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('⚠️ Uncaught Exception:', error);
});


client.login(token).catch(e => {
  if (e.code === 'TokenInvalid') {
    console.error('\n❌ LOGIN FAILED: The token provided is invalid or has expired.');
    console.error('   Please follow these steps:');
    console.error('   1. Go to https://discord.com/developers/applications');
    console.error('   2. Select your Application > "Bot" tab');
    console.error('   3. Click "Reset Token" and copy the new token');
    console.error('   4. Update the TOKEN value in your .env file\n');
  } else {
    console.error('Failed to login:', e);
  }
});

// --------------------------------------------------------------------------------
// 7. HTTP Server for 24/7 Hosting (Render / Railway / UptimeRobot)
// --------------------------------------------------------------------------------
const http = require('http');
const port = process.env.PORT || 8080; // Changed to 8080 to avoid conflict with 'npx serve' (3000)
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NestleBot is waiting for commands!');
}).listen(port, () => {
  console.log(`🌐 HTTP Server is listening on port ${port} (Ready for UptimeRobot)`);
});
