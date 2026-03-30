import contextvars
import logging
import os
import time
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

logger = logging.getLogger("papertrend.model_router")


class ModelTask(str, Enum):
    DEFAULT_TEXT = "DEFAULT_TEXT"
    VISION_OCR = "VISION_OCR"
    SEGMENTATION = "SEGMENTATION"
    TRANSLATION = "TRANSLATION"
    METADATA = "METADATA"
    KEYWORD_EXTRACTION = "KEYWORD_EXTRACTION"
    KEYWORD_GROUPING = "KEYWORD_GROUPING"
    TOPIC_LABELING = "TOPIC_LABELING"
    TRACK_CLASSIFICATION = "TRACK_CLASSIFICATION"
    FACET_EXTRACTION = "FACET_EXTRACTION"
    QUERY_EXPANSION = "QUERY_EXPANSION"
    CHAT_SYNTHESIS = "CHAT_SYNTHESIS"
    VISUALIZATION_PLANNING = "VISUALIZATION_PLANNING"


@dataclass(frozen=True)
class TaskProfile:
    primary: str
    fallback: Optional[str] = None
    provider_order: Tuple[str, ...] = ()
    reasoning_effort: Optional[str] = None


@dataclass(frozen=True)
class TaskRoutingConfig:
    task_name: str
    gateway: str
    base_url: str
    api_key: str
    primary_model: str
    fallback_model: Optional[str]
    provider_order: Tuple[str, ...]
    reasoning_effort: Optional[str]
    temperature: float = 0.0


MODEL_PRICE_USD_PER_1M_TOKENS: Dict[str, Dict[str, float]] = {
    "openai/gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "openai/gpt-4.1-nano": {"input": 0.10, "output": 0.40},
    "google/gemini-2.5-flash": {"input": 0.30, "output": 2.50},
    "google/gemini-2.5-flash-lite": {"input": 0.10, "output": 0.40},
}

CONSERVATIVE_PRESET: Dict[ModelTask, TaskProfile] = {
    ModelTask.DEFAULT_TEXT: TaskProfile(primary="openai/gpt-4.1-mini", fallback="google/gemini-2.5-flash"),
    ModelTask.VISION_OCR: TaskProfile(primary="openai/gpt-4.1-mini", fallback="google/gemini-2.5-flash"),
    ModelTask.SEGMENTATION: TaskProfile(primary="openai/gpt-4.1-mini", fallback="google/gemini-2.5-flash"),
    ModelTask.TRANSLATION: TaskProfile(primary="openai/gpt-4.1-mini", fallback="google/gemini-2.5-flash"),
    ModelTask.METADATA: TaskProfile(primary="google/gemini-2.5-flash-lite", fallback="openai/gpt-4.1-nano"),
    ModelTask.KEYWORD_EXTRACTION: TaskProfile(primary="openai/gpt-4.1-mini", fallback="google/gemini-2.5-flash"),
    ModelTask.KEYWORD_GROUPING: TaskProfile(primary="openai/gpt-4.1-mini", fallback="google/gemini-2.5-flash"),
    ModelTask.TOPIC_LABELING: TaskProfile(primary="openai/gpt-4.1-mini", fallback="google/gemini-2.5-flash"),
    ModelTask.TRACK_CLASSIFICATION: TaskProfile(primary="google/gemini-2.5-flash-lite", fallback="openai/gpt-4.1-nano"),
    ModelTask.FACET_EXTRACTION: TaskProfile(primary="openai/gpt-4.1-mini", fallback="google/gemini-2.5-flash-lite"),
    ModelTask.QUERY_EXPANSION: TaskProfile(primary="google/gemini-2.5-flash-lite", fallback="openai/gpt-4.1-nano"),
    ModelTask.CHAT_SYNTHESIS: TaskProfile(primary="google/gemini-2.5-flash", fallback="openai/gpt-4.1-mini"),
    ModelTask.VISUALIZATION_PLANNING: TaskProfile(primary="google/gemini-2.5-flash", fallback="openai/gpt-4.1-mini"),
}

