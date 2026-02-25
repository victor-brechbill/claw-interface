import { useState, useEffect } from "react";
import type {
  BriefsResponse,
  SearchBriefsResponse,
  MorningBrief,
} from "../types";
import { apiGet } from "../utils/api";
import BriefCard from "./BriefCard";
import BriefDetail from "./BriefDetail";

export default function BriefArchive() {
  const [briefs, setBriefs] = useState<MorningBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MorningBrief[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedBriefDate, setSelectedBriefDate] = useState<string | null>(
    null,
  );
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  // Fetch briefs on component mount and pagination change
  useEffect(() => {
    fetchBriefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page]);

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim()) {
        performSearch();
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const fetchBriefs = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiGet<BriefsResponse>(
        `/api/briefs?page=${pagination.page}&limit=${pagination.limit}`,
      );
      setBriefs(data.briefs ?? []);
      setPagination((prev) => ({
        ...prev,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch briefs");
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async () => {
    setSearching(true);

    try {
      const data = await apiGet<SearchBriefsResponse>(
        `/api/briefs/search?q=${encodeURIComponent(searchQuery.trim())}`,
      );
      setSearchResults(data.briefs ?? []);
    } catch (err) {
      console.error("Search error:", err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleBriefClick = (brief: MorningBrief) => {
    setSelectedBriefDate(brief.date);
  };

  const handleCloseBrief = () => {
    setSelectedBriefDate(null);
  };

  const handlePageChange = (newPage: number) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
  };

  // Determine which briefs to display
  const briefsToDisplay = searchQuery.trim() ? searchResults : briefs;
  const isSearchMode = searchQuery.trim().length > 0;

  return (
    <div className="brief-archive">
      <div className="brief-archive-header">
        <h1>Morning Brief Archive</h1>

        <div className="search-bar">
          <input
            type="text"
            placeholder="Search briefs by content or headline..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button onClick={clearSearch} className="search-clear">
              ×
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-message">Error: {error}</div>}

      {isSearchMode && (
        <div className="search-status">
          {searching ? (
            <span>Searching...</span>
          ) : (
            <span>
              Found {searchResults.length} result
              {searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
            </span>
          )}
        </div>
      )}

      {loading && !isSearchMode ? (
        <div className="loading">Loading briefs...</div>
      ) : briefsToDisplay.length === 0 ? (
        <div className="no-results">
          {isSearchMode
            ? "No briefs found matching your search."
            : "No briefs available."}
        </div>
      ) : (
        <>
          <div className="briefs-grid">
            {briefsToDisplay.map((brief) => (
              <BriefCard
                key={brief.id}
                brief={brief}
                onClick={() => handleBriefClick(brief)}
              />
            ))}
          </div>

          {/* Pagination - only show when not searching */}
          {!isSearchMode && pagination.totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="pagination-button"
              >
                Previous
              </button>

              <span className="pagination-info">
                Page {pagination.page} of {pagination.totalPages}(
                {pagination.total} total briefs)
              </span>

              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="pagination-button"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Brief Detail Modal */}
      {selectedBriefDate && (
        <BriefDetail date={selectedBriefDate} onClose={handleCloseBrief} />
      )}
    </div>
  );
}
