import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import stories from "./data/stories.json";
import narrationManifest from "./data/narration-manifest.json";
import Library from "./components/Library.jsx";
import Reader from "./components/Reader.jsx";

const STORAGE_KEYS = {
  progress: "lanternberry-progress-v1",
  bookmarks: "lanternberry-bookmarks-v1",
  settings: "lanternberry-reader-settings-v1",
};
const WARM_NARRATOR_NAME = /(zira|samantha|aria|jenny|ava|emma|susan|rachel|amy|warm|gentle|friendly|story|child|kid)/i;
const POLISHED_VOICE_NAME = /(natural|neural|enhanced|premium|studio)/i;

function readStorage(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function recommendedEnglishVoice(voices) {
  return [...voices].sort((left, right) => {
    const score = (voice) => {
      const name = voice.name.toLowerCase();
      return (voice.localService ? 70 : 0)
        + (WARM_NARRATOR_NAME.test(name) ? 65 : 0)
        + (POLISHED_VOICE_NAME.test(name) ? 25 : 0)
        + (/^en-us\b/i.test(voice.lang) ? 20 : /^en-gb\b/i.test(voice.lang) ? 15 : 0)
        + (voice.default ? 5 : 0);
    };
    return score(right) - score(left) || left.name.localeCompare(right.name);
  })[0] ?? null;
}

function splitNarration(text) {
  return (text.match(/[^.!?]+(?:[.!?]+[”"’']*|$)/gu) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => ({
      text: sentence,
      dialogue: /[“"][^”"]+[”"]/.test(sentence),
      expressive: /[!?][”"’']?$/.test(sentence),
    }));
}

function stopAudioElement(audioRef) {
  const audio = audioRef.current;
  if (!audio) return;
  audio.onplay = null;
  audio.onpause = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  audioRef.current = null;
}

function initialLocation() {
  const params = new URLSearchParams(window.location.search);
  const storyId = clamp(Number(params.get("story")) || 1, 1, stories.length);
  const pageNumber = clamp(Number(params.get("page")) || 1, 1, 10);
  if (params.has("story")) return { view: "reader", storyId, pageNumber };
  return { view: params.get("view") === "bookmarks" ? "bookmarks" : "library", storyId, pageNumber };
}

function addressFor(view, storyId, pageNumber) {
  const url = new URL(window.location.href);
  url.searchParams.delete("story");
  url.searchParams.delete("page");
  url.searchParams.delete("view");
  if (view === "reader") {
    url.searchParams.set("story", String(storyId));
    url.searchParams.set("page", String(pageNumber));
  } else if (view === "bookmarks") {
    url.searchParams.set("view", "bookmarks");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function updateAddress(method, view, storyId, pageNumber) {
  try {
    window.history[method]({ view, storyId, pageNumber }, "", addressFor(view, storyId, pageNumber));
  } catch (error) {
    if (window.location.protocol !== "file:") throw error;
  }
}

export default function App() {
  const initial = useMemo(initialLocation, []);
  const [view, setView] = useState(initial.view);
  const [activeStoryId, setActiveStoryId] = useState(initial.storyId);
  const [pageNumber, setPageNumber] = useState(initial.pageNumber);
  const [progress, setProgress] = useState(() => readStorage(STORAGE_KEYS.progress, { pages: {}, latest: null }));
  const [bookmarks, setBookmarks] = useState(() => readStorage(STORAGE_KEYS.bookmarks, []));
  const [settings, setSettings] = useState(() => {
    const saved = readStorage(STORAGE_KEYS.settings, {});
    return {
      textScale: clamp(Number(saved.textScale) || 1, 0.9, 1.25),
      panelOpacity: clamp(Number(saved.panelOpacity) || 0.82, 0.72, 0.96),
      voiceURI: typeof saved.voiceURI === "string" && saved.voiceURI ? saved.voiceURI : "kokoro",
      speechRate: clamp(Number(saved.speechRate) || 0.92, 0.75, 1.15),
    };
  });
  const [availableVoices, setAvailableVoices] = useState([]);
  const [speechState, setSpeechState] = useState("idle");
  const [audioMessage, setAudioMessage] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const readerRef = useRef(null);
  const narrationRunRef = useRef(0);
  const narrationAudioRef = useRef(null);

  const activeStory = stories.find((story) => story.id === activeStoryId) ?? stories[0];
  const currentPage = activeStory.pages[pageNumber - 1];
  const currentBookmarkKey = `${activeStory.id}:${pageNumber}`;
  const isBookmarked = bookmarks.some((entry) => entry.key === currentBookmarkKey);
  const englishVoices = useMemo(
    () => availableVoices.filter((voice) => /^en(?:-|$)/i.test(voice.lang)),
    [availableVoices],
  );
  const recommendedVoice = useMemo(() => recommendedEnglishVoice(englishVoices), [englishVoices]);
  const selectedVoice = settings.voiceURI === "device"
    ? recommendedVoice
    : englishVoices.find((voice) => voice.voiceURI === settings.voiceURI) ?? recommendedVoice;
  const selectedVoiceURI = settings.voiceURI === "device"
    || englishVoices.some((voice) => voice.voiceURI === settings.voiceURI)
    ? settings.voiceURI
    : "kokoro";
  const currentNarrationAudio = narrationManifest.pages?.[String(activeStory.id)]?.[String(pageNumber)] ?? "";

  useEffect(() => {
    if (!("speechSynthesis" in window)) return undefined;
    const refreshVoices = () => setAvailableVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", refreshVoices);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(progress));
    } catch {
      // Reading still works when browser storage is unavailable.
    }
  }, [progress]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.bookmarks, JSON.stringify(bookmarks));
    } catch {
      // Bookmark controls remain usable for this visit without browser storage.
    }
  }, [bookmarks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    } catch {
      // Reader preferences keep their in-memory state for this visit.
    }
  }, [settings]);

  useEffect(() => {
    updateAddress("replaceState", view, activeStoryId, pageNumber);
  }, [view, activeStoryId, pageNumber]);

  useEffect(() => {
    function restoreAddress() {
      const params = new URLSearchParams(window.location.search);
      if (params.has("story")) {
        setActiveStoryId(clamp(Number(params.get("story")) || 1, 1, stories.length));
        setPageNumber(clamp(Number(params.get("page")) || 1, 1, 10));
        setView("reader");
      } else {
        setView(params.get("view") === "bookmarks" ? "bookmarks" : "library");
      }
    }
    window.addEventListener("popstate", restoreAddress);
    return () => window.removeEventListener("popstate", restoreAddress);
  }, []);

  useEffect(() => {
    if (view !== "reader") return;
    setProgress((previous) => ({
      pages: { ...(previous.pages ?? {}), [activeStoryId]: pageNumber },
      latest: { storyId: activeStoryId, pageNumber },
    }));
  }, [view, activeStoryId, pageNumber]);

  useEffect(() => {
    function updateFullscreenState() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  useEffect(() => {
    narrationRunRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopAudioElement(narrationAudioRef);
    setSpeechState("idle");
    setAudioMessage("");
    return () => {
      narrationRunRef.current += 1;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      stopAudioElement(narrationAudioRef);
    };
  }, [view, activeStoryId, pageNumber]);

  const openStory = useCallback((storyId, page = 1) => {
    const nextStory = clamp(Number(storyId) || 1, 1, stories.length);
    const nextPage = clamp(Number(page) || 1, 1, 10);
    setActiveStoryId(nextStory);
    setPageNumber(nextPage);
    setView("reader");
    updateAddress("pushState", "reader", nextStory, nextPage);
  }, []);

  const showStories = useCallback(() => {
    setView("library");
    updateAddress("pushState", "library", activeStoryId, pageNumber);
  }, [activeStoryId, pageNumber]);

  const showBookmarks = useCallback(() => {
    setView("bookmarks");
    updateAddress("pushState", "bookmarks", activeStoryId, pageNumber);
  }, [activeStoryId, pageNumber]);

  const continueReading = useCallback(() => {
    const latest = progress.latest;
    if (latest) openStory(latest.storyId, latest.pageNumber);
    else openStory(1, 1);
  }, [openStory, progress.latest]);

  const changePage = useCallback((nextPage) => {
    if (nextPage < 1) {
      if (activeStoryId > 1) openStory(activeStoryId - 1, 10);
      return;
    }
    if (nextPage > 10) {
      if (activeStoryId < stories.length) openStory(activeStoryId + 1, 1);
      return;
    }
    setPageNumber(nextPage);
  }, [activeStoryId, openStory]);

  const toggleBookmark = useCallback(() => {
    setBookmarks((previous) => {
      if (previous.some((entry) => entry.key === currentBookmarkKey)) {
        return previous.filter((entry) => entry.key !== currentBookmarkKey);
      }
      return [{ key: currentBookmarkKey, storyId: activeStory.id, pageNumber }, ...previous];
    });
  }, [activeStory.id, currentBookmarkKey, pageNumber]);

  const removeBookmark = useCallback((key) => {
    setBookmarks((previous) => previous.filter((entry) => entry.key !== key));
  }, []);

  const openBookmark = useCallback((entry) => {
    openStory(entry.storyId, entry.pageNumber);
  }, [openStory]);

  const startListening = useCallback(async () => {
    const runId = narrationRunRef.current + 1;
    narrationRunRef.current = runId;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopAudioElement(narrationAudioRef);

    if (selectedVoiceURI === "kokoro") {
      if (!currentNarrationAudio) {
        setSpeechState("idle");
        setAudioMessage("Kokoro narration is missing for this page. Rebuild the offline reader after generating narration.");
        return;
      }
      const audio = new window.Audio(currentNarrationAudio);
      audio.preload = "auto";
      audio.playbackRate = settings.speechRate;
      narrationAudioRef.current = audio;
      audio.onplay = () => {
        if (runId !== narrationRunRef.current) return;
        setSpeechState("speaking");
        setAudioMessage("Kokoro storyteller is reading this page.");
      };
      audio.onpause = () => {
        if (runId !== narrationRunRef.current || audio.ended) return;
        setSpeechState("paused");
      };
      audio.onended = () => {
        if (runId !== narrationRunRef.current) return;
        narrationAudioRef.current = null;
        setSpeechState("idle");
        setAudioMessage("Page narration finished.");
      };
      audio.onerror = () => {
        if (runId !== narrationRunRef.current) return;
        narrationAudioRef.current = null;
        setSpeechState("idle");
        setAudioMessage("Kokoro audio could not play here. Choose a device voice to continue.");
      };
      setAudioMessage("");
      setSpeechState("speaking");
      try {
        await audio.play();
      } catch {
        if (runId !== narrationRunRef.current) return;
        narrationAudioRef.current = null;
        setSpeechState("idle");
        setAudioMessage("Kokoro audio could not play here. Choose a device voice to continue.");
      }
      return;
    }

    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setAudioMessage("Read aloud is not supported by this browser.");
      return;
    }
    const segments = splitNarration(currentPage.text);
    const speakSegment = (index) => {
      if (runId !== narrationRunRef.current) return;
      if (index >= segments.length) {
        setSpeechState("idle");
        return;
      }

      const segment = segments[index];
      const utterance = new window.SpeechSynthesisUtterance(segment.text);
      utterance.lang = selectedVoice?.lang ?? "en-US";
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = settings.speechRate;
      utterance.pitch = segment.dialogue ? 1.15 : segment.expressive ? 1.11 : 1.08;
      utterance.onend = () => {
        if (runId !== narrationRunRef.current) return;
        window.setTimeout(() => speakSegment(index + 1), segment.expressive ? 210 : 150);
      };
      utterance.onerror = (event) => {
        if (runId !== narrationRunRef.current) return;
        setSpeechState("idle");
        if (event.error !== "canceled" && event.error !== "interrupted") {
          setAudioMessage("That voice could not play. Try another voice or use the recommended English voice.");
        }
      };
      window.speechSynthesis.speak(utterance);
    };

    setAudioMessage("");
    setSpeechState("speaking");
    speakSegment(0);
  }, [currentNarrationAudio, currentPage.text, selectedVoice, selectedVoiceURI, settings.speechRate]);

  const togglePause = useCallback(() => {
    const audio = narrationAudioRef.current;
    if (audio) {
      if (speechState === "speaking") audio.pause();
      else if (speechState === "paused") {
        audio.play().catch(() => {
          setSpeechState("idle");
          setAudioMessage("Kokoro audio could not resume here. Press Listen to try again.");
        });
      }
      return;
    }
    if (!("speechSynthesis" in window)) return;
    if (speechState === "speaking") {
      window.speechSynthesis.pause();
      setSpeechState("paused");
    } else if (speechState === "paused") {
      window.speechSynthesis.resume();
      setSpeechState("speaking");
    }
  }, [speechState]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await readerRef.current?.requestFullscreen?.();
    } catch {
      setAudioMessage("Full screen is unavailable in this browser.");
    }
  }, []);

  useEffect(() => {
    if (view !== "reader") return undefined;
    function onKeyDown(event) {
      const tag = document.activeElement?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || document.activeElement?.isContentEditable) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        changePage(pageNumber + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        changePage(pageNumber - 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, changePage, pageNumber]);

  if (view === "reader") {
    return (
      <div className="reader-view" ref={readerRef}>
        <Reader
          story={activeStory}
          page={currentPage}
          pageNumber={pageNumber}
          pageBookmarked={isBookmarked}
          speechState={speechState}
          audioMessage={audioMessage}
          voices={englishVoices}
          voiceURI={selectedVoiceURI}
          speechRate={settings.speechRate}
          textScale={settings.textScale}
          panelOpacity={settings.panelOpacity}
          isFullscreen={isFullscreen}
          onBack={showStories}
          onChangePage={changePage}
          onToggleBookmark={toggleBookmark}
          onStartListening={startListening}
          onTogglePause={togglePause}
          onVoiceChange={(value) => setSettings((previous) => ({ ...previous, voiceURI: value }))}
          onSpeechRateChange={(value) => {
            if (narrationAudioRef.current) narrationAudioRef.current.playbackRate = value;
            setSettings((previous) => ({ ...previous, speechRate: value }));
          }}
          onTextScaleChange={(value) => setSettings((previous) => ({ ...previous, textScale: value }))}
          onPanelOpacityChange={(value) => setSettings((previous) => ({ ...previous, panelOpacity: value }))}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
    );
  }

  return (
    <Library
      stories={stories}
      view={view}
      bookmarks={bookmarks}
      progress={progress}
      onShowStories={showStories}
      onShowBookmarks={showBookmarks}
      onOpenStory={openStory}
      onContinue={continueReading}
      onOpenBookmark={openBookmark}
      onRemoveBookmark={removeBookmark}
    />
  );
}
