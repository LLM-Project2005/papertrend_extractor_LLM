import os
from langchain_openai import ChatOpenAI
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

# 0. Load the key BEFORE initializing LLMs
load_dotenv()

# 1. Initialize LLMs with OpenRouter Configuration
# If base_url is not set, it defaults to OpenAI and rejects sk-or keys.
llm_main = ChatOpenAI(
    model="openai/gpt-4o", 
    temperature=0,
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    base_url="https://openrouter.ai/api/v1"
)

llm_fast = ChatOpenAI(
    model="openai/gpt-4o-mini", 
    temperature=0,
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    base_url="https://openrouter.ai/api/v1"
)

# 2. Initialize the Embedding Model
print("Loading Embedding Model: paraphrase-multilingual-MiniLM-L12-v2...")
embed_model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

# 3. Export
__all__ = ["llm_main", "llm_fast", "embed_model"]