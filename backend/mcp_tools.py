import uuid
from urllib.parse import quote

import httpx
import sympy
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS
from mcp.server.fastmcp import FastMCP

from rag_utils import build_faiss_index, search_faiss_index

mcp = FastMCP("real-tools")

collections: dict = {}

# ── Tools ──────────────────────────────────────────────────────────────────────

@mcp.tool()
def calculator(expression: str) -> str:
    """Use this for all math calculations. Example: '2 + 2' or 'sqrt(144)'."""
    try:
        return str(sympy.sympify(expression))
    except Exception as e:
        return f"Calculator error: {e}"


@mcp.tool()
def get_weather(city: str) -> str:
    """Get live weather for a city. Example: Lahore, London, Islamabad."""
    try:
        response = httpx.get(
            f"https://wttr.in/{quote(city)}?format=3",
            timeout=8.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.text
    except Exception:
        return f"Could not fetch weather for {city}."


@mcp.tool()
def web_search(query: str, max_results: int = 5) -> str:
    """Search the web for latest/current information."""
    try:
        results = []
        with DDGS() as ddgs:
            for item in ddgs.text(query, max_results=max_results):
                results.append(
                    f"Title: {item.get('title', '')}\n"
                    f"URL: {item.get('href', '')}\n"
                    f"Summary: {item.get('body', '')}"
                )
        return "\n\n".join(results) if results else "No search results found."
    except Exception as e:
        return f"Web search error: {e}"




@mcp.tool()
def read_webpage(url: str) -> str:
    """Fetch and return the readable text content of a webpage from a URL."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; AI-Agent/1.0)"}
        response = httpx.get(url, headers=headers, timeout=10.0, follow_redirects=True)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        text = soup.get_text(separator="\n", strip=True)
        lines = [l for l in text.splitlines() if l.strip()]
        content = "\n".join(lines)

        if len(content) > 8000:
            content = content[:8000] + "\n\n[content truncated]"

        return content or "FETCH_BLOCKED: No readable content found."
    except httpx.HTTPStatusError as e:
        return f"FETCH_BLOCKED: HTTP {e.response.status_code} for {url}"
    except Exception as e:
        return f"FETCH_BLOCKED: {e}"


@mcp.tool()
def index_pdf(file_path: str) -> str:
    """
    Read a PDF from disk, chunk it, embed with fastembed, and store in a FAISS
    index for semantic search. Returns a collection_id to pass to search_pdf.
    """
    try:
        if not file_path.lower().endswith(".pdf"):
            return "Error: only PDF files are allowed."

        data = build_faiss_index(file_path)
        if data is None:
            return "Error: no readable text found in the PDF."

        collection_id = str(uuid.uuid4())
        collections[collection_id] = {**data, "file_path": file_path}

        return f"PDF indexed. collection_id: {collection_id} | chunks: {len(data['chunks'])}"

    except Exception as e:
        return f"PDF indexing error: {e}"


@mcp.tool()
def search_pdf(collection_id: str, query: str, top_k: int = 4) -> str:
    """
    Semantic search over an indexed PDF. Pass the collection_id returned by
    index_pdf and a natural-language query. Returns the top_k most relevant
    text chunks so the assistant can answer questions about the document.
    """
    try:
        if collection_id not in collections:
            return "Error: collection_id not found. Index the PDF first with index_pdf."

        results = search_faiss_index(collections[collection_id], query, top_k)
        if not results:
            return "No relevant chunks found."

        return "\n\n--- chunk ---\n\n".join(results)

    except Exception as e:
        return f"PDF search error: {e}"


if __name__ == "__main__":
    mcp.run()
