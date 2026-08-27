from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    taskflow_env: str = "development"
    database_url: str = "sqlite+pysqlite:///./taskflow.db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret_key: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_expires_minutes: int = 15
    refresh_token_expires_days: int = 30

    # Background jobs (Milestone 7): scheduling intervals are configurable so
    # deployments can tune cadence without a code change.
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None
    overdue_scan_interval_minutes: int = 15
    due_soon_reminder_interval_minutes: int = 30
    due_soon_window_hours: int = 24
    digest_interval_hours: int = 24
    session_cleanup_interval_hours: int = 6
    refresh_token_retention_days: int = 30

    @property
    def resolved_celery_broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def resolved_celery_result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    @field_validator("jwt_secret_key")
    @classmethod
    def reject_placeholder_secret(cls, value: str) -> str:
        weak_values = {"change-me", "dev-secret", "secret", "taskflow"}
        if value.lower() in weak_values:
            raise ValueError("JWT_SECRET_KEY must be a strong environment-provided secret")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
