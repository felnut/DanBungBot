"""yt-dlp 상시 워커.

봇(Node)이 표준입력으로 한 줄에 하나씩 JSON 요청을 보내면, 이미 로드된 yt-dlp로 추출해서
표준출력에 한 줄 JSON으로 응답한다. 요청마다 프로세스를 새로 띄우는 비용(약 3초)을 없애기 위한 것.

요청:  {"id": 1, "target": "https://youtu.be/..." | "ytsearch1:검색어"}
응답:  {"id": 1, "ok": true, "info": {...}} | {"id": 1, "ok": false, "error": "..."}
"""
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import yt_dlp

FIELDS = ("id", "title", "uploader", "thumbnail", "webpage_url", "url", "duration", "is_live")
WORKERS = 3

# 영상 자체의 문제는 다른 옵션으로 재시도해도 소용없음
_VIDEO_PROBLEM = re.compile(r"unavailable|private video|removed|confirm your age|members-only|copyright|terminated", re.I)

_local = threading.local()
_out_lock = threading.Lock()


class _SilentLogger:
    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass


def _make(fast):
    opts = {
        "format": "bestaudio",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "logger": _SilentLogger(),
        "js_runtimes": {"node": {}},
    }
    if fast:
        # HLS/DASH 매니페스트 요청을 생략해 추출 시간을 약 0.4초 줄인다 (라이브 등은 일반 모드로 재시도)
        opts["extractor_args"] = {"youtube": {"skip": ["hls", "dash", "translated_subs"]}}
    return yt_dlp.YoutubeDL(opts)


def _ydl(fast=True):
    """스레드마다 YoutubeDL 인스턴스를 모드별로 하나씩 재사용 (인스턴스는 스레드 간 공유하지 않음)."""
    attr = "fast" if fast else "full"
    if not hasattr(_local, attr):
        setattr(_local, attr, _make(fast))
    return getattr(_local, attr)


def _flat():
    """검색용 인스턴스: 영상 정보를 다 받지 않고 목록만 가져온다 (훨씬 빠름)."""
    if not hasattr(_local, "flat"):
        _local.flat = yt_dlp.YoutubeDL(
            {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "extract_flat": "in_playlist",
                "logger": _SilentLogger(),
                "js_runtimes": {"node": {}},
            }
        )
    return _local.flat


def _search(req):
    """유튜브 검색: 채널·재생목록·예정된 라이브를 걸러내고 영상만 count개 돌려준다."""
    rid = req.get("id")
    try:
        count = max(1, min(int(req.get("count", 5)), 10))
        # 채널/재생목록 결과가 섞이므로 여유 있게 가져온 뒤 거른다
        info = _flat().extract_info(f"ytsearch{count + 5}:{req['query']}", download=False)
        out = []
        for e in (info or {}).get("entries") or []:
            if not e:
                continue
            vid = e.get("id") or ""
            if len(vid) != 11 or e.get("ie_key") not in (None, "Youtube"):
                continue
            if e.get("live_status") == "is_upcoming":
                continue
            out.append(
                {
                    "id": vid,
                    "title": e.get("title"),
                    "uploader": e.get("channel") or e.get("uploader"),
                    "duration": e.get("duration"),
                    "is_live": e.get("live_status") == "is_live",
                }
            )
            if len(out) >= count:
                break
        _send({"id": rid, "ok": True, "results": out})
    except Exception as e:  # noqa: BLE001
        _send({"id": rid, "ok": False, "error": str(e)})


def _send(obj):
    line = json.dumps(obj, ensure_ascii=False)
    with _out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def _handle(req):
    if req.get("op") == "search":
        return _search(req)
    rid = req.get("id")
    try:
        try:
            info = _ydl(True).extract_info(req["target"], download=False)
        except Exception as e:  # noqa: BLE001
            if _VIDEO_PROBLEM.search(str(e)):
                raise
            info = _ydl(False).extract_info(req["target"], download=False)
        if info and "entries" in info:
            entries = [e for e in info["entries"] if e]
            if not entries:
                raise yt_dlp.utils.DownloadError("ERROR: no results")
            info = entries[0]
        _send({"id": rid, "ok": True, "info": {k: info.get(k) for k in FIELDS}})
    except Exception as e:  # noqa: BLE001 - 어떤 오류든 Node에 전달
        _send({"id": rid, "ok": False, "error": str(e)})


def main():
    # stdin/stdout을 UTF-8로 고정 (윈도우 기본 코드페이지 방지)
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    _ydl(True)  # 메인 스레드에서 미리 한 번 초기화
    _send({"ready": True, "version": yt_dlp.version.__version__})
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                pool.submit(_handle, json.loads(line))
            except json.JSONDecodeError:
                continue


if __name__ == "__main__":
    main()
