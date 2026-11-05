const { randomUUID } = require("node:crypto");

// No response bodies, tokens or raw network errors are written to logs.
class Sender {
  constructor({ baseUrl, secret, fetchImpl = fetch, log = console.warn }) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error("MONITOR_BASE_URL must be an HTTPS origin");
    }
    this.baseUrl = url.origin;
    this.secret = secret;
    this.fetch = fetchImpl;
    this.log = log;
    this.instanceId = randomUUID();
    this.registrationId = randomUUID();
    this.sequence = 0;
    this.stopped = false;
    this.busy = false;
  }

  async post(path, token, body) {
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      // Bound body consumption as well as the request itself.
      let size = 0;
      const chunks = [];
      if (response.body) {
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 16_384) throw new Error("Response too large");
          chunks.push(Buffer.from(chunk));
        }
      }
      return {
        status: response.status,
        text: Buffer.concat(chunks).toString("utf8"),
      };
    } catch {
      return { status: 0, text: "" };
    }
  }

  async tick(checks) {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      if (!this.token) {
        const body = JSON.stringify({
          registrationId: this.registrationId,
          instanceId: this.instanceId,
        });
        const result = await this.post(
          "/api/monitor/register",
          this.secret,
          body,
        );
        if ([401, 403, 409, 410].includes(result.status)) {
          this.stopped = true;
          this.log("[monitor] 등록 거부: 송신 중지 (설정·활성 실행 확인 필요)");
          return;
        }
        if (result.status < 200 || result.status >= 300) {
          this.log(
            `[monitor] 등록 실패 (${result.status || "NETWORK"}), 다음 주기에 재시도`,
          );
          return;
        }
        let data;
        try {
          data = JSON.parse(result.text);
        } catch {
          /* validated below */
        }
        if (
          !Number.isSafeInteger(data?.generation) ||
          data.generation < 1 ||
          typeof data?.instanceToken !== "string" ||
          !data.instanceToken ||
          data.instanceToken.length > 4096 ||
          /[\r\n]/.test(data.instanceToken)
        ) {
          this.log("[monitor] 등록 응답 형식 오류");
          return;
        }
        this.generation = data.generation;
        this.token = data.instanceToken;
      }
      const body = JSON.stringify({
        instanceId: this.instanceId,
        generation: this.generation,
        sequence: ++this.sequence,
        createdAt: new Date().toISOString(),
        checks,
      });
      // Retry once with exactly the same serialized message. Never queue old heartbeats.
      let result = await this.post("/api/heartbeat", this.token, body);
      if (result.status === 0 || result.status >= 500) {
        result = await this.post("/api/heartbeat", this.token, body);
      }
      if ([401, 403, 409, 410].includes(result.status)) {
        this.stopped = true;
        this.log(
          "[monitor] 실행 인증 거부·폐기: 송신 중지 (자동 재등록 안 함)",
        );
      } else if (result.status < 200 || result.status >= 300) {
        this.log(
          `[monitor] 전송 실패 (${result.status || "NETWORK"}), 다음 주기에 새 메시지 전송`,
        );
      }
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Sender };
