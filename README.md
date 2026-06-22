# 🤖 Veyra AI

> A full-stack AI agent chatbot powered by **Cerebras** (120B parameter model) with real-time tools, PDF analysis, authentication, and persistent chat history.

---

## 🔗 Live Links

| Service | URL |
|---|---|
| 🌐 **Frontend (Vercel)** | https://veyra-nm65itgrd-mumerbscs23seecs-projects.vercel.app |
| ⚙️ **Backend API (Render)** | https://veyra-ai.onrender.com |
| 📦 **GitHub** | https://github.com/mumerbscs23seecs/veyra-ai |

---

## ⚠️ IMPORTANT — First Load Warning

> **The backend is hosted on Render's free tier.**
> When the app hasn't been used for a while, Render **spins down the server**.
> The **first request after inactivity can take 1–2 minutes** to respond while Render wakes the server back up and reconnects to the database.
>
> ✅ **This is normal. Just wait ~60 seconds and try again.**
> After the first successful response, everything runs at full speed.

---

## ✨ Features

- 🔐 **Auth** — Register & login with JWT authentication
- 💬 **AI Chat** — Powered by `gpt-oss-120b` on Cerebras (extremely fast inference)
- 🔧 **6 AI Tools** — The AI automatically picks and uses the right tool
- 📄 **PDF Analysis** — Upload any PDF and ask questions about it
- 🕓 **Chat History** — All conversations saved to PostgreSQL, grouped by Today / Yesterday / Earlier
- 📱 **Mobile Responsive** — Works on phones with a slide-in sidebar

---

## 🛠️ AI Tools Available

| Tool | What it does |
|---|---|
| 🔍 **Web Search** | Searches the internet for latest information |
| 🌦️ **Live Weather** | Gets real-time weather for any city |
| 🧮 **Calculator** | Solves complex math expressions |
| 🌐 **Read Webpage** | Fetches and reads content from any URL |
| 📄 **Index PDF** | Indexes an uploaded PDF for semantic search |
| 🔎 **Search PDF** | Answers questions from an indexed PDF |

---

## 🏗️ Architecture

```
Browser (Next.js)
      │
      ▼
FastAPI Backend (Render)
      │
      ├──▶ Cerebras AI (LLM — gpt-oss-120b)
      ├──▶ MCP Tools Subprocess (calculator, weather, search, PDF)
      └──▶ PostgreSQL Database (Render)
```

---

## 📁 Project Structure

```
veyra-ai/
├── frontend/               Next.js app (deployed on Vercel)
│   ├── app/
│   │   ├── page.js         Main chat UI
│   │   ├── login/          Login page
│   │   ├── register/       Register page
│   │   ├── layout.js       Root layout + viewport config
│   │   └── globals.css     Full design system
│
└── backend/                FastAPI app (deployed on Render)
    ├── server.py           All API routes (auth, chat, sessions, PDF)
    ├── mcp_tools.py        MCP tool definitions (6 tools)
    ├── rag_utils.py        Shared PDF/RAG utilities (FAISS, embeddings)
    ├── auth.py             JWT + bcrypt authentication
    ├── database.py         Async SQLAlchemy + PostgreSQL
    ├── models.py           ORM models (User, ChatSession, ChatMessage)
    └── requirements.txt    Python dependencies
```

---

## 💻 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15, React, Tailwind CSS |
| **Backend** | FastAPI, Python 3.11 |
| **AI Model** | Cerebras API (`gpt-oss-120b`) via LangChain |
| **Tools** | MCP (Model Context Protocol) — stdio transport |
| **PDF RAG** | FAISS vector search + fastembed (`BAAI/bge-small-en-v1.5`) |
| **Database** | PostgreSQL + SQLAlchemy (async) + asyncpg |
| **Auth** | JWT (`python-jose`) + bcrypt |
| **Frontend Deploy** | Vercel |
| **Backend Deploy** | Render |

---

## 🚀 Run Locally

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL running locally

### 1. Clone the repo

```bash
git clone https://github.com/mumerbscs23seecs/veyra-ai.git
cd veyra-ai
```

### 2. Backend setup

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```ini
PORT=8000
CEREBRAS_API_KEY=your_cerebras_api_key_here
DATABASE_URL=postgresql+asyncpg://postgres:yourpassword@localhost:5432/chatbot_db
JWT_SECRET=your-strong-random-secret
JWT_EXPIRE_MINUTES=10080
```

Install dependencies and run:
```bash
pip install -r requirements.txt
python server.py
```

### 3. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**

---

## 🗄️ Database Schema

| Table | Columns |
|---|---|
| `users` | id, email, username, hashed_password, created_at |
| `chat_sessions` | id, user_id, title, created_at |
| `chat_messages` | id, session_id, role, content, tool_used, created_at |

Tables are created automatically on first backend startup.

---

## 🔑 Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `CEREBRAS_API_KEY` | ✅ | Your Cerebras API key |
| `DATABASE_URL` | ✅ | PostgreSQL connection string (asyncpg) |
| `JWT_SECRET` | ✅ | Secret key for signing JWT tokens |
| `JWT_EXPIRE_MINUTES` | ❌ | Token expiry in minutes (default: 10080 = 7 days) |
| `PORT` | ❌ | Backend port (default: 8000) |

### Frontend

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ | URL of the deployed backend |

---

## 👤 Author

**Umer** — [@mumerbscs23seecs](https://github.com/mumerbscs23seecs)
