# OMNI 감시 송신기

Node.js 22 이상에서 기존 `npm start`로 실행한다. 추가 패키지는 없다.
기본 비활성이며 수신 API를 구현하기 전에는 켜지 않는다.

```dotenv
MONITOR_ENABLED=1
MONITOR_BASE_URL=https://omni.felnut.com
MONITOR_REGISTER_SECRET=수신서버와_공유하는_등록용_비밀값
```

`MONITOR_BASE_URL`은 경로 없는 HTTPS origin이다. `.env`에 실제 값을 넣고 봇을 재시작한다.
Statuspage API 키는 미니PC에 넣지 않는다. 송신기는 Statuspage를 직접 변경하지 않는다.

## 수신 API와 맞출 계약

- `POST /api/monitor/register`: `Authorization: Bearer MONITOR_REGISTER_SECRET`
- 본문: `{ "registrationId": "UUID", "instanceId": "UUID" }`
- 200/201 응답: `{ "generation": 12, "instanceToken": "실행 전용 토큰" }`
- 같은 registrationId의 재시도는 같은 실행·세대·토큰을 반환해야 한다.
  이미 폐기됐다면 410을 반환하고 다시 활성화하지 않는다.
- `POST /api/heartbeat`: `Authorization: Bearer INSTANCE_TOKEN`
- 본문은 계획서의 instanceId, generation, sequence, createdAt, checks 규격을 따른다.
- 저장 성공은 2xx, 이미 처리한 중복 요청도 저장 결과를 확인한 뒤 2xx로 응답한다.
- 401/403/409/410은 등록 또는 실행의 영구 거부로 간주해 송신을 중지한다.
  일반적인 중복·시간 오차·본문 검증 오류는 409 대신 별도 4xx로 구분한다.
- 응답 본문은 최대 16 KiB. 리디렉션을 따르지 않으며 요청·응답에 10초 제한을 적용한다.

실행 ID는 **감시 자식 프로세스 실행**을 식별한다. 일시 네트워크 장애에는 같은 등록 ID로
다음 1분 주기에 재시도한다. 하트비트는 통신 오류·5xx에 한해 동일 본문으로 즉시 한 번
재시도하고 이후 버린다. 다음 주기에는 새 메시지를 만든다. 429는 즉시 재시도하지 않는다.
동시에 두 요청 흐름을 실행하지 않는다. 실행 토큰은 메모리에만 보관한다.

## 검사와 격리

- 봇은 10초마다 준비 상태와 ping만 IPC로 전달한다. 30초간 갱신이 없으면
  Discord 검사는 `BOT_STATE_TIMEOUT`이다. 봇 이벤트 루프 정지도 여기에 포함된다.
- 감시기는 1분마다 검사하며, 각 새 완료 결과에만 checkSequence를 증가시킨다.
  처음에는 `DISCORD_NOT_READY` 또는 `BOT_STATE_TIMEOUT`이 나올 수 있다.
- DB: 별도 worker에서 game.db를 읽기 전용으로 열고 실제 user 테이블을 조회한다.
  5초 초과 시 worker를 종료한다. DB 초기화·마이그레이션 코드는 로드하지 않는다.
- 음악: 기존 LAVALINK_HOST/PORT/PASSWORD로 `/v4/info`를 5초 제한으로 확인한다.
  현재 봇과 동일한 HTTP 접속 방식이며 음악 검색·재생 성공까지 검사하지 않는다.
- 검사 실패와 무관하게 하트비트를 보낸다. 학교·웹사이트 검사는 아직 전송하지 않는다.
- 부모 봇이 종료되거나 IPC가 끊기면 감시기도 종료한다. 외부에서는 신호 누락을 판정한다.
  감시기 자체가 종료되면 자동 재등록을 피하기 위해 재생성하지 않는다. 운영 로그를 확인하고
  의도적으로 봇을 재시작해야 한다. 미니PC 전원 차단은 외부 감시가 담당한다.

허용할 오류 코드:

```text
BOT_STATE_TIMEOUT DISCORD_NOT_READY DISCORD_LATENCY_UNKNOWN DISCORD_HIGH_LATENCY
DB_TIMEOUT DB_READ_FAILED
MUSIC_NOT_CONFIGURED MUSIC_HTTP_ERROR MUSIC_UNREACHABLE
```

Discord ping이 1000ms를 넘으면 degraded, 준비되지 않으면 down,
지연값이 아직 없으면 unknown이다. 음악 비밀번호 미설정도 unknown이다.
장애 3회·복구 2회 판정은 송신기가 하지 않고 외부 수신·감시 시스템이 담당한다.

## 검증

```powershell
node --test bot/monitor/sender.test.js
```

실제 토큰·Discord 로그인·외부 네트워크를 사용하지 않는다. 실제 수신 API가 준비되면
인증, 재등록, 서버 시계 오차, 강제 종료, 통신 단절과 Statuspage 반영을 별도 통합 시험한다.
