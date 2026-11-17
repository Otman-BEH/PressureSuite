"""Start pressuresuite:  python run.py

Starts the API on http://127.0.0.1:8000 (interactive docs at /docs) and, once the web page has been built, serves the
page at the same address. Build the page once with `npm install` and `npm run build` in frontend/; after that only
Python is needed and nothing touches the internet.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pressuresuite import config  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reload", action="store_true", help="restart when backend code changes (for development)")
    a = ap.parse_args(argv)

    url = f"http://{a.host}:{a.port}"
    print(f"pressuresuite {config.API_VERSION}")
    if config.WEB_DIR.is_dir():
        print(f"Open {url}  (API docs: {url}/docs)")
    else:
        print(f"API on {url}  (docs: {url}/docs)")
        print("The web page is not built yet. Either build it once (cd frontend, npm install, npm run build) and restart,")
        print("or run `npm run dev` in frontend/ and open http://localhost:5173")

    import uvicorn
    uvicorn.run("pressuresuite.api.app:app", host=a.host, port=a.port, reload=a.reload,
                app_dir=str(Path(__file__).resolve().parent), log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
