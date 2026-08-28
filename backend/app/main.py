from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.api.notifications import router as notifications_router
from app.api.projects import router as projects_router
from app.api.realtime import router as realtime_router
from app.api.workspaces import router as workspaces_router
from app.core.logging import configure_logging
from app.core.middleware import request_observability_middleware, security_headers_middleware
from app.core.settings import get_settings
from app.realtime.broker import get_broker


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging(get_settings().resolved_api_log_level)
    broker = get_broker()
    await broker.start()
    try:
        yield
    finally:
        await broker.stop()


app = FastAPI(title="TaskFlow API", version="0.1.0", lifespan=lifespan)
settings = get_settings()

app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(security_headers_middleware)
app.middleware("http")(request_observability_middleware)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(workspaces_router)
app.include_router(projects_router)
app.include_router(realtime_router)
app.include_router(notifications_router)