AGGRESSIVE_COST_PRESET: Dict[ModelTask, TaskProfile] = {
    **CONSERVATIVE_PRESET,
    ModelTask.FACET_EXTRACTION: TaskProfile(primary="google/gemini-2.5-flash-lite", fallback="openai/gpt-4.1-mini"),
    ModelTask.KEYWORD_GROUPING: TaskProfile(primary="google/gemini-2.5-flash-lite", fallback="openai/gpt-4.1-mini"),
    ModelTask.TOPIC_LABELING: TaskProfile(primary="google/gemini-2.5-flash-lite", fallback="openai/gpt-4.1-mini"),
}

QUALITY_FIRST_PRESET: Dict[ModelTask, TaskProfile] = {
    **CONSERVATIVE_PRESET,
    ModelTask.SEGMENTATION: TaskProfile(
        primary="openai/gpt-4.1-mini",
        fallback="google/gemini-2.5-flash",
        reasoning_effort="medium",
    ),
    ModelTask.CHAT_SYNTHESIS: TaskProfile(
        primary="openai/gpt-4.1-mini",
        fallback="google/gemini-2.5-flash",
        reasoning_effort="medium",
    ),
}

PRESETS: Dict[str, Dict[ModelTask, TaskProfile]] = {
    "conservative": CONSERVATIVE_PRESET,
    "aggressive-cost": AGGRESSIVE_COST_PRESET,
    "quality-first": QUALITY_FIRST_PRESET,
}

_SESSION_LABEL = contextvars.ContextVar("papertrend_model_router_label", default="")
_USAGE_EVENTS = contextvars.ContextVar("papertrend_model_router_usage", default=None)


def _normalize_task_name(task: str | ModelTask) -> str:
    return task.value if isinstance(task, ModelTask) else str(task).strip().upper()


def _task_from_name(task: str | ModelTask) -> ModelTask:
    return ModelTask(_normalize_task_name(task))


def _resolve_base_url(api_key: str) -> str:
    configured = (os.getenv("OPENAI_BASE_URL") or "").strip()
    if configured:
        return configured.rstrip("/")
    if api_key.startswith("sk-or-") or os.getenv("MODEL_GATEWAY", "").strip().lower() == "openrouter":
        return "https://openrouter.ai/api/v1"
    return "https://api.openai.com/v1"


def _current_preset_name() -> str:
    preset = (os.getenv("MODEL_POLICY_PRESET") or "conservative").strip().lower()
    return preset if preset in PRESETS else "conservative"


def _parse_csv_env(name: str) -> Tuple[str, ...]:
    value = (os.getenv(name) or "").strip()
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


def _resolve_profile(task: ModelTask) -> TaskProfile:
    profile = PRESETS[_current_preset_name()].get(task) or CONSERVATIVE_PRESET[ModelTask.DEFAULT_TEXT]
    env_key = task.value
    primary = (os.getenv(f"MODEL_TASK_{env_key}") or profile.primary).strip()
    fallback = (os.getenv(f"MODEL_TASK_{env_key}_FALLBACK") or (profile.fallback or "")).strip() or None
    provider_order = _parse_csv_env(f"MODEL_TASK_{env_key}_PROVIDER_ORDER") or profile.provider_order
    reasoning_effort = (
        (os.getenv(f"MODEL_TASK_{env_key}_REASONING_EFFORT") or (profile.reasoning_effort or "")).strip() or None
    )
    return TaskProfile(
        primary=primary,
        fallback=fallback,
        provider_order=tuple(provider_order),
        reasoning_effort=reasoning_effort,
    )


def get_task_config(task: str | ModelTask) -> TaskRoutingConfig:
    normalized_task = _task_from_name(task)
    api_key = os.getenv("OPENAI_API_KEY", "")
    base_url = _resolve_base_url(api_key)
    gateway = (os.getenv("MODEL_GATEWAY") or "openrouter").strip().lower()
    profile = _resolve_profile(normalized_task)
    return TaskRoutingConfig(
        task_name=normalized_task.value,
        gateway=gateway,
        base_url=base_url,
        api_key=api_key,
        primary_model=profile.primary,
        fallback_model=profile.fallback,
        provider_order=tuple(profile.provider_order),
        reasoning_effort=profile.reasoning_effort,
    )


