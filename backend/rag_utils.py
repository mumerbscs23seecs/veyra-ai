import threading

_embedding_model = None
_model_lock = threading.Lock()


def _get_model():
    global _embedding_model
    if _embedding_model is None:
        with _model_lock:
            if _embedding_model is None:
                from fastembed import TextEmbedding
                _embedding_model = TextEmbedding("BAAI/bge-small-en-v1.5")
    return _embedding_model


def _embed(model, texts: list[str]):
    import numpy as np
    return np.array(list(model.embed(texts))).astype("float32")


def extract_pdf_text(file_path: str) -> str:
    from pypdf import PdfReader
    reader = PdfReader(file_path)
    parts = []
    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text()
        if text:
            parts.append(f"\n--- Page {page_num} ---\n{text}")
    return "\n".join(parts).strip()


def chunk_text(text: str, chunk_size: int = 900, overlap: int = 150) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        chunk = text[start : start + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def build_faiss_index(file_path: str) -> dict | None:
    """Build a FAISS index from a PDF. Returns {'index', 'chunks'} or None if no text."""
    import faiss
    text = extract_pdf_text(file_path)
    if not text:
        return None
    chunks = chunk_text(text)
    embeddings = _embed(_get_model(), chunks)
    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(embeddings)
    return {"index": index, "chunks": chunks}


def search_faiss_index(col: dict, query: str, top_k: int = 5) -> list[str]:
    """Search a FAISS collection dict, returns list of matching text chunks."""
    query_vec = _embed(_get_model(), [query])
    _, ids = col["index"].search(query_vec, top_k)
    return [col["chunks"][i] for i in ids[0] if i != -1]
