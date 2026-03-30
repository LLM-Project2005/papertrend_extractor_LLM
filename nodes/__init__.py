from nodes.model_router import (
    ModelTask,
    RoutedChatModel,
    clear_model_router_caches,
    consume_usage_summary,
    get_task_config,
    get_task_llm,
    model_routing_snapshot,
    start_usage_session,
)

llm_main = get_task_llm(ModelTask.SEGMENTATION)
llm_fast = get_task_llm(ModelTask.DEFAULT_TEXT)


def get_llm_main() -> RoutedChatModel:
    return get_task_llm(ModelTask.SEGMENTATION)


def get_llm_fast() -> RoutedChatModel:
    return get_task_llm(ModelTask.DEFAULT_TEXT)


__all__ = [
    "ModelTask",
    "RoutedChatModel",
    "clear_model_router_caches",
    "consume_usage_summary",
    "get_llm_fast",
    "get_llm_main",
    "get_task_config",
    "get_task_llm",
    "llm_fast",
    "llm_main",
    "model_routing_snapshot",
    "start_usage_session",
]
