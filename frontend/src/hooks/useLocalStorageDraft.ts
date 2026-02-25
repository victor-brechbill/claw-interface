import { useState, useEffect, useRef } from "react";

interface UseLocalStorageDraftOptions {
  debounceMs?: number;
}

/**
 * Generic hook for saving/restoring drafts to localStorage with debounce
 * @param key - localStorage key
 * @param initialValue - initial value if no draft exists
 * @param options - configuration options
 * @returns [value, setValue, clearDraft, isDraftRestored]
 */
export function useLocalStorageDraft<T>(
  key: string,
  initialValue: T,
  options: UseLocalStorageDraftOptions = {},
): [T, (value: T | ((prev: T) => T)) => void, () => void, boolean] {
  const { debounceMs = 500 } = options;
  const [value, setValueInternal] = useState<T>(initialValue);

  const setValue = (newValue: T | ((prev: T) => T)) => {
    setValueInternal(newValue);
  };
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;

      const loadDraft = () => {
        try {
          const savedDraft = localStorage.getItem(key);
          if (savedDraft) {
            const parsedDraft = JSON.parse(savedDraft);
            setValueInternal(parsedDraft);
            setIsDraftRestored(true);
          }
        } catch (error) {
          console.warn("Failed to load draft from localStorage:", error);
          // Clear corrupted data
          localStorage.removeItem(key);
        }
      };

      // Use setTimeout to avoid the setState-in-effect warning
      setTimeout(loadDraft, 0);
    }
  }, [key]);

  // Save to localStorage with debounce (only after initialization)
  useEffect(() => {
    if (!initializedRef.current) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.warn("Failed to save draft to localStorage:", error);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [key, value, debounceMs]);

  // Clear draft function
  const clearDraft = () => {
    try {
      localStorage.removeItem(key);
      setValueInternal(initialValue);
      setIsDraftRestored(false);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    } catch (error) {
      console.warn("Failed to clear draft from localStorage:", error);
    }
  };

  return [value, setValue, clearDraft, isDraftRestored];
}

/**
 * Hook for managing open card ID in localStorage with 30-second expiration
 * @returns [openCardId, setOpenCardId, clearOpenCard]
 */
export function useOpenCard(): [
  string | null,
  (cardId: string | null) => void,
  () => void,
] {
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const key = "kanban-open-card";
  const TIMEOUT_SECONDS = 30;

  // Load from localStorage on mount
  useEffect(() => {
    const loadCardId = () => {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          // Try parsing as new format {cardId, openedAt}
          try {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === "object" && parsed.cardId) {
              // New format with timestamp
              const elapsed = (Date.now() - parsed.openedAt) / 1000;
              if (elapsed < TIMEOUT_SECONDS) {
                // Within timeout window - restore the card
                setOpenCardId(parsed.cardId);
              } else {
                // Expired - clear stale state
                localStorage.removeItem(key);
              }
            } else {
              // Malformed object - clear it
              localStorage.removeItem(key);
            }
          } catch {
            // Old format (plain string) or invalid JSON - treat as expired
            localStorage.removeItem(key);
          }
        }
        setIsInitialized(true);
      } catch (error) {
        console.warn("Failed to load open card from localStorage:", error);
        localStorage.removeItem(key);
        setIsInitialized(true);
      }
    };

    // Use setTimeout to avoid the setState-in-effect warning
    setTimeout(loadCardId, 0);
  }, []);

  // Save to localStorage when changed (but only after initialization)
  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    try {
      if (openCardId) {
        // Store with timestamp
        const data = {
          cardId: openCardId,
          openedAt: Date.now(),
        };
        localStorage.setItem(key, JSON.stringify(data));
      } else {
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn("Failed to save open card to localStorage:", error);
    }
  }, [openCardId, isInitialized]);

  const clearOpenCard = () => {
    try {
      localStorage.removeItem(key);
      setOpenCardId(null);
    } catch (error) {
      console.warn("Failed to clear open card from localStorage:", error);
    }
  };

  return [openCardId, setOpenCardId, clearOpenCard];
}
