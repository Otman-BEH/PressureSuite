"""FastAPI app: routes, error handlers and the web page. Start it with `python run.py` from backend/
(or `uvicorn pressuresuite.api.app:app --port 8000`).

When the web page has been built (`npm run build` in frontend/), the API serves it at /, so one address holds both and
nothing else needs to run. For page work, `npm run dev` in frontend/ serves it on port 5173 and calls this API."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .. import config
from .routes import cascade_fill

DESCRIPTION = """
Real-gas engineering tools for high-pressure gas systems. Each tool has its own routes under `/api/<tool-id>/`.

**COPV Cascade Fill** (`/api/cascade-fill/`): simulate, optimise and plan cascade fills of a COPV from gas bundles and
bottles. Gas properties from CoolProp.
"""

app = FastAPI(title="pressuresuite API", version=config.API_VERSION, description=DESCRIPTION)
# Only needed while the page runs on the Vite dev server (port 5173); the built page is served from this address.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(cascade_fill.router)


@app.exception_handler(ValueError)
async def _value(_: Request, ex: ValueError):
    # CoolProp reports out-of-range states as ValueError.
    return JSONResponse(status_code=422, content={"detail": str(ex)})


@app.get("/api", include_in_schema=False)
def api_root():
    return {"name": "pressuresuite API", "version": config.API_VERSION, "docs": "/docs",
            "tools": {"cascade-fill": "/api/cascade-fill/"},
            "web_page": "served at / once built (npm run build in frontend/)" if not config.WEB_DIR.is_dir() else "/"}


# Serve the built web page from the same address. Registered last, so every API route above wins over a file of the
# same name. Without a build, / explains how to make one instead of returning a bare 404.
if config.WEB_DIR.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=config.WEB_DIR, html=True), name="web")
else:
    @app.get("/", include_in_schema=False)
    def _root():
        return {**api_root(), "detail": "The web page has not been built yet: run `npm install` then `npm run build` in frontend/, "
                                        "then restart. Or use `npm run dev` there and open http://localhost:5173."}
