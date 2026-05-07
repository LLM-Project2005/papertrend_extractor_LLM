import json
import pathlib
import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from langchain_openai import ChatOpenAI 
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from sklearn.metrics import davies_bouldin_score

# 1. Load Environment Variables
load_dotenv()

# 2. Setup Models (L12 for better multilingual handling in Thai contexts)
embed_model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

# Configure for OpenRouter Evaluation
evaluator_llm = ChatOpenAI(
    model="google/gemini-2.0-flash-001",
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url="https://openrouter.ai/api/v1",
    temperature=0
)

def get_fidelity_score(paper_title, topics_data):
    """
    LLM-as-a-Judge: assess keyword quality based on semantic relevance 
    and technical density.
    """
    all_keywords = []
    for t in topics_data:
        all_keywords.extend(t.get("original_keywords", []))
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a Scientometrician. Evaluate the 'Fidelity Score' (0.0-1.0) 
        of extracted keywords. Consider:
        - Technical Density (specific terminology vs generic words)
        - Semantic Relevance (match to paper title)
        - Context Fidelity (acronyms and nuances)
        Output ONLY JSON: {{"fidelity_score": float}}"""),
        ("human", "Title: {title}\nKeywords: {keywords}")
    ])
    
    chain = prompt | evaluator_llm | JsonOutputParser()
    try:
        res = chain.invoke({"title": paper_title, "keywords": ", ".join(all_keywords[:30])})
        return round(float(res.get("fidelity_score", 0.0)), 3)
    except:
        return 0.0
     
def calculate_normalized_dbi(topics_data):
    """
    Calculates the Inverted & Normalized Davies-Bouldin Index.
    1 / (1 + DBI). Higher is better (0.0 to 1.0).
    """
    embeddings = []
    labels = []
    
    for i, topic in enumerate(topics_data):
        kws = topic.get("original_keywords", [])
        if kws:
            kw_embs = embed_model.encode(kws)
            embeddings.extend(kw_embs)
            labels.extend([i] * len(kws))
    
    if len(set(labels)) < 2: return 0.0
        
    try:
        dbi = davies_bouldin_score(embeddings, labels)
        normalized_score = 1 / (1 + dbi)
        return round(normalized_score, 3)
    except:
        return 0.0

def calculate_lsi_score(topics_data):
    """
    Calculates LSI Score: ensures the generated label sits at the 
    mathematical center (centroid) of its keywords.
    """
    scores = []
    for topic in topics_data:
        label = topic.get("label", "")
        kws = topic.get("original_keywords", [])
        if not kws or not label: continue
        
        label_emb = embed_model.encode([label])[0]
        kw_embs = embed_model.encode(kws)
        centroid = np.mean(kw_embs, axis=0)
        
        # Cosine Similarity
        sim = np.dot(label_emb, centroid) / (np.linalg.norm(label_emb) * np.linalg.norm(centroid))
        scores.append(sim)
    
    return round(float(np.mean(scores)), 3) if scores else 0.0

def run_evaluation_suite():
    # Step A: Paths
    output_dir = pathlib.Path("data/output")
    eval_dir = pathlib.Path("data/eval_output")
    eval_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    
    # Check if output directory exists
    if not output_dir.exists():
        print(f"❌ Error: {output_dir} not found. Please run your pipeline first.")
        return

    # Step B: Loop through all existing JSON results
    print(f"🔍 Scanning {output_dir} for results...")
    for json_file in output_dir.rglob("*.json"):
        try:
            data = json.loads(json_file.read_text(encoding='utf-8'))
            title = data.get("paper_metadata", {}).get("title", json_file.stem)
            topics = data.get("final_labeled_topics", [])
            
            if not topics:
                print(f"⚠️ Skipping {json_file.name}: No topics found.")
                continue

            print(f"📝 Evaluating: {title[:50]}...")
            
            rows.append({
                "Paper Name": title,
                "Keyword Fidelity (LLM)": get_fidelity_score(title, topics),
                "Grouper DBI (Normalized)": calculate_normalized_dbi(topics),
                "Labeller LSI Score": calculate_lsi_score(topics)
            })
        except Exception as e:
            print(f"❌ Error processing {json_file.name}: {e}")

    if not rows:
        print("❌ No valid results to evaluate.")
        return

    # Step C: Finalize Data and Calculate Means
    df = pd.DataFrame(rows)
    numeric_df = df.select_dtypes(include=[np.number])
    means = numeric_df.mean().to_dict()
    means["Paper Name"] = "AVERAGE_MEAN"
    
    df = pd.concat([df, pd.DataFrame([means])], ignore_index=True)

    # Step D: Save to CSV
    csv_path = eval_dir / "research_eval_metrics.csv"
    df.to_csv(csv_path, index=False)
    print(f"\n✅ Success! Evaluation CSV saved to: {csv_path}")
    print(df.tail(1)) # Display the mean row

if __name__ == "__main__":
    run_evaluation_suite()