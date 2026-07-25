# RAG Knowledge System Implementation Plan

**Project:** Brand & Operations Knowledge Assistant
**Status:** Planning Phase
**Last Updated:** 2026-07-01
**Scope:** Phased rollout with human escalation and brand fidelity guardrails

---

## Executive Summary

This document outlines a 4-phase implementation of a Claude-powered RAG system that ingests versioned Google Drive documents, semantically chunks them, maintains a vector index, and serves conversational queries with source citations and escalation handling.

**Key Design Principles:**
- Semantic chunking over naive splitting (preserve context boundaries)
- Human-in-the-loop escalation for low confidence and out-of-scope queries
- Source citation on every response (retrieval traceability)
- Version-aware document ingestion (track changes, prevent stale knowledge)
- n8n as the orchestration backbone (reliable scheduling, error handling)
- Security-first: API keys in environment, no hardcoding

**Critical Decision Points** (resolved):
1. ✅ **Vector store:** Supabase pgvector (cost-effective, SQL-native, scales well)
2. Chat interface: Slack bot (existing infrastructure, real-time) vs custom web UI (full control, but higher friction)
3. Chunk size & overlap: Estimated 500–1000 tokens per chunk, 20% overlap (to be validated with sample docs)
4. Confidence threshold for escalation: Proposed ≥0.7 for primary answer, <0.5 escalate to human
5. ✅ **n8n deployment:** n8n Cloud (zero ops overhead, $2–10/mo for typical usage, reliable scheduling)

---

## Architecture Overview

### System Components

```
┌─────────────────────┐
│  Google Drive Docs  │
│  (Versioned Corpus) │
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────────────────┐
│           n8n Orchestration Layer            │
│  • Doc sync & polling (hourly or webhook)    │
│  • Semantic chunking (Claude API)            │
│  • Vector indexing                           │
│  • Query routing & orchestration             │
└──────────┬───────────────────────────────────┘
           │
           ▼
 ┌──────────────────────────────────┐
 │   Supabase pgvector              │
 │   (PostgreSQL + vector ext.)     │
 │   - Vector index                 │
 │   - Metadata (doc_id, version)   │
 │   - Query audit log              │
 └──────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────┐
│     Claude API (claude-sonnet-4-6)          │
│  • Query understanding & retrieval ranking  │
│  • Answer synthesis with citations          │
│  • Confidence scoring                       │
│  • Escalation detection                     │
└──────────┬──────────────────────────────────┘
           │
     ┌─────┴──────────────────┐
     ▼                        ▼
 ┌─────────┐          ┌──────────────────┐
 │Slack Bot│          │Custom Chat UI    │
 │Interface│          │(Vue/React + API) │
 └─────────┘          └──────────────────┘
     │                        │
     └─────────┬──────────────┘
               ▼
        ┌────────────────┐
        │ Human Escalation
        │ (Slack Channel) │
        └────────────────┘
```

### Data Flow

1. **Ingestion**: Google Drive docs → n8n polls (hourly or via Drive webhook) → detect changes → fetch & version
2. **Chunking**: Raw doc text → Claude summarizes/extracts structure → semantic split (preserve context) → 500–1000 token chunks
3. **Indexing**: Chunks → Claude embeddings (or dedicated embed model) → upsert to vector store with metadata (doc_id, version, page, timestamp)
4. **Retrieval**: User query → vector search (top-k chunks) → Claude reranks by relevance & confidence
5. **Generation**: Reranked chunks + system prompt → Claude synthesizes answer with citations + confidence score
6. **Escalation**: If confidence < threshold or query is out-of-scope → route to Slack human review channel

---

## Phase Breakdown & Effort Estimates

### Phase 1: Core Pipeline (Weeks 1–3, ~35 hours)

**Objective:** Prove semantic ingestion, chunking, and retrieval work end-to-end with a small doc set.

**Deliverables:**
- n8n workflow for Google Drive polling & document versioning
- Semantic chunking logic (Claude-powered or heuristic)
- Pinecone/Supabase setup with metadata schema
- Vector indexing pipeline
- Simple CLI or webhook endpoint to test retrieval

**Tasks:**
1. Set up Supabase pgvector instance (1–2 hours)
   - Create PostgreSQL project, enable pgvector extension
   - Create table: `document_chunks` with columns (id, doc_id, chunk_idx, chunk_text, embedding, metadata, created_at, updated_at)
   - Define API keys, store in `.env`
2. Build n8n workflow: Google Drive polling (2–3 hours)
   - Authenticate to Google Drive API
   - Poll for new/modified docs (hourly schedule)
   - Track versions (last_modified timestamp, keep history)
   - Store raw doc content in a staging area (Supabase table or local cache)
