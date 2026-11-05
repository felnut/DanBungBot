// 버튼 → 입력창(모달)으로 답을 넣는 한 사람용 추측 게임 틀 (/업다운, /초성퀴즈가 함께 쓴다).
// 상태는 이 함수 안에만 있고 DB에는 아무것도 저장하지 않는다.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const GAME_MS = 10 * 60 * 1000; // 게임 전체 제한 시간
const INPUT_MS = 2 * 60 * 1000; // 입력창을 연 뒤 제출까지 기다리는 시간

/**
 * @param interaction 슬래시 명령어 인터랙션
 * @param opts.title / opts.color / opts.intro  첫 화면
 * @param opts.maxTries     기회 횟수
 * @param opts.inputLabel   입력창 제목, opts.placeholder 입력 예시, opts.maxLength 최대 글자 수
 * @param opts.judge        (입력, 지금까지 틀린 횟수) => { invalid?: 안내 } | { correct: true, text } | { correct: false, text }
 * @param opts.reveal       () => 졌을 때 공개할 정답 문구
 */
async function runGuessGame(interaction, opts) {
  const {
    title,
    color = 0x5865f2,
    intro,
    maxTries,
    inputLabel,
    placeholder,
    maxLength = 20,
    judge,
    reveal,
  } = opts;
  const buttonId = `guess:${interaction.id}`;
  const modalId = `guessmodal:${interaction.id}`;
  const history = [];
  let tries = 0;
  let note = "";

  const view = (footer) =>
    new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(
        [
          intro,
          history.length ? `\n${history.join("\n")}` : "",
          note ? `\n${note}` : "",
        ].join(""),
      )
      .setFooter({ text: footer ?? `남은 기회 ${maxTries - tries}번` });
  const button = (disabled = false) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buttonId)
        .setLabel("답 입력하기")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    );

  await interaction.reply({ embeds: [view()], components: [button()] });
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id && i.customId === buttonId,
    componentType: ComponentType.Button,
    time: GAME_MS,
  });
  let finished = false;
  let busy = false; // 입력창이 열려 있는 동안 버튼을 또 눌러도 한 번만 처리한다

  collector.on("collect", async (i) => {
    if (busy) return i.deferUpdate().catch(() => {});
    busy = true;
    try {
      await i.showModal(
        new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(inputLabel)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("answer")
                .setLabel(inputLabel)
                .setPlaceholder(placeholder ?? "")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(maxLength),
            ),
          ),
      );
      const sub = await i
        .awaitModalSubmit({
          time: INPUT_MS,
          filter: (m) => m.customId === modalId && m.user.id === i.user.id,
        })
        .catch(() => null);
      if (!sub) return;

      const input = sub.fields.getTextInputValue("answer").trim();
      const result = judge(input, tries);
      if (result.invalid) {
        note = `⚠️ ${result.invalid}`;
        return sub.update({ embeds: [view()], components: [button()] });
      }
      tries += 1;
      note = "";
      history.push(`\`${input}\` → ${result.text}`);
      if (result.correct || tries >= maxTries) {
        finished = true;
        const won = Boolean(result.correct);
        note = won
          ? `🎉 **정답!** ${tries}번 만에 맞혔어요!`
          : `😢 기회를 모두 썼어요. 정답은 **${reveal()}** 였어요.`;
        await sub.update({
          embeds: [
            view(
              won ? "게임 끝 · 다시 하려면 명령어를 또 쓰세요" : "게임 끝",
            ).setColor(won ? 0x57f287 : 0xed4245),
          ],
          components: [button(true)],
        });
        collector.stop("done");
        return;
      }
      await sub.update({ embeds: [view()], components: [button()] });
    } catch (e) {
      console.error("추측 게임 처리 오류:", e?.message ?? e);
    } finally {
      busy = false;
    }
  });

  collector.on("end", async () => {
    if (finished) return;
    note = `⌛ 시간이 지나서 끝났어요. 정답은 **${reveal()}** 였어요.`;
    await interaction
      .editReply({ embeds: [view("게임 끝")], components: [button(true)] })
      .catch(() => {});
  });
}

module.exports = { runGuessGame };
