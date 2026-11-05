const { PermissionFlagsBits } = require("discord.js");

/** 서버 소유자 또는 Administrator 권한자인지 (관리자 전용 명령어의 실행 확인에 공통 사용) */
function isServerAdmin(interaction) {
  return Boolean(
    interaction.guild?.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

/**
 * 서버 운영자급인지: 서버 소유자, 관리자(Administrator), 또는 '서버 관리(ManageGuild)' 권한이 있는 역할(매니저)
 * (서버 설정·제재 같은 서버 운영 명령에 사용)
 */
function isServerManager(interaction) {
  return Boolean(
    isServerAdmin(interaction) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
  );
}

module.exports = { isServerAdmin, isServerManager };
