import asyncio
import os
import re
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from langchain_openai import ChatOpenAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage

import uuid
from pathlib import Path
from fastapi import UploadFile, File, Form

from rag_utils import _get_model, build_faiss_index, search_faiss_index
from database import get_db, engine
from models import Base, User, ChatSession, ChatMessage
from auth import hash_password, verify_password, create_token, get_current_user

load_dotenv()

CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY")
if not CEREBRAS_API_KEY:
    raise RuntimeError("CEREBRAS_API_KEY is missing in .env")

PORT = int(os.getenv("PORT", 8000))
MODEL = "gpt-oss-120b"
CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
MAX_STEPS = 8

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

pdf_collections: dict = {}

SYSTEM_PROMPT = """You are a helpful, friendly AI assistant.

You have access to MCP tools including:
1. index_pdf — index an uploaded PDF for RAG; returns a collection_id
2. search_pdf — search the indexed PDF for relevant information using the collection_id
3. calculator — for math operations
4. get_weather — for live weather
5. web_search — for latest/current information from the internet
6. read_webpage — for reading a URL

RAG RULES:
- If the user uploads a PDF, first call index_pdf with the file path to get a collection_id.
- Then call search_pdf with the collection_id and the user's question.
- Answer using only the relevant chunks returned by search_pdf.
- If the PDF does not contain the answer, say you could not find it in the PDF.
- Do not pretend the PDF says something if it was not in the returned chunks.

GENERAL RULES:
- When the user gives a URL, try read_webpage first. If the result starts with "FETCH_BLOCKED", call web_search instead. Do NOT retry read_webpage on the same URL.
- After web_search returns results, write your final answer IMMEDIATELY — do not call read_webpage on search result URLs.
- After read_webpage returns real content, write your final answer immediately. Do not call more tools.
- Never do math yourself — use calculator.
- Do not output raw JSON or tool call arguments.
- Keep your response conversational and helpful."""

# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── LangChain model ────────────────────────────────────────────────────────────
llm = ChatOpenAI(
    model=MODEL,
    api_key=CEREBRAS_API_KEY,
    temperature=0.7,
    max_tokens=1024,
    base_url=CEREBRAS_BASE_URL,
)

tools_by_name = {}
llm_with_tools = None


@app.on_event("startup")
async def startup_event():
    global tools_by_name, llm_with_tools

    # Create DB tables and apply any new columns
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR"))
    print("[DB] Tables created / verified")

    mcp_client = MultiServerMCPClient({
        "rag_tools": {
            "transport": "stdio",
            "command": "python",
            "args": ["mcp_tools.py"],
        }
    })

    tools = await mcp_client.get_tools()
    tools_by_name = {tool.name: tool for tool in tools}
    llm_with_tools = llm.bind_tools(tools)

    print("[AI] MCP tools loaded:")
    for tool in tools:
        print("-", tool.name)

    async def _preload_model():
        try:
            await asyncio.to_thread(_get_model)
            print("[AI] Embedding model ready")
        except Exception as e:
            print(f"[AI] Embedding model not preloaded: {e}")

    asyncio.create_task(_preload_model())


# ── Auth schemas ───────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: str
    password: str
    username: str


class LoginRequest(BaseModel):
    email: str
    password: str


# ── Auth routes ────────────────────────────────────────────────────────────────
@app.get("/")
def health():
    return {"success": True, "message": "AI Agent Backend — Cerebras + LangChain (Python)"}


