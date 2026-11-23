"""Open Kosh in the default browser; start the local service if needed."""

import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError
import json

URL = "http://127.0.0.1:8765"


def ready():
    try:
        with urlopen(URL + "/api/dashboard", timeout=1) as r:
            return "opening" in json.load(r)
    except (URLError, TimeoutError, ValueError):
        return False


if __name__ == "__main__":
    if ready():
        webbrowser.open(URL)
    else:
        server = subprocess.Popen([sys.executable, "app.py"], cwd=Path(__file__).resolve().parents[1])
        for _ in range(60):
            if server.poll() is not None:
                raise SystemExit(server.returncode)
            if ready():
                webbrowser.open(URL)
                break
            time.sleep(0.15)
        try:
            server.wait()
        except KeyboardInterrupt:
            server.terminate()
