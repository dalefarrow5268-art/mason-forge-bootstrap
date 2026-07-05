/**
 * Mason Forge™
 * KnowledgeIndex
 *
 * Provides indexing services for the Knowledge Engine.
 *
 * Current implementation:
 * - In-memory keyword index
 *
 * Future implementations:
 * - Full Text Search
 * - Vector Embeddings
 * - Semantic Search
 * - AI Ranking
 * - Distributed Indexing
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

class KnowledgeIndex {
  constructor() {
    this.index = new Map();
  }

  index(record) {
    if (!record || !record.key) {
      throw new Error("KnowledgeIndex.index() requires a valid record.");
    }

    const searchableText = [
      record.key,
      typeof record.value === "string" ? record.value : "",
      JSON.stringify(record.metadata || {}),
    ]
      .join(" ")
      .toLowerCase();

    this.index.set(record.key, {
      key: record.key,
      searchableText,
      updatedAt: new Date().toISOString(),
    });

    return this.index.get(record.key);
  }

  remove(key) {
    return this.index.delete(key);
  }

  has(key) {
    return this.index.has(key);
  }

  rebuild(records = []) {
    this.clear();

    records.forEach((record) => {
      this.index(record);
    });

    return this.size();
  }

  search(query = "") {
    const terms = query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) {
      return [];
    }

    const matches = [];

    for (const record of this.index.values()) {
      let score = 0;

      terms.forEach((term) => {
        if (record.searchableText.includes(term)) {
          score++;
        }
      });

      if (score > 0) {
        matches.push({
          key: record.key,
          score,
        });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  clear() {
    this.index.clear();
  }

  size() {
    return this.index.size;
  }

  export() {
    return [...this.index.values()];
  }

  import(data = []) {
    this.clear();

    data.forEach((record) => {
      if (record?.key) {
        this.index.set(record.key, record);
      }
    });

    return this.size();
  }

  health() {
    return {
      status: "healthy",
      indexedRecords: this.size(),
      timestamp: new Date().toISOString(),
    };
  }
}

export default KnowledgeIndex;