@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if not req.email or "@" not in req.email:
        raise HTTPException(status_code=400, detail="Valid email is required")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    result = await db.execute(select(User).where(User.email == req.email.lower()))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(email=req.email.lower(), username=req.username.strip(), hashed_password=hash_password(req.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_token(user.id, user.email)
    return {"token": token, "user": {"id": user.id, "email": user.email, "username": user.username}}


@app.post("/auth/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email.lower()))
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_token(user.id, user.email)
    return {"token": token, "user": {"id": user.id, "email": user.email, "username": user.username}}


@app.get("/auth/me")
async def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email, "username": current_user.username}


# ── Session routes ─────────────────────────────────────────────────────────────
@app.get("/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.created_at.desc())
        .limit(30)
    )
    sessions = result.scalars().all()
    return [
        {"id": s.id, "title": s.title, "created_at": s.created_at.isoformat()}
        for s in sessions
    ]


@app.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    msgs_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    messages = msgs_result.scalars().all()
    return [
        {
            "role": m.role,
            "content": m.content,
            "toolUsed": m.tool_used.split(",") if m.tool_used else [],
        }
        for m in messages
    ]


@app.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()
    return {"success": True}


# ── Chat schemas ───────────────────────────────────────────────────────────────
class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[Message] = []
    session_id: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────
def build_messages(history: list[Message], user_message: str) -> list:
    msgs = [SystemMessage(content=SYSTEM_PROMPT)]
    for m in history:
        if m.role == "user":
            msgs.append(HumanMessage(content=m.content))
        elif m.role == "assistant":
            msgs.append(AIMessage(content=m.content))
    msgs.append(HumanMessage(content=user_message))
    return msgs


def clean_reply(text: str) -> str:
    return re.sub(r"^\{.*?\}\s*", "", text or "", flags=re.DOTALL).strip()



# ── Chat route ─────────────────────────────────────────────────────────────────
@app.post("/chat")
async def chat(
    req: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")
    if llm_with_tools is None:
        raise HTTPException(status_code=500, detail="MCP tools are not loaded yet")

    # Get or create session
    session = None
    if req.session_id:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == req.session_id,
                ChatSession.user_id == current_user.id,
            )
        )
        session = result.scalar_one_or_none()

    if not session:
        title = req.message[:60] + ("…" if len(req.message) > 60 else "")
        session = ChatSession(user_id=current_user.id, title=title)
        db.add(session)
        await db.commit()
        await db.refresh(session)

    # Save user message
    db.add(ChatMessage(session_id=session.id, role="user", content=req.message))
    await db.commit()

    messages = build_messages(req.history, req.message)
    tools_used = []

    for _ in range(MAX_STEPS):
        ai_message = await llm_with_tools.ainvoke(messages)
        messages.append(ai_message)

        tool_calls = getattr(ai_message, "tool_calls", []) or []

        if not tool_calls:
            reply = clean_reply(
                ai_message.content if isinstance(ai_message.content, str)
                else " ".join(ai_message.content)
            )
            reply = reply or "I could not generate a response."
            db.add(ChatMessage(
                session_id=session.id, role="assistant", content=reply,
                tool_used=",".join(tools_used) if tools_used else None,
            ))
            await db.commit()
            return {"reply": reply, "toolUsed": tools_used, "session_id": session.id}

        for tc in tool_calls:
            selected = tools_by_name.get(tc["name"])
            result_val = (
                await selected.ainvoke(tc["args"])
                if selected else f"Unknown tool: {tc['name']}"
            )
            messages.append(ToolMessage(tool_call_id=tc["id"], content=str(result_val)))
            if selected and tc["name"] not in tools_used:
                tools_used.append(tc["name"])

    messages.append(HumanMessage(content="Based on all the information gathered above, write your final answer now. Do not call any more tools."))
    final = await llm.ainvoke(messages)
    reply = clean_reply(
        final.content if isinstance(final.content, str) else " ".join(final.content)
    )
    reply = reply or "I couldn't find enough information to answer. Try asking me to web search the topic."
    db.add(ChatMessage(
        session_id=session.id, role="assistant", content=reply,
        tool_used=",".join(tools_used) if tools_used else None,
    ))
    await db.commit()
    return {"reply": reply, "toolUsed": tools_used, "session_id": session.id}


# ── PDF routes ─────────────────────────────────────────────────────────────────
@app.post("/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    contents = await file.read()
    if not contents.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="File is not a valid PDF.")

    file_path = UPLOAD_DIR / f"{uuid.uuid4()}.pdf"
    file_path.write_bytes(contents)

    try:
        data = await asyncio.to_thread(build_faiss_index, str(file_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF indexing error: {e}")

    if data is None:
        raise HTTPException(status_code=422, detail="Could not extract text from the PDF — it may be scanned/image-only.")

    collection_id = str(uuid.uuid4())
    pdf_collections[collection_id] = {**data, "file_name": file.filename}

    return {"collection_id": collection_id, "fileName": file.filename, "chunks": len(data["chunks"])}


@app.post("/chat-with-pdf")
async def chat_with_pdf(
    message: str = Form(...),
    collection_id: str = Form(...),
    current_user: User = Depends(get_current_user),
):
    if not message.strip():
        raise HTTPException(status_code=400, detail="Message is required")

    col = pdf_collections.get(collection_id)
    if col is None:
        raise HTTPException(status_code=404, detail="PDF session expired. Please re-upload the PDF.")

    try:
        top_chunks = await asyncio.to_thread(search_faiss_index, col, message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF search error: {e}")

    if not top_chunks:
        return {
            "reply": "I couldn't find relevant content in the PDF for that question.",
            "toolUsed": ["search_pdf"],
            "fileName": col["file_name"],
        }

    context = "\n\n---\n\n".join(top_chunks)
    prompt = (
        f"The user uploaded a PDF and asked: {message}\n\n"
        f"Here are the most relevant excerpts from the PDF:\n\n"
        f"{context}\n\n"
        f"Answer the question using only the information from these excerpts. "
        f"If the answer isn't in the excerpts, say so."
    )

    response = await llm.ainvoke([
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=prompt),
    ])
    reply = clean_reply(
        response.content if isinstance(response.content, str)
        else " ".join(response.content)
    )
    return {
        "reply": reply or "I couldn't extract a clear answer from the PDF.",
        "toolUsed": ["search_pdf"],
        "fileName": col["file_name"],
    }


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print(f"[AI] Cerebras model: {MODEL}")
    print("[AI] Tools loaded from MCP server")
    print(f"[AI] Backend running on http://localhost:{PORT}")
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=True)
