from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.notifications import router as notifications_router
from app.api.projects import router as projects_router
from app.api.realtime import router as realtime_router
from app.api.workspaces import router as workspaces_router
from app.realtime.broker import get_broker


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    broker = get_broker()
    await broker.start()
    try:
        yield
    finally:
        await broker.stop()


app = FastAPI(title="TaskFlow API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(workspaces_router)
app.include_router(projects_router)
app.include_router(realtime_router)
app.include_router(notifications_router)


@app.get("/health/live", tags=["health"])
async def live() -> dict[str, str]:
    return {"status": "ok"}
