// 여러 명령어 파일을 하나의 슬래시 명령어(예: /도박 블랙잭, /유틸 계산)로 묶는 도구.
// 각 파일은 지금처럼 독립된 명령어로 만들어 두고, 묶음 파일(bot/commands/groups/*.js)이 이 함수로 하위 명령어로 이어 붙인다.
// 묶임에 들어간 파일은 단독 명령어로는 등록되지 않는다 (bot/commandLoader.js).
const { PermissionFlagsBits } = require("discord.js");

const cut = (text, max = 100) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** 객체의 함수를 원래 대상에 묶어서 돌려주는 프록시 (discord.js 객체의 메서드는 this가 필요하다) */
const bound = (target, overrides) =>
  new Proxy(target, {
    get(t, key) {
      if (key in overrides) return overrides[key];
      const value = Reflect.get(t, key, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });

/**
 * @param spec.name / spec.description  묶음 명령어 이름·설명
 * @param spec.adminOnly                true면 서버 관리자에게만 보인다 (실행 권한은 각 명령어가 따로 확인)
 * @param spec.entries 이어 붙일 명령어 목록. 한 항목은 다음 중 하나:
 *   { name, module }                  module에 하위 명령이 없으면 /묶음 name 이 된다. 있으면 /묶음 name 하위명령 이 된다.
 *   { module, flatten: {새이름: 옛하위명령} }   module의 하위 명령을 이름을 바꿔 /묶음 새이름 으로 펼친다.
 */
function makeGroup(spec) {
  const options = [];
  const routes = new Map(); // "묶음이름/하위명령" → { module, legacy }
  const absorbs = [];

  for (const entry of spec.entries) {
    const mod = entry.module;
    absorbs.push(mod);
    const json = mod.data.toJSON();
    const subs = (json.options ?? []).filter((o) => o.type === 1);
    // 묶으면 원래 명령어의 '기본 필요 권한'(화면에 보이는 범위)이 묶음에 적용되지 않으므로, 실행할 때 한 번 더 확인한다
    const perms = json.default_member_permissions ?? null;

    if (entry.flatten) {
      for (const [newName, oldName] of Object.entries(entry.flatten)) {
        const sub = subs.find((s) => s.name === oldName);
        if (!sub)
          throw new Error(
            `${spec.name}: ${json.name}에 하위 명령 ${oldName}이(가) 없어요`,
          );
        options.push({ ...sub, name: newName });
        routes.set(`/${newName}`, { module: mod, legacy: oldName, perms });
      }
    } else if (subs.length) {
      options.push({
        type: 2,
        name: entry.name,
        description: cut(entry.description ?? json.description),
        options: subs,
      });
      for (const s of subs)
        routes.set(`${entry.name}/${s.name}`, {
          module: mod,
          legacy: s.name,
          perms,
        });
    } else {
      options.push({
        type: 1,
        name: entry.name,
        description: cut(entry.description ?? json.description),
        options: json.options ?? [],
      });
      routes.set(`/${entry.name}`, { module: mod, legacy: null, perms });
    }
  }

  const names = options.map((o) => o.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`${spec.name}: 하위 명령 이름이 겹쳐요 (${dup})`);
  if (options.length > 25)
    throw new Error(`${spec.name}: 하위 명령은 25개까지예요`);

  const json = { name: spec.name, description: cut(spec.description), options };
  if (spec.adminOnly)
    json.default_member_permissions = String(PermissionFlagsBits.Administrator);

  /** 들어온 인터랙션을 맞는 파일이 기대하는 모양(옛 명령어 이름·하위 명령)으로 바꿔서 넘긴다 */
  const route = (interaction) => {
    const group = interaction.options.getSubcommandGroup(false) ?? "";
    const sub = interaction.options.getSubcommand(false) ?? "";
    const target = routes.get(`${group}/${sub}`);
    if (!target) return null;
    const options = bound(interaction.options, {
      getSubcommand: () => target.legacy,
      getSubcommandGroup: () => null,
    });
    return {
      module: target.module,
      perms: target.perms,
      interaction: bound(interaction, {
        options,
        commandName: target.module.data.name,
      }),
    };
  };

  return {
    absorbs,
    data: { name: spec.name, toJSON: () => json },
    async execute(interaction) {
      const r = route(interaction);
      if (!r)
        return interaction.reply({
          content: "알 수 없는 명령어예요.",
          flags: 64,
        });
      if (r.perms && !interaction.memberPermissions?.has(BigInt(r.perms))) {
        return interaction.reply({
          content: "이 명령어를 쓸 권한이 없어요.",
          flags: 64,
        });
      }
      return r.module.execute(r.interaction);
    },
    async autocomplete(interaction) {
      const r = route(interaction);
      if (r?.module.autocomplete) return r.module.autocomplete(r.interaction);
      return interaction.respond([]);
    },
  };
}

module.exports = { makeGroup };
