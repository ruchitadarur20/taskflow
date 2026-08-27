from __future__ import annotations

import os
from collections.abc import Generator

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-with-at-least-thirty-two-characters")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.settings import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.domains.auth.models import RefreshToken, User  # noqa: F401
from app.domains.jobs.models import JobRun  # noqa: F401
from app.domains.notifications.models import Notification  # noqa: F401
from app.domains.projects.models import (  # noqa: F401  # noqa: F401
    ActivityEvent,
    Label,
    Project,
    Task,
    TaskComment,
    TaskDependency,
    TaskLabel,
)
from app.domains.workspaces.models import Workspace, WorkspaceMember  # noqa: F401
from app.main import app
from app.realtime.broker import InMemoryBroker, reset_broker, set_broker
from app.realtime.connection_manager import connection_manager


@pytest.fixture()
def db_session() -> Generator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with TestingSessionLocal() as session:
        yield session


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient]:
    def override_get_db() -> Generator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    get_settings.cache_clear()
    set_broker(InMemoryBroker())
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    get_settings.cache_clear()
    reset_broker()
    connection_manager.reset()
