from __future__ import annotations

import logging
from functools import lru_cache
from typing import cast

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
DEV_TRUSTED_HOSTS = ["localhost", "127.0.0.1", "testserver"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    taskflow_env: str = "development"
    database_url: str = "sqlite+pysqlite:///./taskflow.db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret_key: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_expires_minutes: int = Field(default=15, gt=0)
    refresh_token_expires_days: int = Field(default=30, gt=0)
    cors_allowed_origins: list[str] = Field(default_factory=lambda: DEV_CORS_ORIGINS.copy())
    trusted_hosts: list[str] = Field(default_factory=lambda: DEV_TRUSTED_HOSTS.copy())
    api_log_level: str = "INFO"
    rate_limit_enabled: bool = True
    rate_limit_fail_open: bool = True
    login_rate_limit_max_attempts: int = Field(default=5, gt=0)
    login_rate_limit_window_seconds: int = Field(default=300, gt=0)
    register_rate_limit_max_attempts: int = Field(default=3, gt=0)
    register_rate_limit_window_seconds: int = Field(default=300, gt=0)
    refresh_rate_limit_max_attempts: int = Field(default=20, gt=0)
    refresh_rate_limit_window_seconds: int = Field(default=300, gt=0)
    websocket_rate_limit_max_attempts: int = Field(default=30, gt=0)
    websocket_rate_limit_window_seconds: int = Field(default=60, gt=0)
    websocket_ticket_ttl_seconds: int = Field(default=60, gt=0, le=300)
    stale_job_timeout_minutes: int = Field(default=120, gt=0)

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

    @property
    def is_production(self) -> bool:
        return self.taskflow_env.lower() in {"production", "prod"}

    @property
    def resolved_api_log_level(self) -> int:
        return cast(int, logging.getLevelName(self.api_log_level.upper()))

    @field_validator("cors_allowed_origins", "trusted_hosts", mode="before")
    @classmethod
    def split_csv_settings(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("jwt_secret_key")
    @classmethod
    def reject_placeholder_secret(cls, value: str) -> str:
        weak_values = {"change-me", "dev-secret", "secret", "taskflow"}
        if value.lower() in weak_values:
            raise ValueError("JWT_SECRET_KEY must be a strong environment-provided secret")
        return value

    @field_validator("api_log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        normalized = value.upper()
        if not isinstance(logging.getLevelName(normalized), int):
            raise ValueError("API_LOG_LEVEL must be a valid Python logging level")
        return normalized

    @model_validator(mode="after")
    def reject_dangerous_production_settings(self) -> Settings:
        if not self.is_production:
            return self
        origin_set = set(self.cors_allowed_origins)
        if not origin_set or origin_set.issubset(set(DEV_CORS_ORIGINS)):
            raise ValueError("Production CORS origins must be explicitly configured")
        if "*" in origin_set:
            raise ValueError("Production CORS origins must not include '*'")
        host_set = set(self.trusted_hosts)
        if not host_set or "*" in host_set or host_set.issubset(set(DEV_TRUSTED_HOSTS)):
            raise ValueError("Production trusted hosts must be explicitly configured")
        if self.database_url.startswith("sqlite"):
            raise ValueError("Production DATABASE_URL must use an external database")
        if "localhost" in self.redis_url or "127.0.0.1" in self.redis_url:
            raise ValueError("Production REDIS_URL must be explicitly configured")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
