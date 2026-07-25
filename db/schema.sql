-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create document_chunks table
CREATE TABLE IF NOT EXISTS document_chunks (
  id BIGSERIAL PRIMARY KEY,
  doc_id TEXT NOT NULL,
  chunk_idx INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536), -- Claude embeddings are 1536 dimensions
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for vector search (cosine similarity)
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Create index for doc_id lookups
CREATE INDEX IF NOT EXISTS document_chunks_doc_id_idx
  ON document_chunks (doc_id);

-- Create index for metadata searches
CREATE INDEX IF NOT EXISTS document_chunks_metadata_idx
  ON document_chunks USING GIN (metadata);

-- Enable RLS (Row Level Security) - set to allow public read for now
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON document_chunks
  FOR SELECT TO PUBLIC
  USING (true);

CREATE POLICY "Allow service role write" ON document_chunks
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY "Allow service role update" ON document_chunks
  FOR UPDATE TO service_role
  USING (true);
