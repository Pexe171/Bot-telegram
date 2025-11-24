from __future__ import annotations

import os
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional
from urllib.parse import urlparse

from .config import Settings


ROOT_DIR = Path(__file__).resolve().parents[2]
SERVICE_DIR = ROOT_DIR / "payment_service"


def _infer_port(payment_service_url: str) -> Optional[int]:
    parsed = urlparse(payment_service_url)
    if parsed.port:
        return parsed.port
    if parsed.scheme == "http":
        return 80
    if parsed.scheme == "https":
        return 443
    return None


def _stream_logs(process: subprocess.Popen[str]) -> None:
    if not process.stdout:
        return
    for line in process.stdout:
        print(f"[payment_service] {line.rstrip()}")


@contextmanager
def maybe_launch_payment_service(settings: Settings) -> Iterator[Optional[subprocess.Popen[str]]]:
    start_flag = os.getenv("START_PAYMENT_SERVICE", "true").lower() not in {"0", "false", "no"}
    if not start_flag:
        yield None
        return

    if not SERVICE_DIR.exists():
        print("[payment_service] Diretório payment_service não encontrado, pulei a inicialização automática.")
        yield None
        return

    env = os.environ.copy()
    port = _infer_port(settings.payment_service_url)
    if port:
        env.setdefault("PORT", str(port))

    command = ["npm", "--prefix", str(SERVICE_DIR), "start"]
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            cwd=str(SERVICE_DIR),
        )
    except FileNotFoundError:
        print("[payment_service] npm não encontrado. Instale Node.js/NPM ou desative com START_PAYMENT_SERVICE=0.")
        yield None
        return

    log_thread = threading.Thread(target=_stream_logs, args=(process,), daemon=True)
    log_thread.start()

    try:
        yield process
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
