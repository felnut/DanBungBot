const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const EPHEMERAL = MessageFlags.Ephemeral;
const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const { isServerManager } = require("../utils/perm");

/** 봇이 해당 채널에서 필요한 권한을 가졌는지 확인해 부족한 권한 이름을 돌려준다 */
function missingBotPerms(channel, perms) {
  const mine = channel.permissionsFor(channel.guild.members.me);
  return perms.filter(([flag]) => !mine?.has(flag)).map(([, name]) => name);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("서버관리")
    .setDescription("[서버 운영자 전용] 메시지 정리·슬로우모드·채널 잠금·공지")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // 서버 관리 권한(관리자 포함)이 있는 사람에게만 보임
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("청소")
        .setDescription("이 채널의 최근 메시지를 지워요 (14일 이내 메시지만)")
        .addIntegerOption((o) =>
          o
            .setName("개수")
            .setDescription("지울 개수 (1~100)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100),
        )
        .addUserOption((o) =>
          o.setName("유저").setDescription("이 유저의 메시지만 지우기"),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("슬로우모드")
        .setDescription("이 채널의 채팅 간격을 설정해요")
        .addIntegerOption((o) =>
          o
            .setName("초")
            .setDescription("0이면 해제 (최대 21600초)")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(21600),
        ),
    )
    .addSubcommand((s) =>
      s.setName("잠금").setDescription("이 채널에서 @everyone의 채팅을 막아요"),
    )
    .addSubcommand((s) =>
      s.setName("잠금해제").setDescription("이 채널의 채팅 제한을 풀어요"),
    )
    .addSubcommand((s) =>
      s
        .setName("공지")
        .setDescription("공지 임베드를 보내요 (멘션 알림은 가지 않아요)")
        .addStringOption((o) =>
          o
            .setName("내용")
            .setDescription("공지 내용 (줄바꿈은 \\n)")
            .setRequired(true)
            .setMaxLength(1500),
        )
        .addStringOption((o) =>
          o.setName("제목").setDescription("공지 제목").setMaxLength(100),
        )
        .addChannelOption((o) =>
          o
            .setName("채널")
            .setDescription("보낼 채널 (기본: 이 채널)")
            .addChannelTypes(...TEXT_TYPES),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !isServerManager(interaction)) {
      return interaction.reply({
        content:
          "❌ 서버 소유자 또는 서버 관리 권한이 있는 역할만 사용할 수 있어요.",
        flags: EPHEMERAL,
      });
    }
    const sub = interaction.options.getSubcommand();
    const channel = interaction.channel;
    console.log(`[서버관리] ${sub} (서버 ${interaction.guildId})`);

    try {
      if (sub === "청소") {
        const miss = missingBotPerms(channel, [
          [PermissionFlagsBits.ManageMessages, "메시지 관리"],
          [PermissionFlagsBits.ReadMessageHistory, "메시지 기록 보기"],
        ]);
        if (miss.length)
          return interaction.reply({
            content: `❌ 봇에게 이 채널의 **${miss.join(", ")}** 권한이 필요해요.`,
            flags: EPHEMERAL,
          });
        await interaction.reply({
          content: "🧹 정리하는 중…",
          flags: EPHEMERAL,
        });
        const count = interaction.options.getInteger("개수");
        const target = interaction.options.getUser("유저");
        let source = count;
        if (target) {
          const recent = await channel.messages.fetch({ limit: 100 });
          source = recent.filter((m) => m.author.id === target.id).first(count);
        }
        const deleted = await channel.bulkDelete(source, true); // 14일 지난 메시지는 건너뜀
        return interaction.editReply(
          `🧹 ${deleted.size}개 지웠어요.${deleted.size < (target ? source.length : count) ? " (14일이 지난 메시지는 지울 수 없어요)" : ""}`,
        );
      }

      if (sub === "슬로우모드") {
        if (!TEXT_TYPES.includes(channel.type))
          return interaction.reply({
            content: "❌ 텍스트 채널에서만 쓸 수 있어요.",
            flags: EPHEMERAL,
          });
        const miss = missingBotPerms(channel, [
          [PermissionFlagsBits.ManageChannels, "채널 관리"],
        ]);
        if (miss.length)
          return interaction.reply({
            content: `❌ 봇에게 이 채널의 **${miss.join(", ")}** 권한이 필요해요.`,
            flags: EPHEMERAL,
          });
        const sec = interaction.options.getInteger("초");
        await channel.setRateLimitPerUser(
          sec,
          `슬로우모드 설정 (${interaction.user.username})`,
        );
        return interaction.reply(
          sec
            ? `🐢 이 채널에 슬로우모드 **${sec}초**를 설정했어요.`
            : "🐇 슬로우모드를 해제했어요.",
        );
      }

      if (sub === "잠금" || sub === "잠금해제") {
        if (!TEXT_TYPES.includes(channel.type))
          return interaction.reply({
            content: "❌ 텍스트 채널에서만 쓸 수 있어요.",
            flags: EPHEMERAL,
          });
        const miss = missingBotPerms(channel, [
          [PermissionFlagsBits.ManageChannels, "채널 관리"],
        ]);
        if (miss.length)
          return interaction.reply({
            content: `❌ 봇에게 이 채널의 **${miss.join(", ")}** 권한이 필요해요.`,
            flags: EPHEMERAL,
          });
        const lock = sub === "잠금";
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          {
            SendMessages: lock ? false : null,
            SendMessagesInThreads: lock ? false : null,
          },
          { reason: `${sub} (${interaction.user.username})` },
        );
        return interaction.reply(
          lock
            ? "🔒 이 채널을 잠갔어요. (관리자는 계속 쓸 수 있어요)"
            : "🔓 채널 잠금을 풀었어요.",
        );
      }

      // 공지
      const target = interaction.options.getChannel("채널") ?? channel;
      const miss = missingBotPerms(target, [
        [PermissionFlagsBits.ViewChannel, "채널 보기"],
        [PermissionFlagsBits.SendMessages, "메시지 보내기"],
        [PermissionFlagsBits.EmbedLinks, "링크 첨부"],
      ]);
      if (miss.length)
        return interaction.reply({
          content: `❌ 봇에게 <#${target.id}>의 **${miss.join(", ")}** 권한이 필요해요.`,
          flags: EPHEMERAL,
        });
      const body = interaction.options.getString("내용").replace(/\\n/g, "\n");
      const title = interaction.options.getString("제목");
      const embed = new EmbedBuilder()
        .setColor("#5865f2")
        .setDescription(body)
        .setTimestamp();
      embed.setAuthor({ name: "📢 공지" });
      if (title) embed.setTitle(title);
      await target.send({ embeds: [embed], allowedMentions: { parse: [] } });
      return interaction.reply({
        content: `✅ <#${target.id}>에 공지를 보냈어요.`,
        flags: EPHEMERAL,
      });
    } catch (e) {
      console.error("서버관리 오류:", e.message);
      const msg = "❌ 처리하지 못했어요. 봇 권한과 채널 설정을 확인해 주세요.";
      return interaction.replied || interaction.deferred
        ? interaction.editReply(msg)
        : interaction.reply({ content: msg, flags: EPHEMERAL });
    }
  },
};
