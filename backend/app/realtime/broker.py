from __future__ import annotations

import asyncio
import logging
from typing import Protocol

import redis as redis_sync
import redis.asyncio as redis_asyncio

from app.realtime.connection_manager import ConnectionManager, connection_manager

logger = logging.getLogger("app.realtime")


class RealtimeBroker(Protocol):
    """Fanout boundary between domain code and the transport used to reach sockets.

    Domain/service code only ever calls `publish`. Everything about how a published
    message reaches locally-connected WebSockets - including whether other API
    instances are involved at all - is decided by the concrete implementation.
    """

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    def publish(self, channel: str, message: str) -> None: ...


class RedisBroker:
    """Production broker: publishes over Redis pub/sub and fans out from a
    background subscriber loop, so any API instance's publish reaches every
    instance's locally-connected sockets:

        publish() -> Redis channel -> every instance's listen loop -> its
        local ConnectionManager -> authorized WebSocket connections.
    """

    def __init__(self, redis_url: str, manager: ConnectionManager = connection_manager) -> None:
        self._redis_url = redis_url
        self._manager = manager
        self._publish_client: redis_sync.Redis | None = None
        self._async_client: redis_asyncio.Redis | None = None
        self._pubsub: redis_asyncio.client.PubSub | None = None
        self._listen_task: asyncio.Task[None] | None = None

    def publish(self, channel: str, message: str) -> None:
        try:
            if self._publish_client is None:
                self._publish_client = redis_sync.Redis.from_url(self._redis_url)
            self._publish_client.publish(channel, message)
        except Exception:  # noqa: BLE001 - fanout must never break the caller's transaction
            logger.warning("Realtime publish to Redis failed for channel %s", channel)

    async def start(self) -> None:
        self._async_client = redis_asyncio.Redis.from_url(self._redis_url)
        self._pubsub = self._async_client.pubsub()
        await self._pubsub.psubscribe("taskflow:*")
        self._listen_task = asyncio.create_task(self._listen(self._pubsub))

    async def _listen(self, pubsub: redis_asyncio.client.PubSub) -> None:
        try:
            async for message in pubsub.listen():
                if message.get("type") != "pmessage":
                    continue
                channel = message["channel"]
                if isinstance(channel, bytes):
                    channel = channel.decode("utf-8")
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                await self._manager.dispatch(channel, data)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - keep the app alive if Redis drops
            logger.exception("Realtime Redis listener stopped unexpectedly")

    async def stop(self) -> None:
        if self._listen_task is not None:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._listen_task = None
        if self._pubsub is not None:
            try:
                await self._pubsub.aclose()  # type: ignore[no-untyped-call]
            except Exception:  # noqa: BLE001
                pass
            self._pubsub = None
        if self._async_client is not None:
            try:
                await self._async_client.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._async_client = None
        if self._publish_client is not None:
            try:
                self._publish_client.close()
            except Exception:  # noqa: BLE001
                pass
            self._publish_client = None


class InMemoryBroker:
    """Single-process broker used in tests and as a dependency-free fallback.

    Delivers published messages directly to the local ConnectionManager on the
    event loop captured at `start()`, without any network hop. It implements the
    same publish contract as RedisBroker, so it exercises the real fanout/dispatch
    path end-to-end without requiring a live Redis server.
    """

    def __init__(self, manager: ConnectionManager = connection_manager) -> None:
        self._manager = manager
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()

    async def stop(self) -> None:
        self._loop = None

    def publish(self, channel: str, message: str) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._manager.dispatch(channel, message), self._loop)


_broker: RealtimeBroker | None = None


def get_broker() -> RealtimeBroker:
    global _broker
    if _broker is None:
        from app.core.settings import get_settings

        _broker = RedisBroker(get_settings().redis_url)
    return _broker


def set_broker(broker: RealtimeBroker) -> None:
    global _broker
    _broker = broker


def reset_broker() -> None:
    global _broker
    _broker = None
