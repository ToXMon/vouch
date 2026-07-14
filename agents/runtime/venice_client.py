"""Shared Venice AI API client.

Wraps Venice chat-completion endpoints with retry-on-429 and timeout handling.
The API key is read from os.environ['VENICE_API_KEY'] only — never hardcoded.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

VENICE_BASE_URL = "https://api.venice.ai/api/v1"
CHAT_COMPLETIONS_PATH = "/chat/completions"
DEFAULT_TIMEOUT = 30.0
MAX_RETRIES = 3
BASE_BACKOFF = 1.5  # seconds; exponent base for backoff


class VeniceError(RuntimeError):
    """Raised when a Venice API call fails after all retries."""


def _require_api_key() -> str:
    api_key = os.environ.get("VENICE_API_KEY")
    if not api_key:
        raise VeniceError("VENICE_API_KEY is not set in the environment")
    return api_key


async def chat_completion(
    model: str,
    messages: list[dict[str, Any]],
    *,
    timeout: float = DEFAULT_TIMEOUT,
    **kwargs: Any,
) -> str:
    """Call Venice chat completions and return the assistant message content.

    Retries on HTTP 429 with exponential backoff honoring Retry-After when present.
    Raises VeniceError on persistent failure, missing key, or non-retryable HTTP errors.
    """
    api_key = _require_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {"model": model, "messages": messages, **kwargs}
    url = f"{VENICE_BASE_URL}{CHAT_COMPLETIONS_PATH}"

    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.post(url, headers=headers, json=payload)
            except httpx.TimeoutException as exc:
                last_exc = exc
                logger.warning("Venice timeout (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, exc)
                await asyncio.sleep(BASE_BACKOFF ** (attempt + 1))
                continue
            except httpx.HTTPError as exc:
                last_exc = exc
                logger.warning("Venice transport error (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, exc)
                await asyncio.sleep(BASE_BACKOFF ** (attempt + 1))
                continue

            if resp.status_code == 429:
                retry_after = _parse_retry_after(resp.headers.get("Retry-After"), attempt)
                logger.warning("Venice 429 rate limited; retrying in %.1fs", retry_after)
                await asyncio.sleep(retry_after)
                last_exc = VeniceError("Venice rate limited")
                continue

            if resp.status_code >= 500:
                backoff = BASE_BACKOFF ** (attempt + 1)
                logger.warning("Venice server error %d; retrying in %.1fs", resp.status_code, backoff)
                await asyncio.sleep(backoff)
                last_exc = VeniceError(f"Venice server error {resp.status_code}")
                continue

            if resp.status_code >= 400:
                # Client errors other than 429 are not retryable
                raise VeniceError(f"Venice client error {resp.status_code}: {resp.text}")

            data = resp.json()
            try:
                return data["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError) as exc:
                raise VeniceError(f"Unexpected Venice response shape: {data!r}") from exc

    raise VeniceError(f"Venice API call failed after {MAX_RETRIES} retries") from last_exc


def _parse_retry_after(header_value: str | None, attempt: int) -> float:
    if header_value is None:
        return BASE_BACKOFF ** (attempt + 1)
    try:
        return float(header_value)
    except (TypeError, ValueError):
        return BASE_BACKOFF ** (attempt + 1)
