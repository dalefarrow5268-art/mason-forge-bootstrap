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

    this.statistics = {
      indexed: 0,
      searches: 0,
      lastUpdated: null,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Index Operations
  |--------------------------------------------------------------------------
  */

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

    const indexedRecord = {
      key: record.key,
      searchableText,
      updatedAt: new Date().toISOString(),
    };

    this.index.set(record.key, indexedRecord);

    this.statistics.indexed = this.size();
    this.statistics.lastUpdated = new Date().toISOString();

    return indexedRecord;
  }

  remove(key) {
    const removed = this.index.delete(key);

    this.statistics.indexed = this.size();
    this.statistics.lastUpdated = new Date().toISOString();

    return removed;
  }

  has(key) {
    return this.index.has(key);
  }

  rebuild(records = []) {
    this.clear();

    records.forEach((record) => this.index(record));

    this.statistics.indexed = this.size();
    this.statistics.lastUpdated = new Date().toISOString();

    return this.size();
  }

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  */

  search(query = "") {
    this.statistics.searches++;

    const terms = query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!terms.length) {
      return [];
    }

    const matches = [];

    for (const record of this.index.values()) {
      let score = 0;

      for (const term of terms) {
        if (record.searchableText.includes(term)) {
          score++;
        }
      }

      if (score > 0) {
        matches.push({
          key: record.key,
          score,
        });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  /*
  |--------------------------------------------------------------------------
  | Storage
  |--------------------------------------------------------------------------
  */

  clear() {
    this.index.clear();

    this.statistics.indexed = 0;
    this.statistics.lastUpdated = new Date().toISOString();
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

    this.statistics.indexed = this.size();
    this.statistics.lastUpdated = new Date().toISOString();

    return this.size();
  }

  /*
  |--------------------------------------------------------------------------
  | Statistics
  |--------------------------------------------------------------------------
  */

  metrics() {
    return {
      indexedRecords: this.size(),
      searches: this.statistics.searches,
      lastUpdated: this.statistics.lastUpdated,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Health
  |--------------------------------------------------------------------------
  */

  health() {
    return {
      status: "Operational",
      indexedRecords: this.size(),
      metrics: this.metrics(),
      timestamp: new Date().toISOString(),
    };
  }
}

export default KnowledgeIndex;