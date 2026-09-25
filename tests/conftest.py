"""Tests must never reach a paid model.

nodes/model_router.py loads the project's .env at import time, so an
unpatched model call in a test would use the real key. Point the client at a
closed local port first; an accidental call then fails at once instead of
spending money.
"""

import os

os.environ["OPENAI_API_KEY"] = "test-key-not-real"
os.environ["OPENAI_BASE_URL"] = "http://127.0.0.1:9/v1"
os.environ["MODEL_REQUEST_MAX_RETRIES"] = "0"
os.environ["MODEL_REQUEST_TIMEOUT_SECONDS"] = "2"