3. Implement semantic chunking (5–7 hours)
   - Decide: Claude-powered semantic split vs regex/heuristic chunking
   - If Claude: call Claude to extract structure, generate summaries per section → split boundaries
   - If heuristic: sentence/paragraph aware splitting + 20% overlap
   - Output: list of (chunk_text, metadata) tuples
4. Build vector indexing n8n node (3–4 hours)
   - Embed chunks (Claude API embeddings)
   - Batch upsert to Supabase pgvector with metadata (doc_id, version, chunk_idx)
   - Handle deduplication (don't re-index unchanged docs)
   - Use Supabase REST API or pg client in n8n
5. Query retrieval endpoint (3–4 hours)
   - Receive query string via HTTP (n8n webhook or custom)
   - Embed query (Claude API) → Supabase pgvector cosine similarity search → return top-k chunks with metadata
   - Use Supabase SQL: `SELECT * FROM document_chunks ORDER BY embedding <-> query_embedding LIMIT 5`
6. Testing with sample docs (2–3 hours)
   - Load 2–3 brand/ops docs, verify chunks are sensible
   - Run test queries, inspect retrieved chunks

**Success Criteria:**
- Can ingest 5+ documents from Google Drive without errors
- Chunks are semantically coherent (inspect manually)
- Query returns relevant chunks with source citations
- No hardcoded secrets in code

**Effort:** ~35 hours  
**Owner:** Full-stack engineer (you)  
**Risk:** Chunking quality – may need iteration

---

### Phase 2: Confidence Scoring & Claude Integration (Weeks 4–5, ~25 hours)

**Objective:** Integrate Claude as the answer engine; implement confidence scoring and escalation logic.

**Deliverables:**
- Claude synthesis prompt (grounded in retrieved docs, cite sources)
- Confidence scoring logic (semantic similarity between query & retrieved chunks, + Claude's internal confidence)
- Escalation rules (threshold-based + pattern matching for out-of-scope queries)
- End-to-end test queries with manual verification

**Tasks:**
1. Design Claude synthesis prompt (2–3 hours)
   - Instruction: "You are a brand & operations assistant. Answer only from the provided docs. If the answer is not in the docs, say so."
   - Require citations in format: "[Doc: title, Section: section_name, Page: X]"
   - Example output for calibration
2. Implement confidence scoring (4–5 hours)
   - Retrieve top-k chunks + score by relevance (cosine similarity)
   - Check if all top-5 chunks are on-topic (semantic coherence)
   - Claude scores its own confidence (1–10 scale) → map to 0–1
   - Aggregate: confidence = (avg_chunk_relevance + claude_confidence / 10) / 2
3. Add escalation detection (3–4 hours)
   - If confidence < 0.5: flag as "uncertain, escalate"
   - If query matches OOB patterns (e.g., "best restaurant" or "investment advice"): flag as "out-of-scope"
   - Route to Slack escalation channel with query, retrieved chunks, confidence score
4. Integration test (3–4 hours)
   - Run 20+ test queries covering: on-topic (high conf), partially-on-topic (medium conf), OOB (escalate)
   - Manually verify escalation decisions are correct
   - Refine confidence thresholds
5. Error handling & logging (2–3 hours)
   - Log all queries, retrieved chunks, confidence scores to Supabase (audit trail)
   - Graceful error handling for API failures (rate limits, timeouts)

**Success Criteria:**
- 100% of high-confidence answers (>0.7) are accurate and well-cited
- Escalation catches 90%+ of genuinely uncertain or OOB queries
- All queries logged for analysis
- No hallucinations or unfounded claims

**Effort:** ~25 hours  
**Owner:** Full-stack engineer  
**Dependencies:** Phase 1 complete

**Risk:** Confidence scoring may need tuning; consider A/B testing thresholds

---

### Phase 3: Chat Interface & Deployment (Weeks 6–7, ~30 hours)

**Objective:** Deploy a user-facing interface (Slack or web) and productionize the system.

**Option A: Slack Bot** (Recommended for Phase 3 MVP)
- **Effort:** ~20 hours
- **Pros:** Existing infrastructure, real-time, familiar UX, built-in escalation channel
- **Cons:** Limited formatting, Slack API rate limits
- **Build:**
  1. Slack app setup & OAuth (2 hours)
  2. n8n Slack integration (3 hours) – receive message → trigger retrieval → send response
  3. Formatting (citations, confidence badges) (3 hours)
  4. Escalation: post to #support-escalations (2 hours)
  5. Testing & deployment (4 hours)
  6. Documentation (2 hours)

**Option B: Custom Web UI** (Phase 4+)
- **Effort:** ~30 hours
- **Pros:** Full control, rich UI, multimodal (later: upload docs, share conversations)
- **Cons:** Higher initial lift, ops overhead (host backend + frontend)
- **Tech Stack:** Vue 3 / React + Tailwind, FastAPI or Node backend, authentication (Oauth or simple key)
- **Build:**
  1. Backend API scaffold (5–6 hours)
  2. Frontend chat component (8–10 hours)
  3. Response streaming UI (3–4 hours)
  4. Escalation UI (2–3 hours)
  5. Auth & rate limiting (3–4 hours)
  6. Deployment (vercel/render + docker) (2–3 hours)
  7. Docs (1–2 hours)

**Recommendation:** Start with **Slack Bot** for Phase 3 MVP (faster, proven UX). Plan custom UI for Phase 4 if needed.

**Tasks (Slack Bot Path):**
1. Set up Slack app (OAuth, permissions) (2 hours)
2. Build n8n Slack integration workflow (3–4 hours)
   - Receive message → extract query
   - Call retrieval + Claude pipeline
   - Format response with citations
   - Send to thread + log
3. Implement escalation routing (2 hours)
   - If confidence < 0.5 or OOB: post to #escalations with context
4. Testing with internal team (4 hours)
   - Run 50+ queries in Slack
   - Verify formatting, latency, accuracy
5. Monitoring & logging setup (2 hours)
   - Dashboard showing query volume, escalation rate, top queries
6. Documentation (1–2 hours)

**Success Criteria:**
- Slack bot responds to queries in <5 seconds (95th percentile)
- User can see sources and confidence score
- Escalations appear in dedicated channel within 30 seconds
- 10+ internal testers give thumbs up

**Effort:** ~20–30 hours  
**Owner:** Full-stack (Slack) or front-end + back-end pair (web UI)  
**Dependencies:** Phase 2 complete

---

### Phase 4: Brand Fidelity, Shopify Integration & Advanced Features (Weeks 8–12, ~40 hours)

**Objective:** Lock in brand voice, add inventory/Shopify integrations, improve answer quality.

**Tasks:**
1. Brand fidelity guardrails (8–10 hours)
   - Create brand voice guidelines doc (tone, terminology, do's/don'ts)
   - Add brand check to Claude prompt: "Rewrite your answer to match the brand voice: [voice guidelines]"
   - Implement brand anomaly detection (flag answers that drift too far from training examples)
   - A/B test with 5+ users to validate tone consistency

2. Shopify API integration (10–12 hours)
   - Ingest Shopify product catalog, pricing, inventory levels (read-only)
   - Add to vector index as additional corpus (separate metadata tag)
   - Handle rate limits & incremental sync (hourly)
   - Example: "Do you have X in stock?" → retrieve from Shopify inventory

3. Inventory API integration (5–7 hours)
   - Similar to Shopify: poll inventory system, sync to vector store
   - Queries like "What's our stock of [product]?" now return real-time data

4. Advanced retrieval (5–8 hours)
   - Hybrid search: combine vector search + keyword BM25 (better for rare terms)
   - Reranking model: fine-tuned or cross-encoder for domain (improves relevance)
   - Multi-step retrieval: if initial query is vague, ask clarification before searching

5. Performance & cost optimization (3–5 hours)
   - Profile API calls, cache frequent queries
   - Optimize chunk size & embedding model (smaller model = lower cost)
   - Monitor Pinecone/Supabase costs, optimize index size

**Success Criteria:**
- Brand voice is consistent across 100 queries (manual review)
- Shopify integration returns live inventory (verified in store)
- System costs < $500/month at scale

**Effort:** ~40 hours  
**Owner:** Full-stack + data engineer (for optimization)  
**Dependencies:** Phase 3 complete + Shopify/inventory API credentials

---

## Technology Decisions & Trade-offs

### Vector Store: Supabase pgvector (Locked In)

**Key characteristics:**
- **Setup:** 15 min (create project, enable pgvector extension, create tables)
- **Cost:** $25–100/mo (includes hosting, storage, API calls) — very cost-effective
- **Scalability:** Handles 1–50M embeddings comfortably (sufficient for your doc volume)
- **Ops:** Low overhead (Supabase manages postgres + backups)
- **Integration:** SQL-native; n8n uses REST API or pg client (no special SDK needed)

**n8n Integration Approach:**
- Use Supabase HTTP client in n8n to call REST API
- For bulk upserts: use n8n's PostgreSQL node (direct connection)
- Vector search: `SELECT * FROM document_chunks ORDER BY embedding <-> query_embedding LIMIT 5`

**Cost Estimate:** ~$50/mo (Phase 1–3), ~$75/mo (Phase 4 with larger index)

### n8n Cloud Integration (Locked In)

**Key setup:**
- n8n Cloud automatically handles scheduling, retries, and error notifications
- n8n workflows connect to Supabase via:
  - **HTTP client node** (REST API calls) for queries
  - **PostgreSQL node** (direct connection via connection string) for bulk upserts
- Workflows triggered by:
  - Schedule triggers (Google Drive polling hourly)
  - Webhook triggers (incoming chat queries)
- Cost: Free tier includes ~1000 executions/month; MVP should stay within free tier

**n8n + Supabase Example Flow:**
1. Google Drive polling (scheduled hourly)
2. Fetch new docs → detect changes
3. Split into chunks
4. Embed chunks (Claude API)
5. **PostgreSQL node** → INSERT chunks into `document_chunks` table
6. Done. Cost: ~5–10 executions/day = ~$0

### Chunking: Claude-Semantic vs Heuristic

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **Claude Semantic** | Preserves context, understands structure | Slower (Claude API calls), more expensive | 6–8 hours |
| **Heuristic (regex + overlap)** | Fast, deterministic, cheap | May split mid-sentence or context | 2–3 hours |
| **Hybrid** | Best of both (heuristic for speed, Claude for quality) | More complex | 4–5 hours |

**Recommendation:** Start with **Heuristic** (Phase 1) for speed. If quality is poor, upgrade to **Hybrid** in Phase 2.

### Embeddings: Claude API vs Dedicated Model

| Model | Speed | Cost | Quality | Integration |
|-------|-------|------|---------|-------------|
| **Claude (text-embedding-3-large)** | Fast | $0.02/M tokens | Excellent | Native to Claude |
| **OpenAI (text-embedding-3-large)** | Fast | $0.02/M tokens | Excellent | Extra API key |
| **Cohere (embed-english-v3.0)** | Fast | $0.10/M tokens | Good | Extra API key |
| **Open-source (all-MiniLM)** | Very fast (local) | Free | Good | Requires GPU/inference |

**Recommendation:** Use **Claude embeddings** (native, no extra keys). If cost becomes issue in Phase 4, switch to Cohere or self-hosted.

---

## Dependencies & Critical Path

```
Phase 1 (Weeks 1–3)
├─ Google Drive API key setup ✓ (prerequisite)
├─ Pinecone/Supabase setup ✓ (prerequisite)
├─ n8n workflow for ingestion (3 days)
├─ Semantic chunking (5 days)
├─ Vector indexing (3 days)
├─ Retrieval endpoint (3 days)
└─ Phase 1 testing (2 days)

Phase 2 (Weeks 4–5) — depends on Phase 1
├─ Claude prompt engineering (3 days)
├─ Confidence scoring (4 days)
├─ Escalation logic (3 days)
└─ Phase 2 testing & tuning (2 days)

Phase 3 (Weeks 6–7) — depends on Phase 2
├─ Slack bot OR web UI (5–7 days)
└─ Testing & documentation (2 days)

Phase 4 (Weeks 8–12) — depends on Phase 3
├─ Shopify integration (parallel track)
├─ Brand fidelity guardrails (parallel track)
└─ Performance optimization (final week)
```

**Critical Path:** Phase 1 → Phase 2 → Phase 3 (MVP)  
**Nice-to-Have:** Phase 4 features can run in parallel with Phase 3 testing

**External Dependencies:**
- Google Drive API credentials (service account from your Google Workspace)
- Supabase account & API keys
- Claude API key + sufficient quota (budget ~$50/phase for testing)
- n8n Cloud account (free tier available; ~$2–10/mo for MVP usage)
- Slack workspace (for Slack bot MVP)

---

## Known Risks & Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Chunking loses context** | High | Manual inspection of 20+ chunks early; plan to iterate |
| **Claude hallucinations** | High | Strict retrieval grounding; if not in docs, say so; escalate low-confidence |
| **Vector search irrelevance** | Medium | Implement confidence scoring + reranking; hybrid search in Phase 4 |
| **Google Drive API rate limits** | Medium | Batch polling (hourly), cache docs locally, handle 429s gracefully |
| **Pinecone costs scale** | Medium | Monitor usage; optimize chunk size; migrate to pgvector if needed |
| **Slack formatting breaks** | Low | Test with rich text; use plain text fallback |
| **Out-of-scope queries confuse Claude** | High | Strong OOB pattern detection; escalate aggressively early, tune in Phase 3 |
| **Version conflicts (old vs new docs)** | Medium | Track doc version in metadata; always retrieve latest version |
| **Slow response times (>5s)** | Medium | Parallel retrieval + streaming responses; profile Phase 2 |
| **Escalation queue floods** | Low | Rate limiting + batch review; monitor escalation rate |

**Contingency:**
- If Phase 1 chunking is poor: add manual review loop (1–2 hours/doc) before indexing
- If Phase 2 confidence tuning fails: fall back to simpler heuristic (always escalate <0.6)
- If Phase 3 Slack formatting is broken: defer to custom web UI (Phase 4)
- If costs are higher than expected: migrate to Supabase pgvector + self-hosted embeddings (save ~60%)

---

## Implementation Checklist

### Pre-Build (Before Week 1)
- [ ] Gather 3–5 sample Google Drive docs for testing
- [ ] ✅ **Supabase pgvector** — sign up, create project, enable pgvector
- [ ] Create `.env` template with Supabase & Claude API keys (never commit)
- [ ] ✅ **n8n Cloud** — sign up at cloud.n8n.io
- [ ] Create Google Drive service account + OAuth credentials
- [ ] Verify Claude API quota ($100+ budget)
- [ ] (Optional) Decide: Slack bot or custom web UI for Phase 3? → Recommendation: Slack bot MVP

### Phase 1 Gates
- [ ] Google Drive polling works (fetches new docs hourly)
- [ ] Chunking produces sensible, non-overlapping segments
- [ ] Vector indexing: can store & retrieve 1000+ chunks
- [ ] Retrieval endpoint returns top-5 relevant chunks for 10 test queries
- [ ] All secrets in `.env`, no hardcoded keys

### Phase 2 Gates
- [ ] Confidence scoring: ≥0.7 for accurate answers, <0.5 for escalation
- [ ] Claude generates on-topic, cited responses
- [ ] Escalation routes low-confidence queries to Slack
- [ ] Query audit log works (Supabase logs all queries + responses)

### Phase 3 Gates (MVP)
- [ ] Slack bot responds to DMs and mentions in <5s (95th percentile)
- [ ] Citations formatted and clickable
- [ ] 10 internal users tested, feedback incorporated
- [ ] Escalation channel active and monitored

### Phase 4 Gates
- [ ] Brand voice consistent across 50+ queries
- [ ] Shopify API returns live inventory in answers
- [ ] Cost < $500/month
- [ ] Hybrid search improves relevance by 20%+ (A/B test)

---

## Success Metrics (Phase 3 MVP)

- **Accuracy:** 95%+ of answers are correct and grounded in docs (manual review)
- **Coverage:** Answers 80%+ of on-topic queries without escalation
- **Escalation:** <10% of queries escalated (tuned via confidence threshold)
- **Speed:** <5s response time (99th percentile, including Claude API latency)
- **Fidelity:** Brand voice consistent (subjective; survey users)
- **Reliability:** 99.5% uptime (n8n Cloud + Supabase SLA)
- **Cost:** ~$100–150/month (Supabase ~$50/mo + n8n Cloud ~$5/mo + Claude API ~$45–95/mo for phases 1–3)

---

## Estimated Total Effort

| Phase | Hours | Weeks | Owner |
|-------|-------|-------|-------|
| 1: Core Pipeline | 35 | 3 | Full-stack |
| 2: Claude Integration | 25 | 2 | Full-stack |
| 3: Slack Bot MVP | 20 | 2 | Full-stack |
| 4: Advanced Features | 40 | 4–5 | Full-stack + optimization |
| **Total** | **~120** | **~11–12** | |

**Critical Path (MVP):** Phases 1–3 = ~80 hours, ~7 weeks  
**With Parallelization (Phase 4):** Could compress to 5–6 weeks if you have 2 engineers

---

## Next Steps

1. **Remaining decisions (need your input):**
   - Slack bot or custom web UI for Phase 3? (Recommendation: Slack bot MVP)
   - Chunk size: 500, 750, or 1000 tokens? (Recommendation: 750 for balance)
   - Confidence threshold: 0.5, 0.6, or 0.7 for escalation? (Recommendation: 0.5, conservative)
2. **Gather prerequisites:**
   - 3–5 sample Google Drive docs (for testing chunking strategy)
   - Supabase account + project created
   - n8n Cloud account (or self-hosted if preferred)
   - Claude API key + $100+ budget for testing
   - Google Drive service account credentials
   - Slack workspace (for escalation channel + bot)
3. **Kickoff Phase 1** — build detailed task breakdown once prerequisites ready

---

**Questions?** Flag assumptions that need clarification, or areas where you'd like more detail before we commit to build.