def _build_extra_body(config: TaskRoutingConfig) -> Dict[str, Any]:
    extra_body: Dict[str, Any] = {}
    if config.provider_order:
        extra_body["provider"] = {
            "order": list(config.provider_order),
            "allow_fallbacks": True,
        }
    return extra_body


def _create_chat_openai(model_name: str, config: TaskRoutingConfig, **overrides: Any) -> ChatOpenAI:
    extra_body = dict(_build_extra_body(config))
    extra_body_override = overrides.pop("extra_body", None)
    if isinstance(extra_body_override, Mapping):
        extra_body.update(extra_body_override)
    init_kwargs = {
        "model": model_name,
        "temperature": overrides.pop("temperature", config.temperature),
        "api_key": config.api_key,
        "base_url": config.base_url,
        "reasoning_effort": overrides.pop("reasoning_effort", config.reasoning_effort),
        "extra_body": extra_body or None,
        "max_completion_tokens": overrides.pop("max_completion_tokens", None),
        "stream_usage": overrides.pop("stream_usage", True),
        **overrides,
    }
    return ChatOpenAI(**{key: value for key, value in init_kwargs.items() if value is not None})


def _response_usage_payload(payload: Any) -> Tuple[Optional[int], Optional[int]]:
    usage = getattr(payload, "usage_metadata", None)
    if isinstance(usage, Mapping):
        prompt_tokens = usage.get("input_tokens") or usage.get("prompt_tokens")
        completion_tokens = usage.get("output_tokens") or usage.get("completion_tokens")
        return _to_int(prompt_tokens), _to_int(completion_tokens)

    response_metadata = getattr(payload, "response_metadata", None)
    if isinstance(response_metadata, Mapping):
        token_usage = response_metadata.get("token_usage")
        if isinstance(token_usage, Mapping):
            return _to_int(token_usage.get("prompt_tokens")), _to_int(token_usage.get("completion_tokens"))

    if isinstance(payload, Mapping) and "raw" in payload:
        return _response_usage_payload(payload.get("raw"))

    return None, None


