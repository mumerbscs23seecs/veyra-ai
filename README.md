# AI Agent Chatbot

A full-stack AI chatbot that uses **Groq (Llama 3.1)** as the language model and **MCP (Model Context Protocol)** tools to answer real-world questions like weather and math — not just from training data.

## What makes this an "agent"?

A normal chatbot answers purely from its training data. This one can **use tools**:

- Ask *"What is the weather in Lahore?"* → it calls a live weather API
- Ask *"What is 144 / 12?"* → it uses a calculator tool
- Ask *"Hello, how are you?"* → it answers directly from Groq

When a tool is used, a **⚙️ badge** appears on the reply in the chat UI.

---

## Project Structure

```
ai-agent-chatbot/
├── backend/          Express API — connects Groq AI + MCP client
├── frontend/         Next.js chat UI
└── mcp-server/       MCP server with calculator and weather tools
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React, Tailwind CSS |
| Backend | Node.js, Express |
| AI Model | Groq API (llama-3.1-8b-instant) |
| Tool Protocol | Model Context Protocol (MCP) SDK |
| Weather API | wttr.in (free, no key needed) |
| Math | mathjs |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A free [Groq API key](https://console.groq.com/)

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd ai-agent-chatbot
```

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```ini
PORT=5000
GROQ_API_KEY=your_groq_api_key_here
```

### 3. Install dependencies

```bash
# Backend
cd backend && npm install

# MCP Server
cd ../mcp-server && npm install

# Frontend
cd ../frontend && npm install
```

### 4. Run everything

Open **3 separate terminals**:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
```
You should see:
```
✅ MCP server connected. Tools available: calculator, get_weather
🚀 Backend running on http://localhost:5000
```

**Terminal 2 — MCP Server** (optional — backend auto-spawns it, but you can run separately for Inspector):
```bash
cd mcp-server
npm run dev
```

**Terminal 3 — Frontend:**
```bash
cd frontend
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## Available MCP Tools

| Tool | Description | Example |
|---|---|---|
| `calculator` | Evaluates math expressions | *"What is 25 * 8?"* |
| `get_weather` | Gets current weather for any city | *"What's the weather in London?"* |

### Testing tools with MCP Inspector

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node index.js
```

Opens a browser UI to test tools directly.

---

## Features

- 💬 Real-time chat with Groq Llama 3.1
- 🔧 MCP tool calling (weather + calculator)
- ⚙️ Tool usage badge on replies
- 💾 Chat history saved in localStorage
- 🗑️ Clear chat button
- 📜 Auto-scroll to latest message
- ⌨️ Enter to send, Shift+Enter for new line
- 🟢 Live status indicator

---

## How Tool Calling Works

```
User message
  → Groq receives message + tool definitions
  → If Groq decides to use a tool:
       → Backend calls MCP server tool
       → MCP server returns result
       → Result is sent back to Groq
       → Groq generates final human-readable reply
  → If no tool needed:
       → Groq replies directly
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | ✅ | Your Groq API key |
| `PORT` | ❌ | Backend port (default: 5000) |
| `USE_MOCK` | ❌ | Set to `true` to skip Groq API calls (dev/testing) |