def _to_int(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except Exception:
        return None


def _estimate_cost_usd(model_name: str, prompt_tokens: Optional[int], completion_tokens: Optional[int]) -> Optional[float]:
    pricing = MODEL_PRICE_USD_PER_1M_TOKENS.get(model_name)
    if not pricing or prompt_tokens is None or completion_tokens is None:
        return None
    return round(
        (prompt_tokens / 1_000_000.0) * pricing["input"]
        + (completion_tokens / 1_000_000.0) * pricing["output"],
        8,
    )


def start_usage_session(label: str = "") -> None:
    _SESSION_LABEL.set(label)
    _USAGE_EVENTS.set([])


def _append_usage_event(event: Dict[str, Any]) -> None:
    current = _USAGE_EVENTS.get()
    if current is None:
        return
    current.append(event)
    _USAGE_EVENTS.set(current)


def consume_usage_summary() -> Dict[str, Any]:
    events = list(_USAGE_EVENTS.get() or [])
    _USAGE_EVENTS.set([])
    total_prompt_tokens = sum(event.get("prompt_tokens") or 0 for event in events)
    total_completion_tokens = sum(event.get("completion_tokens") or 0 for event in events)
    total_cost = round(sum(event.get("estimated_cost_usd") or 0.0 for event in events), 8)
    return {
        "label": _SESSION_LABEL.get(),
        "call_count": len(events),
        "total_prompt_tokens": total_prompt_tokens,
        "total_completion_tokens": total_completion_tokens,
        "estimated_cost_usd": total_cost,
        "events": events,
    }


class RoutedRunnable:
    def __init__(
        self,
        parent: "RoutedChatModel",
        builder: Callable[[ChatOpenAI], Any],
        operation: str,
        postprocess: Optional[Callable[[Any], Any]] = None,
    ) -> None:
        self._parent = parent
        self._builder = builder
        self._operation = operation
        self._postprocess = postprocess

    def invoke(self, *args: Any, **kwargs: Any) -> Any:
        result = self._parent._invoke_with_builder(self._builder, self._operation, *args, **kwargs)
        if self._postprocess is not None:
            return self._postprocess(result)
        return result


class RoutedChatModel:
    def __init__(self, task: str | ModelTask, **overrides: Any) -> None:
        self.config = get_task_config(task)
        self._overrides = dict(overrides)

    @property
    def model_name(self) -> str:
        return self.config.primary_model

    def with_overrides(self, **overrides: Any) -> "RoutedChatModel":
        merged = {**self._overrides, **overrides}
        return RoutedChatModel(self.config.task_name, **merged)

    def invoke(self, *args: Any, **kwargs: Any) -> Any:
        return self._invoke_with_builder(lambda client: client, "invoke", *args, **kwargs)

    def with_structured_output(self, *args: Any, **kwargs: Any) -> RoutedRunnable:
        builder_kwargs = dict(kwargs)
        requested_include_raw = bool(builder_kwargs.get("include_raw"))
        builder_kwargs["include_raw"] = True

        def builder(client: ChatOpenAI) -> Any:
            return client.with_structured_output(*args, **builder_kwargs)

        def postprocess(result: Any) -> Any:
            if requested_include_raw:
                return result
            if isinstance(result, Mapping) and "parsed" in result:
                return result["parsed"]
            return result

        return RoutedRunnable(self, builder, "structured_output", postprocess=postprocess)

    def bind_tools(self, *args: Any, **kwargs: Any) -> RoutedRunnable:
        return RoutedRunnable(self, lambda client: client.bind_tools(*args, **kwargs), "bind_tools")

    def _invoke_with_builder(
        self,
        builder: Callable[[ChatOpenAI], Any],
        operation: str,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        attempts = [self.config.primary_model]
        if self.config.fallback_model and self.config.fallback_model not in attempts:
            attempts.append(self.config.fallback_model)

        last_error: Optional[Exception] = None
        for index, model_name in enumerate(attempts):
            started = time.perf_counter()
            fallback_used = index > 0
            try:
                client = _create_chat_openai(model_name, self.config, **self._overrides)
                runnable = builder(client)
                result = runnable.invoke(*args, **kwargs)
                prompt_tokens, completion_tokens = _response_usage_payload(result)
                estimated_cost = _estimate_cost_usd(model_name, prompt_tokens, completion_tokens)
                latency_ms = round((time.perf_counter() - started) * 1000, 2)
                event = {
                    "task_name": self.config.task_name,
                    "operation": operation,
                    "model_name": model_name,
                    "provider_order": list(self.config.provider_order),
                    "fallback_used": fallback_used,
                    "latency_ms": latency_ms,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "estimated_cost_usd": estimated_cost,
                }
                _append_usage_event(event)
                logger.info("model_call %s", event)
                return result
            except Exception as error:
                last_error = error
                logger.warning(
                    "model_call_failed task=%s model=%s fallback_used=%s error=%s",
                    self.config.task_name,
                    model_name,
                    fallback_used,
                    error,
                )
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"No model attempt was made for task {self.config.task_name}.")


@lru_cache(maxsize=None)
def _get_cached_task_llm(task_name: str) -> RoutedChatModel:
    return RoutedChatModel(task_name)


def get_task_llm(task: str | ModelTask, **overrides: Any) -> RoutedChatModel:
    task_name = _normalize_task_name(task)
    if overrides:
        return RoutedChatModel(task_name, **overrides)
    return _get_cached_task_llm(task_name)


def clear_model_router_caches() -> None:
    _get_cached_task_llm.cache_clear()


def model_routing_snapshot() -> Dict[str, Dict[str, Any]]:
    snapshot: Dict[str, Dict[str, Any]] = {}
    for task in ModelTask:
        config = get_task_config(task)
        snapshot[task.value] = {
            "primary_model": config.primary_model,
            "fallback_model": config.fallback_model,
            "provider_order": list(config.provider_order),
            "reasoning_effort": config.reasoning_effort,
            "gateway": config.gateway,
            "base_url": config.base_url,
        }
    return snapshot
